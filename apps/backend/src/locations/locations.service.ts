import { randomUUID } from 'node:crypto';

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
  type LocationChange,
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
  UpsertLocationsDto,
} from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { toPantryItem } from '../items/item.mapper';
import { ChangeFeed } from '../realtime/change-feed';
import { toPantryLocation } from './location.mapper';

/**
 * Any member may manage locations.
 *
 * Writes that depend on the set of locations as a whole — create (count and
 * next position), reorder, upsert, delete — lock the household row first, so
 * they run one at a time per household and never see each other's
 * half-finished work.
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
   * Saves the locations editor: renames, new locations, deletions and the new
   * order, all or nothing, announced as one list. Returns every active
   * location in the new order.
   *
   * `locations` and `removed` together must name every active location exactly
   * once. An unknown or repeated id is a 400; a missing one is a 409, because
   * the client edited a list that has changed since it loaded it.
   */
  @Transactional()
  async upsert(membership: Membership, dto: UpsertLocationsDto): Promise<PantryLocation[]> {
    const { householdId } = membership;
    await this.lockHousehold(householdId);

    const current = new Map((await this.locations.list(householdId)).map((row) => [row.id, row]));
    const removals = dto.removed ?? [];
    const keptIds = dto.locations.flatMap((entry) => (entry.id === undefined ? [] : [entry.id]));
    const listed = new Set<string>();

    for (const id of [...keptIds, ...removals.map((removal) => removal.id)]) {
      if (listed.has(id)) throw new BadRequestException(`Location ${id} is listed more than once`);
      if (!current.has(id)) {
        throw new BadRequestException(`${id} does not name a location in this household`);
      }
      listed.add(id);
    }

    if (listed.size !== current.size) {
      throw new ConflictException(
        "The household's locations changed after this list was loaded. Reload them and try again.",
      );
    }

    // Deletions first: they free their names for the renames and additions below.
    for (const removal of removals) {
      if (removal.moveItemsTo !== undefined && !keptIds.includes(removal.moveItemsTo)) {
        throw new BadRequestException('moveItemsTo must name a location that is kept');
      }

      // One at a time on purpose: each waits out item writes into its location,
      // and every statement shares the transaction's connection anyway.
      // oxlint-disable-next-line no-await-in-loop
      await this.deleteLocation(membership, removal.id, removal.moveItemsTo);
    }

    const changes = dto.locations.flatMap((entry): LocationChange[] => {
      const row = entry.id === undefined ? undefined : current.get(entry.id);
      if (row === undefined) return [];

      const name = entry.name === row.name ? undefined : entry.name;
      const icon = entry.icon === undefined || entry.icon === row.icon ? undefined : entry.icon;
      return name === undefined && icon === undefined ? [] : [{ id: row.id, name, icon }];
    });
    await this.locations.updateMany(householdId, changes);

    // New locations get their ids here, so the whole order is known before the insert.
    const ordered = dto.locations.map((entry) => ({
      ...entry,
      isNew: entry.id === undefined,
      id: entry.id ?? randomUUID(),
    }));
    await this.locations.createAll(
      householdId,
      ordered.flatMap((entry, index) =>
        entry.isNew
          ? [{ id: entry.id, name: entry.name, icon: entry.icon ?? null, sortOrder: index }]
          : [],
      ),
    );
    await this.locations.setSortOrders(
      householdId,
      ordered.map((entry) => entry.id),
    );

    const locations = (await this.locations.list(householdId)).map(toPantryLocation);
    this.changes.publish({ type: 'locations.upserted', householdId, locations });
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

    await this.deleteLocation(membership, id, moveItemsTo);
    this.changes.publish({ type: 'location.deleted', householdId, id });
  }

  /**
   * Moves a location's active items to `moveItemsTo`, then soft-deletes it.
   * The caller holds the household lock and announces the deletion itself.
   */
  private async deleteLocation(
    membership: Membership,
    id: string,
    moveItemsTo: string | undefined,
  ): Promise<void> {
    const { householdId } = membership;

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
