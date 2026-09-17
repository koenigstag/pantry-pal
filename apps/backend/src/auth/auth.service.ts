import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Transactional, UsersRepository, type CreateUserInput } from '@pantry-pal/db';
import { MAX_EMAIL_LENGTH, type AuthSession } from '@pantry-pal/shared';
import type { ChangePasswordDto, DevSignInDto, SignInDto, SignUpDto } from '@pantry-pal/shared/dto';
import { isEmail } from 'class-validator';

import type { AuthenticatedUser } from '../common/request-context';
import { displayNameFor, IdentityService } from './identity.service';
import { PasswordHasher } from './password-hasher';
import { SessionsService } from './sessions.service';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersRepository,
    private readonly hasher: PasswordHasher,
    private readonly sessions: SessionsService,
    private readonly identity: IdentityService,
  ) {}

  /**
   * A new account with a password, signed in. An email that already has an
   * account is refused, including one without a password: setting a password on
   * it would hand the account to whoever typed the email first.
   */
  async signUp(dto: SignUpDto, userAgent: string | undefined): Promise<AuthSession> {
    if ((await this.users.findByEmail(dto.email)) !== undefined) {
      throw new ConflictException('An account with this email already exists');
    }

    // Outside the transaction: hashing takes tens of milliseconds and needs no connection.
    const passwordHash = await this.hasher.hash(dto.password);

    return this.register(
      {
        email: dto.email,
        displayName: dto.displayName ?? displayNameFor(dto.email),
        passwordHash,
        // Omitted, the column's default applies.
        locale: dto.locale,
      },
      userAgent,
    );
  }

  /** One message for an unknown email and a wrong password alike. */
  async signIn(dto: SignInDto, userAgent: string | undefined): Promise<AuthSession> {
    const user = await this.users.findByEmail(dto.email);

    // Accounts made by the development sign-in have no password to check.
    const passwordHash = user?.passwordHash ?? null;
    const valid = passwordHash !== null && (await this.hasher.verify(passwordHash, dto.password));
    if (user === undefined || !valid) {
      throw new UnauthorizedException('Incorrect email or password');
    }

    return this.sessions.start(user, userAgent);
  }

  /** `DEV_AUTH=true` only: any email signs in, and an unknown one becomes an account. */
  async devSignIn(dto: DevSignInDto, userAgent: string | undefined): Promise<AuthSession> {
    if (!this.identity.devIdentityEnabled) throw new NotFoundException();

    // The locale counts only if the account is created now.
    const user = await this.users.findOrCreateByEmail({
      email: dto.email,
      displayName: displayNameFor(dto.email),
      locale: dto.locale,
    });
    return this.sessions.start(user, userAgent);
  }

  /**
   * Replaces the caller's password and ends every other session of the account;
   * the caller's own stays signed in.
   *
   * A wrong current password is a 403, never a 401: clients take a 401 to mean
   * the access token expired.
   */
  async changePassword(
    user: AuthenticatedUser,
    sessionId: string | undefined,
    dto: ChangePasswordDto,
  ): Promise<void> {
    if (sessionId === undefined) {
      throw new ForbiddenException('Sign in with an access token to change a password');
    }
    if (dto.newPassword === dto.currentPassword) {
      throw new BadRequestException('newPassword must differ from currentPassword');
    }

    const currentHash = (await this.users.findById(user.id))?.passwordHash ?? null;
    if (currentHash === null) {
      throw new ForbiddenException('This account has no password to change');
    }
    if (!(await this.hasher.verify(currentHash, dto.currentPassword))) {
      throw new ForbiddenException('The current password is incorrect');
    }

    // Hashed outside the transaction, as at sign-up. The transaction then makes
    // sure the password it verified is still the one stored.
    const nextHash = await this.hasher.hash(dto.newPassword);
    await this.replacePassword(user.id, sessionId, currentHash, nextHash);
  }

  /**
   * An administrator sets a user's password and every session of the user ends.
   * Accounts without a password, such as the development sign-in's, get one this
   * way. No email is sent: the administrator hands the password over, and the
   * user can replace it with `POST /me/password` once signed in.
   *
   * @param email as it arrived in the path, unvalidated.
   */
  async resetPassword(email: string, password: string): Promise<void> {
    const normalized = email.trim().toLowerCase();
    if (normalized.length > MAX_EMAIL_LENGTH || !isEmail(normalized)) {
      throw new BadRequestException('email must be an email address');
    }

    const user = await this.users.findByEmail(normalized);
    if (user === undefined) throw new NotFoundException(`No user with email ${normalized}`);

    // Hashed outside the transaction, as at sign-up.
    const passwordHash = await this.hasher.hash(password);
    await this.overwritePassword(user.id, passwordHash);

    this.logger.log(`An administrator reset the password of user ${user.id}`);
  }

  /** The account and its first session together, or neither. */
  @Transactional()
  private async register(
    input: CreateUserInput,
    userAgent: string | undefined,
  ): Promise<AuthSession> {
    const user = await this.users.create(input);
    return this.sessions.start(user, userAgent);
  }

  /**
   * Under the user's row lock, so two changes cannot both succeed: the second
   * finds a hash other than the one it verified.
   */
  @Transactional()
  private async replacePassword(
    userId: string,
    sessionId: string,
    verifiedHash: string,
    nextHash: string,
  ): Promise<void> {
    const user = await this.users.findForUpdate(userId);
    if (user?.passwordHash !== verifiedHash) {
      throw new ConflictException('The password changed while this request ran: try again');
    }

    // A revoked session's access token still verifies for a few minutes.
    await this.sessions.assertLive(sessionId, userId);

    await this.users.setPasswordHash(userId, nextHash);
    await this.sessions.endAll(userId, sessionId);
  }

  /**
   * The user's row lock makes a change the user makes at the same moment either
   * finish first or find the new hash and refuse.
   */
  @Transactional()
  private async overwritePassword(userId: string, passwordHash: string): Promise<void> {
    if ((await this.users.findForUpdate(userId)) === undefined) {
      throw new NotFoundException('The user no longer exists');
    }

    await this.users.setPasswordHash(userId, passwordHash);
    await this.sessions.endAll(userId);
  }
}
