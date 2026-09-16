import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UsersRepository, type UserRow } from '@pantry-pal/db';
import { DEV_USER_HEADER, MAX_EMAIL_LENGTH } from '@pantry-pal/shared';
import { isEmail } from 'class-validator';

import type { AuthenticatedUser } from '../common/request-context';

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

/**
 * Decides who is calling.
 *
 * For now there is exactly one mechanism: with `DEV_AUTH=true`, the caller
 * names themselves by email and a first-time email becomes a user on the spot,
 * the way a first sign-in through an identity provider would. This is the seam
 * real authentication replaces — `AccessGuard` and the socket handshake both
 * call only `authenticate()`, so nothing downstream changes when it does.
 */
@Injectable()
export class IdentityService {
  constructor(
    private readonly users: UsersRepository,
    private readonly config: ConfigService,
  ) {}

  /** @param claim the `x-dev-user-email` header or handshake value, unvalidated. */
  async authenticate(claim: unknown): Promise<AuthenticatedUser> {
    if (this.config.get<boolean>('auth.devIdentity') !== true) {
      throw new UnauthorizedException(
        'No authentication is configured. For local development, set DEV_AUTH=true.',
      );
    }

    const email = typeof claim === 'string' ? claim.trim().toLowerCase() : '';
    if (email.length > MAX_EMAIL_LENGTH || !isEmail(email)) {
      throw new UnauthorizedException(
        `Identify yourself with the ${DEV_USER_HEADER} header, set to an email address`,
      );
    }

    const user = await this.users.findOrCreateByEmail({
      email,
      displayName: email.slice(0, email.indexOf('@')),
    });

    return toAuthenticatedUser(user);
  }
}
