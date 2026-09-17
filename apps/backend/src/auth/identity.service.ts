import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersRepository, type UserRow } from '@pantry-pal/db';
import { ACCESS_TOKEN_HANDSHAKE_KEY, DEV_USER_HEADER, MAX_EMAIL_LENGTH } from '@pantry-pal/shared';
import { isEmail } from 'class-validator';

import type { AuthenticatedUser } from '../common/request-context';
import { describeAccessTokenError, isAccessTokenClaims } from './session-tokens';
import { TokenSigner } from './token-signer';

export function toAuthenticatedUser(row: UserRow): AuthenticatedUser {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    unitSystem: row.unitSystem,
    timezone: row.timezone,
    locale: row.locale,
  };
}

/** A new account's display name when none is given: the part of the email before the `@`. */
export const displayNameFor = (email: string): string => email.slice(0, email.indexOf('@'));

/**
 * Decides who is calling.
 *
 * Normally from an access token: Passport verifies it for HTTP (`JwtStrategy`),
 * `verifyAccessToken` does for the socket handshake, and both end in
 * `userFromClaims`. With `DEV_AUTH=true` the `x-dev-user-email` header is
 * trusted as well, a stand-in kept until the frontend signs in for real.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly users: UsersRepository,
    private readonly tokens: TokenSigner,
    private readonly config: ConfigService,
  ) {}

  get devIdentityEnabled(): boolean {
    return this.config.get<boolean>('auth.devIdentity') === true;
  }

  /** The user an access token names, and its session. Passport covers HTTP; this covers sockets. */
  async verifyAccessToken(token: unknown): Promise<{ user: AuthenticatedUser; sessionId: string }> {
    if (typeof token !== 'string' || token === '') {
      throw new UnauthorizedException(
        `Sign in first: send an access token as the handshake's auth.${ACCESS_TOKEN_HANDSHAKE_KEY}`,
      );
    }

    let claims: unknown;
    try {
      claims = await this.tokens.verifyAccessToken(token);
    } catch (error) {
      throw new UnauthorizedException(describeAccessTokenError(error));
    }

    const user = await this.userFromClaims(claims);
    return { user, sessionId: (claims as { sid: string }).sid };
  }

  /** The user named by claims whose signature and expiry have been verified. */
  async userFromClaims(claims: unknown): Promise<AuthenticatedUser> {
    if (!isAccessTokenClaims(claims)) {
      throw new UnauthorizedException('The access token is invalid');
    }

    const row = await this.users.findById(claims.sub);
    if (row === undefined) {
      throw new UnauthorizedException('The access token names an account that no longer exists');
    }
    return toAuthenticatedUser(row);
  }

  /**
   * The development stand-in: the caller names themselves by email, and a
   * first-time email becomes a user on the spot.
   *
   * @param claim the `x-dev-user-email` header or handshake value, unvalidated.
   */
  async authenticateDevClaim(claim: unknown): Promise<AuthenticatedUser> {
    if (!this.devIdentityEnabled) {
      throw new UnauthorizedException(`${DEV_USER_HEADER} is accepted only with DEV_AUTH=true`);
    }

    const email = typeof claim === 'string' ? claim.trim().toLowerCase() : '';
    if (email.length > MAX_EMAIL_LENGTH || !isEmail(email)) {
      throw new UnauthorizedException(
        `Identify yourself with the ${DEV_USER_HEADER} header, set to an email address`,
      );
    }

    const user = await this.users.findOrCreateByEmail({
      email,
      displayName: displayNameFor(email),
    });
    return toAuthenticatedUser(user);
  }
}
