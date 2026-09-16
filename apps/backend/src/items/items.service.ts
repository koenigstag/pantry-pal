import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  CategoriesRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
  Transactional,
  UnitsRepository,
  type ItemRow,
  type RecordEventInput,
  type UpdateItemInput,
} from '@pantry-pal/db';
import {
  COUNT_UNIT,
  DEFAULT_CATEGORY,
  ITEM_EVENT_TYPE,
  ITEM_STATUS,
  QUANTITY_UNIT_KIND,
  type ItemEventType,
  type PantryItem,
} from '@pantry-pal/shared';
import {
  ITEM_STATUS_FILTER_ALL,
  type CreatePantryItemDto,
  type ListPantryItemsQueryDto,
  type UpdatePantryItemDto,
} from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { ChangeFeed } from '../realtime/change-feed';
import { toPantryItem } from './item.mapper';

type ItemField = keyof UpdateItemInput;
type Changes = Partial<Record<ItemField, { from: unknown; to: unknown }>>;

/**
 * Any member may manage items. Every write records an `item_events` row in the
 * same transaction and publishes the change once that transaction commits.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly items: ItemsRepository,
    private readonly events: ItemEventsRepository,
    private readonly locations: LocationsRepository,
    private readonly units: UnitsRepository,
    private readonly categories: CategoriesRepository,
    private readonly changes: ChangeFeed,
  ) {}

  /** Active items unless `status` says otherwise; most urgent first. */
  async list(membership: Membership, query: ListPantryItemsQueryDto): Promise<PantryItem[]> {
    const status =
      query.status === ITEM_STATUS_FILTER_ALL ? undefined : (query.status ?? ITEM_STATUS.Active);

    const rows = await this.items.list(membership.householdId, {
      status,
      locationId: query.locationId,
    });
    return rows.map(toPantryItem);
  }

  async get(membership: Membership, id: string): Promise<PantryItem> {
    const row = await this.items.findById(membership.householdId, id);
    if (row === undefined) throw new NotFoundException('Item not found');
    return toPantryItem(row);
  }

  @Transactional()
  async create(membership: Membership, dto: CreatePantryItemDto): Promise<PantryItem> {
    const { householdId } = membership;
    const sizeValue = dto.sizeValue ?? null;
    const sizeUnit = dto.sizeUnit ?? null;

    assertSizePair(sizeValue, sizeUnit);
    await this.assertUnits(dto.unit, sizeUnit);
    const isEdible = await this.resolveEdible(dto.category, dto.isEdible);
    await this.lockLocation(householdId, dto.locationId);

    const row = await this.items.create(householdId, {
      name: dto.name,
      locationId: dto.locationId,
      category: dto.category,
      isEdible,
      quantity: dto.quantity,
      unit: dto.unit,
      sizeValue,
      sizeUnit,
      expiresAt: dto.expiresAt ?? null,
      openedAt: dto.openedAt ?? null,
      periodAfterOpeningDays: dto.periodAfterOpeningDays ?? null,
      notes: dto.notes ?? null,
    });

    await this.events.record({
      householdId,
      itemId: row.id,
      userId: membership.userId,
      type: ITEM_EVENT_TYPE.Added,
      quantityDelta: row.quantity,
    });

    const item = toPantryItem(row);
    this.changes.publish({ type: 'item.created', item });
    return item;
  }

  /**
   * Applies only the fields present in `dto`, and records what actually
   * changed. A patch that changes nothing writes nothing and announces nothing.
   */
  @Transactional()
  async update(membership: Membership, id: string, dto: UpdatePantryItemDto): Promise<PantryItem> {
    const { householdId } = membership;

    // Locked, so the before/after recorded in the event is exactly what this
    // write did, even with another update to the same item racing it.
    const before = await this.items.lock(householdId, id);
    if (before === undefined) throw new NotFoundException('Item not found');

    const patch: UpdateItemInput = {
      name: dto.name,
      locationId: dto.locationId,
      category: dto.category,
      // Resolved whenever it could change: a category or a value was sent.
      isEdible:
        dto.category === undefined && dto.isEdible === undefined
          ? undefined
          : await this.resolveEdible(
              dto.category ?? before.category,
              dto.isEdible,
              before.isEdible,
            ),
      quantity: dto.quantity,
      unit: dto.unit,
      sizeValue: dto.sizeValue,
      sizeUnit: dto.sizeUnit,
      expiresAt: dto.expiresAt,
      openedAt: dto.openedAt,
      periodAfterOpeningDays: dto.periodAfterOpeningDays,
      notes: dto.notes,
      status: dto.status,
    };

    const changes = diff(before, patch);
    if (Object.keys(changes).length === 0) return toPantryItem(before);

    const sizeValue = patch.sizeValue === undefined ? before.sizeValue : patch.sizeValue;
    const sizeUnit = patch.sizeUnit === undefined ? before.sizeUnit : patch.sizeUnit;
    assertSizePair(sizeValue, sizeUnit);

    await this.assertUnits(changes.unit && patch.unit, changes.sizeUnit && sizeUnit);
    if (changes.locationId !== undefined && patch.locationId !== undefined) {
      await this.lockLocation(householdId, patch.locationId);
    }

    const after = await this.items.update(householdId, id, patch);
    if (after === undefined) throw new NotFoundException('Item not found');

    await this.events.record(eventFor(membership, before, after, changes));

    const item = toPantryItem(after);
    this.changes.publish({ type: 'item.updated', item });
    return item;
  }

  /**
   * Soft delete, for mistakes. Using an item up or throwing it away is a status
   * change (`consumed` / `discarded`), which is what waste statistics count.
   */
  @Transactional()
  async remove(membership: Membership, id: string): Promise<void> {
    const { householdId } = membership;

    const row = await this.items.softDelete(householdId, id);
    if (row === undefined) throw new NotFoundException('Item not found');

    await this.events.record({
      householdId,
      itemId: row.id,
      userId: membership.userId,
      type: ITEM_EVENT_TYPE.Deleted,
    });

    this.changes.publish({ type: 'item.deleted', householdId, id });
  }

  /**
   * Share-locks the location for the rest of the transaction, so a concurrent
   * location delete waits for this write rather than orphaning the item. A
   * location deleted a moment earlier is reported as missing.
   */
  private async lockLocation(householdId: string, locationId: string): Promise<void> {
    const location = await this.locations.lock(householdId, locationId, 'share');
    if (location === undefined) {
      throw new BadRequestException('locationId does not name a location in this household');
    }
  }

  /**
   * The `isEdible` an item in `categoryCode` gets: the category's, except in the
   * default category, where the item decides — `requested`, else what it had
   * (`current`), else the category's starting value. A different value for any
   * other category is refused rather than silently replaced.
   *
   * Share-locks the category, so an admin changing its `isEdible` waits for this
   * write and then updates the item with the rest. Also names an unknown
   * category, where `items_category_fk` would only name itself.
   */
  private async resolveEdible(
    categoryCode: string,
    requested: boolean | undefined,
    current?: boolean,
  ): Promise<boolean> {
    const category = await this.categories.lock(categoryCode, 'share');
    if (category === undefined) {
      throw new BadRequestException(`Unknown category code: ${categoryCode}`);
    }

    if (category.code === DEFAULT_CATEGORY) return requested ?? current ?? category.isEdible;

    if (requested !== undefined && requested !== category.isEdible) {
      throw new BadRequestException(
        `isEdible follows the category "${category.code}": only items in "${DEFAULT_CATEGORY}" set their own`,
      );
    }
    return category.isEdible;
  }

  /**
   * That the units exist, and that the quantity is counted in a count unit:
   * `2 kg` is refused, because `1 bag × 2 kg` is how that is said. Mirrors
   * `items_unit_count_fk`, so the client gets a message naming its mistake
   * rather than a constraint name. A unit left `undefined` is not being written.
   */
  private async assertUnits(
    unit: string | undefined,
    sizeUnit: string | null | undefined,
  ): Promise<void> {
    const codes = [unit, sizeUnit].filter((code): code is string => typeof code === 'string');
    if (codes.length === 0) return;

    const kinds = await this.units.findKinds(codes);
    const unknown = codes.filter((code) => !kinds.has(code));
    if (unknown.length > 0) {
      throw new BadRequestException(`Unknown unit code(s): ${unknown.join(', ')}`);
    }
    if (unit !== undefined && kinds.get(unit) !== QUANTITY_UNIT_KIND) {
      throw new BadRequestException(
        `unit must be a count unit such as "${COUNT_UNIT}", not "${unit}": a weight or volume goes in sizeValue and sizeUnit`,
      );
    }
  }
}

