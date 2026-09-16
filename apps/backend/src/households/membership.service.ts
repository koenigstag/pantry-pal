import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { HouseholdMembersRepository } from '@pantry-pal/db';
import { HOUSEHOLD_ROLE, type HouseholdRole } from '@pantry-pal/shared';

import type { Membership } from '../common/request-context';

export function assertRole(membership: Membership, required: HouseholdRole | undefined): void {
  if (required === HOUSEHOLD_ROLE.Owner && membership.role !== HOUSEHOLD_ROLE.Owner) {
    throw new ForbiddenException('Only a household owner can do this');
  }
}

/** The single membership check both transports go through. */
@Injectable()
export class MembershipService {
  constructor(private readonly members: HouseholdMembersRepository) {}

  /**
   * Resolves the user's membership of a household, optionally requiring a role.
   *
   * A non-member gets 404, not 403: the response must not reveal whether a
   * household with that id exists.
   */
  async resolve(
    householdId: string,
    userId: string,
    requiredRole?: HouseholdRole,
  ): Promise<Membership> {
    const role = await this.members.findRole(householdId, userId);
    if (role === undefined) throw new NotFoundException('Household not found');

    const membership: Membership = { householdId, userId, role };
    assertRole(membership, requiredRole);
    return membership;
  }
}
