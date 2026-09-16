import {
  BadRequestException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { HouseholdRole } from '@pantry-pal/shared';
import { isUUID } from 'class-validator';

import type { PantryRequest } from '../common/request-context';
import { MembershipService } from './membership.service';

const REQUIRED_ROLE_METADATA = 'pantry-pal:household-role';

/** Narrows `HouseholdAccessGuard` from "any member" to a specific role. */
export const RequireHouseholdRole = (role: HouseholdRole) =>
  SetMetadata(REQUIRED_ROLE_METADATA, role);

/**
 * Guards every route with a `:householdId` parameter: resolves the caller's
 * membership and exposes it through `@CurrentMembership()`.
 *
 * Runs after the global `AccessGuard`, which has already set `request.user`.
 */
@Injectable()
export class HouseholdAccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly membership: MembershipService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<PantryRequest>();
    if (request.user === undefined) throw new UnauthorizedException();

    // Guards run before pipes, so no ParseUUIDPipe has seen this yet — and a
    // malformed id would otherwise reach Postgres as a failed uuid cast.
    const householdId = request.params['householdId'];
    if (typeof householdId !== 'string' || !isUUID(householdId)) {
      throw new BadRequestException('Validation failed (uuid is expected)');
    }

    const requiredRole = this.reflector.getAllAndOverride<HouseholdRole | undefined>(
      REQUIRED_ROLE_METADATA,
      [context.getHandler(), context.getClass()],
    );

    request.membership = await this.membership.resolve(householdId, request.user.id, requiredRole);
    return true;
  }
}
