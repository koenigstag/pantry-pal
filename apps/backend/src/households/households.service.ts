import { Injectable, NotFoundException } from '@nestjs/common';
import {
  HouseholdMembersRepository,
  HouseholdsRepository,
  LocationsRepository,
  Transactional,
} from '@pantry-pal/db';
import { APP_SETTING, HOUSEHOLD_ROLE, type UserHousehold } from '@pantry-pal/shared';
import type { CreateHouseholdDto, UpdateHouseholdDto } from '@pantry-pal/shared/dto';

import type { AuthenticatedUser, Membership } from '../common/request-context';
import { ChangeFeed } from '../realtime/change-feed';
import { SettingsService } from '../settings/settings.service';
import { toHousehold, toHouseholdMember, toUserHousehold } from './household.mapper';

@Injectable()
export class HouseholdsService {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly members: HouseholdMembersRepository,
    private readonly locations: LocationsRepository,
    private readonly settings: SettingsService,
    private readonly changes: ChangeFeed,
  ) {}

  async listForUser(userId: string): Promise<UserHousehold[]> {
    const rows = await this.households.listForUser(userId);
    return rows.map((row) => toUserHousehold(row, row.role));
  }

  async get(membership: Membership): Promise<UserHousehold> {
    const row = await this.households.findById(membership.householdId);
    // Deleted between the membership check and this read.
    if (row === undefined) throw new NotFoundException('Household not found');

    return toUserHousehold(row, membership.role);
  }

  /**
   * The creator becomes the owner, and the default locations in force right now
   * are copied in. Later changes to the defaults do not reach this household.
   */
  @Transactional()
  async create(user: AuthenticatedUser, dto: CreateHouseholdDto): Promise<UserHousehold> {
    const household = await this.households.create({ name: dto.name, createdBy: user.id });

    await this.members.add({
      householdId: household.id,
      userId: user.id,
      role: HOUSEHOLD_ROLE.Owner,
    });

    const defaults = await this.settings.get(APP_SETTING.DefaultLocations);
    await this.locations.createMany(
      household.id,
      defaults.locations.map(({ name, icon }, index) => ({ name, icon, sortOrder: index })),
    );

    const owner = await this.members.find(household.id, user.id);
    if (owner !== undefined) {
      // Moves the creator's open sockets into the new household's room.
      this.changes.publish({ type: 'member.added', member: toHouseholdMember(owner) });
    }

    return toUserHousehold(household, HOUSEHOLD_ROLE.Owner);
  }

  async rename(membership: Membership, dto: UpdateHouseholdDto): Promise<UserHousehold> {
    const row = await this.households.rename(membership.householdId, dto.name);
    if (row === undefined) throw new NotFoundException('Household not found');

    this.changes.publish({ type: 'household.updated', household: toHousehold(row) });
    return toUserHousehold(row, membership.role);
  }

  /** Irreversible: members, locations, items and their history cascade with it. */
  async remove(membership: Membership): Promise<void> {
    const row = await this.households.delete(membership.householdId);
    if (row === undefined) throw new NotFoundException('Household not found');

    this.changes.publish({ type: 'household.deleted', householdId: membership.householdId });
  }
}
