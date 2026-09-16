import { createHash, timingSafeEqual } from 'node:crypto';

import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { ADMIN_API_KEY_HEADER, DEV_USER_HEADER } from '@pantry-pal/shared';

import type { PantryRequest } from '../common/request-context';
import { ACCESS, ACCESS_METADATA, type Access } from './access.decorators';
import { IdentityService } from './identity.service';

/**
 * Registered globally, so every HTTP route authenticates unless it opts out
 * with `@Public()`. Forgetting a decorator fails closed.
 */
@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identity: IdentityService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
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
        request.user = await this.identity.authenticate(request.headers[DEV_USER_HEADER]);
        return true;
    }
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
