import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import {
  HouseholdMembersRepository,
  HouseholdsRepository,
  Transactional,
  UsersRepository,
  type HouseholdMemberWithUserRow,
} from '@pantry-pal/db';
import { HOUSEHOLD_ROLE, type HouseholdMember, type HouseholdRole } from '@pantry-pal/shared';
import type { AddHouseholdMemberDto, UpdateHouseholdMemberDto } from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { ChangeFeed } from '../realtime/change-feed';
import { toHouseholdMember } from './household.mapper';
import { assertRole } from './membership.service';

/**
 * Invariant: every household keeps at least one owner.
 *
 * Every write here first locks the household row, then re-reads what it
 * decides on. Checking "is this the last owner?" without the lock would let two
 * owners demote each other concurrently, each still seeing two owners.
 */
@Injectable()
export class MembersService {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly members: HouseholdMembersRepository,
    private readonly users: UsersRepository,
    private readonly changes: ChangeFeed,
  ) {}

  async list(membership: Membership): Promise<HouseholdMember[]> {
    const rows = await this.members.list(membership.householdId);
    return rows.map(toHouseholdMember);
  }

  async get(membership: Membership, userId: string): Promise<HouseholdMember> {
    return toHouseholdMember(await this.findMember(membership.householdId, userId));
  }

  /** Owners only. The user must exist already — there is no invitation flow yet. */
  @Transactional()
  async add(membership: Membership, dto: AddHouseholdMemberDto): Promise<HouseholdMember> {
    await this.lockAs(membership, HOUSEHOLD_ROLE.Owner);

    const user = await this.users.findByEmail(dto.email);
    if (user === undefined) {
      throw new NotFoundException(
        `No user with email ${dto.email}. They need to sign in once before they can be added.`,
      );
    }
    if ((await this.members.findRole(membership.householdId, user.id)) !== undefined) {
      throw new ConflictException('That user is already a member of this household');
    }

    await this.members.add({
      householdId: membership.householdId,
      userId: user.id,
      role: dto.role ?? HOUSEHOLD_ROLE.Member,
    });

    const member = toHouseholdMember(await this.findMember(membership.householdId, user.id));
    this.changes.publish({ type: 'member.added', member });
    return member;
  }

  /** Owners only. Demoting the last owner is refused. */
  @Transactional()
  async updateRole(
    membership: Membership,
    userId: string,
    dto: UpdateHouseholdMemberDto,
  ): Promise<HouseholdMember> {
    await this.lockAs(membership, HOUSEHOLD_ROLE.Owner);

    const current = await this.findMember(membership.householdId, userId);
    if (current.role === dto.role) return toHouseholdMember(current);

    if (current.role === HOUSEHOLD_ROLE.Owner) {
      await this.assertAnotherOwner(membership.householdId);
    }

    await this.members.updateRole(membership.householdId, userId, dto.role);

    const member = toHouseholdMember({ ...current, role: dto.role });
    this.changes.publish({ type: 'member.updated', member });
    return member;
  }

  /**
   * An owner can remove anyone; any member can remove themselves, which is how
   * leaving works. The last owner cannot leave — they promote someone first, or
   * delete the household.
   */
  @Transactional()
  async remove(membership: Membership, userId: string): Promise<void> {
    const isSelf = userId === membership.userId;
    await this.lockAs(membership, isSelf ? undefined : HOUSEHOLD_ROLE.Owner);

    const current = await this.findMember(membership.householdId, userId);
    if (current.role === HOUSEHOLD_ROLE.Owner) {
      await this.assertAnotherOwner(membership.householdId);
    }

    await this.members.remove(membership.householdId, userId);
    this.changes.publish({ type: 'member.removed', householdId: membership.householdId, userId });
  }

  /**
   * Locks the household, then re-checks the caller's own role under the lock:
   * the membership resolved by the guard may be stale by the time the lock is
   * granted (an owner demoted a moment ago must not act as one).
   */
  private async lockAs(
    membership: Membership,
    requiredRole: HouseholdRole | undefined,
  ): Promise<void> {
    if (!(await this.households.lock(membership.householdId))) {
      throw new NotFoundException('Household not found');
    }

    const role = await this.members.findRole(membership.householdId, membership.userId);
    if (role === undefined) throw new NotFoundException('Household not found');

    assertRole({ ...membership, role }, requiredRole);
  }

  private async assertAnotherOwner(householdId: string): Promise<void> {
    if ((await this.members.countOwners(householdId)) <= 1) {
      throw new ConflictException(
        'A household must keep at least one owner. Promote another member first, or delete the household.',
      );
    }
  }

  private async findMember(
    householdId: string,
    userId: string,
  ): Promise<HouseholdMemberWithUserRow> {
    const row = await this.members.find(householdId, userId);
    if (row === undefined) throw new NotFoundException('Member not found');
    return row;
  }
}
