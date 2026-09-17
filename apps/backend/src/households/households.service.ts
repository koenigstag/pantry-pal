import { Injectable, NotFoundException } from '@nestjs/common';
import {
  HouseholdMembersRepository,
  HouseholdsRepository,
  LocationsRepository,
  Transactional,
} from '@pantry-pal/db';
import { HOUSEHOLD_ROLE, type UserHousehold } from '@pantry-pal/shared';
import type { CreateHouseholdDto, UpdateHouseholdDto } from '@pantry-pal/shared/dto';

import type { AuthenticatedUser, Membership } from '../common/request-context';
import { DefaultLocationsService } from '../default-locations/default-locations.service';
import { ChangeFeed } from '../realtime/change-feed';
import { toHousehold, toHouseholdMember, toUserHousehold } from './household.mapper';

@Injectable()
export class HouseholdsService {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly members: HouseholdMembersRepository,
    private readonly locations: LocationsRepository,
    private readonly defaultLocations: DefaultLocationsService,
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
   * The creator becomes the owner, and the default storage spaces in force right
   * now are copied in, named in the creator's language, with the fallback
   * location among them. From then on they are the household's own: later
   * changes to the defaults do not reach it, and neither does a change of the
   * creator's language.
   */
  @Transactional()
  async create(user: AuthenticatedUser, dto: CreateHouseholdDto): Promise<UserHousehold> {
    const household = await this.households.create({ name: dto.name, createdBy: user.id });

    await this.members.add({
      householdId: household.id,
      userId: user.id,
      role: HOUSEHOLD_ROLE.Owner,
    });

    const defaults = await this.defaultLocations.forNewHousehold(user.locale);
    await this.locations.createMany(
      household.id,
      defaults.map(({ name, icon, isFallback }, index) => ({
        name,
        icon,
        isFallback,
        sortOrder: index,
      })),
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