/**
 * Mirrors the `items_size_pair` constraint, so the client gets a message naming
 * its mistake rather than a constraint name.
 */
function assertSizePair(sizeValue: number | null, sizeUnit: string | null): void {
  if ((sizeValue === null) !== (sizeUnit === null)) {
    throw new BadRequestException('sizeValue and sizeUnit must be given together');
  }
}

function diff(before: ItemRow, patch: UpdateItemInput): Changes {
  const changes: Changes = {};

  for (const [field, to] of Object.entries(patch) as Array<[ItemField, unknown]>) {
    if (to === undefined) continue;

    const from: unknown = before[field];
    if (from !== to) changes[field] = { from, to };
  }

  return changes;
}

/**
 * One event per update, typed by the most significant thing that happened: a
 * status change outranks opening, which outranks any other edit. The payload
 * always carries every changed field, so nothing is lost to the precedence.
 */
function eventFor(
  membership: Membership,
  before: ItemRow,
  after: ItemRow,
  changes: Changes,
): RecordEventInput {
  let type: ItemEventType = ITEM_EVENT_TYPE.Updated;
  // Quantities are integers, so the difference is exact.
  let quantityDelta: number | null = after.quantity - before.quantity;

  const wasActive = before.status === ITEM_STATUS.Active;
  const isActive = after.status === ITEM_STATUS.Active;

  if (changes.status !== undefined) {
    if (isActive) {
      type = ITEM_EVENT_TYPE.Restored;
      quantityDelta = after.quantity;
    } else {
      type =
        after.status === ITEM_STATUS.Consumed
          ? ITEM_EVENT_TYPE.Consumed
          : ITEM_EVENT_TYPE.Discarded;
      // Leaving the shelf takes everything that was on it; moving between two
      // off-shelf statuses takes nothing more.
      quantityDelta = wasActive ? -before.quantity : null;
    }
  } else if (before.openedAt === null && after.openedAt !== null) {
    type = ITEM_EVENT_TYPE.Opened;
  }

  return {
    householdId: membership.householdId,
    itemId: after.id,
    userId: membership.userId,
    type,
    quantityDelta: quantityDelta === 0 ? null : quantityDelta,
    payload: { changes },
  };
}
