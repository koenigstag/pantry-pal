import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HouseholdsRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
  Transactional,
  type LocationRow,
} from '@pantry-pal/db';
import {
  ITEM_EVENT_TYPE,
  MAX_LOCATIONS_PER_HOUSEHOLD,
  type PantryLocation,
} from '@pantry-pal/shared';
import type {
  CreateLocationDto,
  ReorderLocationsDto,
  UpdateLocationDto,
} from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { toPantryItem } from '../items/item.mapper';
import { ChangeFeed } from '../realtime/change-feed';
import { toPantryLocation } from './location.mapper';

/**
 * Any member may manage locations.
 *
 * Writes that depend on the set of locations as a whole — create (count and
 * next position), reorder, delete — lock the household row first, so they run
 * one at a time per household and never see each other's half-finished work.
 */
@Injectable()
export class LocationsService {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly locations: LocationsRepository,
    private readonly items: ItemsRepository,
    private readonly events: ItemEventsRepository,
    private readonly changes: ChangeFeed,
  ) {}

  async list(membership: Membership): Promise<PantryLocation[]> {
    const rows = await this.locations.list(membership.householdId);
    return rows.map(toPantryLocation);
  }

  async get(membership: Membership, id: string): Promise<PantryLocation> {
    return toPantryLocation(await this.findLocation(membership.householdId, id));
  }

  /** Appended after the last location. */
  @Transactional()
  async create(membership: Membership, dto: CreateLocationDto): Promise<PantryLocation> {
    await this.lockHousehold(membership.householdId);

    if ((await this.locations.count(membership.householdId)) >= MAX_LOCATIONS_PER_HOUSEHOLD) {
      throw new ConflictException(
        `A household can have at most ${MAX_LOCATIONS_PER_HOUSEHOLD} locations`,
      );
    }

    const row = await this.locations.create(membership.householdId, {
      name: dto.name,
      icon: dto.icon ?? null,
      sortOrder: await this.locations.nextSortOrder(membership.householdId),
    });

    const location = toPantryLocation(row);
    this.changes.publish({ type: 'location.created', location });
    return location;
  }

  async update(
    membership: Membership,
    id: string,
    dto: UpdateLocationDto,
  ): Promise<PantryLocation> {
    const patch = { name: dto.name, icon: dto.icon };
    const row = await this.locations.update(membership.householdId, id, patch);
    if (row === undefined) throw new NotFoundException('Location not found');

    const location = toPantryLocation(row);
    if (Object.values(patch).some((value) => value !== undefined)) {
      this.changes.publish({ type: 'location.updated', location });
    }
    return location;
  }

  /**
   * Replaces the whole order at once. `locationIds` must name every active
   * location of the household exactly once; the result is dense, 0..n-1.
   */
  @Transactional()
  async reorder(membership: Membership, dto: ReorderLocationsDto): Promise<PantryLocation[]> {
    await this.lockHousehold(membership.householdId);

    const current = await this.locations.list(membership.householdId);
    const currentIds = new Set(current.map((location) => location.id));
    const complete =
      dto.locationIds.length === currentIds.size &&
      dto.locationIds.every((id) => currentIds.has(id));

    if (!complete) {
      throw new BadRequestException(
        `locationIds must list each of the household's ${currentIds.size} locations exactly once`,
      );
    }

    await this.locations.setSortOrders(membership.householdId, dto.locationIds);

    const locations = (await this.locations.list(membership.householdId)).map(toPantryLocation);
    this.changes.publish({
      type: 'locations.reordered',
      householdId: membership.householdId,
      locations,
    });
    return locations;
  }

  /**
   * Soft-deletes a location.
   *
   * Active items have to go somewhere first: with `moveItemsTo` they are moved
   * (each move recorded in the item's history and broadcast); without it, a
   * location that still holds any is refused. Consumed and discarded items stay
   * put — history keeps the place things actually lived.
   */
  @Transactional()
  async remove(membership: Membership, id: string, moveItemsTo: string | undefined): Promise<void> {
    const { householdId } = membership;
    await this.lockHousehold(householdId);

    // Exclusive: waits out any item write that has this location share-locked,
    // and makes new ones wait until the delete commits.
    const location = await this.locations.lock(householdId, id, 'update');
    if (location === undefined) throw new NotFoundException('Location not found');

    let target: LocationRow | undefined;
    if (moveItemsTo !== undefined) {
      if (moveItemsTo === id) {
        throw new BadRequestException('moveItemsTo must be a different location');
      }
      target = await this.locations.lock(householdId, moveItemsTo, 'share');
      if (target === undefined) {
        throw new BadRequestException('moveItemsTo does not name a location in this household');
      }
    }

    const activeItems = await this.items.countActiveInLocation(householdId, id);

    if (activeItems > 0) {
      if (target === undefined) {
        throw new ConflictException(
          `"${location.name}" still holds ${activeItems} active item(s). ` +
            'Pass moveItemsTo to move them to another location first.',
        );
      }

      const targetId = target.id;
      const moved = await this.items.moveActive(householdId, id, targetId);
      await this.events.recordMany(
        moved.map((item) => ({
          householdId,
          itemId: item.id,
          userId: membership.userId,
          type: ITEM_EVENT_TYPE.Updated,
          payload: { changes: { locationId: { from: id, to: targetId } } },
        })),
      );
      for (const item of moved) {
        this.changes.publish({ type: 'item.updated', item: toPantryItem(item) });
      }
    }

    await this.locations.softDelete(householdId, id);
    this.changes.publish({ type: 'location.deleted', householdId, id });
  }

  private async lockHousehold(householdId: string): Promise<void> {
    if (!(await this.households.lock(householdId))) {
      throw new NotFoundException('Household not found');
    }
  }

  private async findLocation(householdId: string, id: string): Promise<LocationRow> {
    const row = await this.locations.findById(householdId, id);
    if (row === undefined) throw new NotFoundException('Location not found');
    return row;
  }
}
