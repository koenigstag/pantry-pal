import {
  createParamDecorator,
  InternalServerErrorException,
  type ExecutionContext,
} from '@nestjs/common';
import type { CurrentUser as CurrentUserResponse, HouseholdRole } from '@pantry-pal/shared';
import type { Request } from 'express';

/** The caller, as resolved by `AccessGuard`. The same shape `GET /me` returns. */
export type AuthenticatedUser = CurrentUserResponse;

/**
 * A verified membership: `userId` belongs to `householdId` with `role`.
 *
 * Household-scoped service methods take this instead of a bare household id,
 * so they cannot be reached without the membership check having run —
 * `HouseholdAccessGuard` for HTTP, `MembershipService.resolve()` for sockets.
 */
export interface Membership {
  readonly householdId: string;
  readonly userId: string;
  readonly role: HouseholdRole;
}

export interface PantryRequest extends Request {
  user?: AuthenticatedUser;
  membership?: Membership;
}

/** The authenticated caller. Only valid on routes that are not `@Public()` or `@AdminOnly()`. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedUser => {
    const { user } = context.switchToHttp().getRequest<PantryRequest>();
    if (user === undefined) {
      throw new InternalServerErrorException(
        '@CurrentUser() used on a route that does not authenticate a user',
      );
    }
    return user;
  },
);

/** The caller's verified membership. Only valid behind `HouseholdAccessGuard`. */
export const CurrentMembership = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Membership => {
    const { membership } = context.switchToHttp().getRequest<PantryRequest>();
    if (membership === undefined) {
      throw new InternalServerErrorException(
        '@CurrentMembership() used on a route without HouseholdAccessGuard',
      );
    }
    return membership;
  },
);
