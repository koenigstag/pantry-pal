import { createHash, timingSafeEqual } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { ADMIN_API_KEY_HEADER } from '@pantry-pal/shared';

import type { PantryRequest } from '../common/request-context';
import { ACCESS, ACCESS_METADATA, type Access } from './access.decorators';
import { JWT_STRATEGY } from './jwt.strategy';
import { describeAccessTokenError } from './session-tokens';

/**
 * Registered globally, so every HTTP route authenticates unless it opts out
 * with `@Public()`. Forgetting a decorator fails closed.
 *
 * A user route needs an access token, which Passport's JWT strategy verifies.
 */
@Injectable()
export class AccessGuard extends AuthGuard(JWT_STRATEGY) {
  constructor(
    private readonly reflector: Reflector,
    private readonly config: ConfigService,
  ) {
    super();
  }

  override async canActivate(context: ExecutionContext): Promise<boolean> {
    // Sockets authenticate once, in the gateway's handshake middleware.
    if (context.getType() !== 'http') return true;

    const access =
      this.reflector.getAllAndOverride<Access | undefined>(ACCESS_METADATA, [
        context.getHandler(),
        context.getClass(),
      ]) ?? ACCESS.User;
    const request = context.switchToHttp().getRequest<PantryRequest>();

    switch (access) {
      case ACCESS.Public:
        return true;

      case ACCESS.Admin:
        this.assertAdminKey(request.headers[ADMIN_API_KEY_HEADER]);
        return true;

      case ACCESS.User:
        return (await super.canActivate(context)) as boolean;
    }
  }

  /**
   * Passport's verdict. `error` is what `JwtStrategy.validate` threw; `info` is
   * why no token verified: missing, expired or malformed.
   */
  override handleRequest<TUser>(error: unknown, user: unknown, info: unknown): TUser {
    if (error) throw error;
    if (!user) throw new UnauthorizedException(describeAccessTokenError(info));
    return user as TUser;
  }

  private assertAdminKey(presented: string | string[] | undefined): void {
    const expected = this.config.get<string>('admin.apiKey');

    if (expected === undefined) {
      throw new ForbiddenException('The admin API is disabled: ADMIN_API_KEY is not set');
    }
    if (typeof presented !== 'string' || !constantTimeEquals(presented, expected)) {
      throw new UnauthorizedException(`Missing or invalid ${ADMIN_API_KEY_HEADER} header`);
    }
  }
}

const sha256 = (value: string): Buffer => createHash('sha256').update(value).digest();

/**
 * Hashing first gives both sides the same length, which `timingSafeEqual`
 * requires — and comparing lengths up front would leak the key's length.
 */
function constantTimeEquals(presented: string, expected: string): boolean {
  return timingSafeEqual(sha256(presented), sha256(expected));
}
