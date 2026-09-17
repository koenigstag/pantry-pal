import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  CategoriesRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
  ShoppingListEntriesRepository,
  ShoppingListsRepository,
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
  MAX_ITEM_QUANTITY,
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
import { toShoppingListEntry } from '../shopping-lists/shopping-list.mapper';
import { toPantryItem } from './item.mapper';

type ItemField = keyof UpdateItemInput;
type Changes = Partial<Record<ItemField, { from: unknown; to: unknown }>>;

/** How many of an item go on its default shopping list when it runs out. */
const RAN_OUT_QUANTITY = 1;

/** On the shelf with some left. Running out is leaving this state. */
const inStock = (row: ItemRow): boolean => row.status === ITEM_STATUS.Active && row.quantity > 0;

/**
 * Any member may manage items. Every write records an `item_events` row in the
 * same transaction and publishes the change once that transaction commits.
 *
 * An item that runs out — used up, thrown out, or stepped down to zero — goes
 * on its default shopping list in the same transaction. Deleting one, a
 * correction, takes it off every list instead.
 *
 * Locks are taken items first, then shopping lists, then list entries: the
 * order `ShoppingListsService` keeps too, so the two cannot deadlock.
 */
@Injectable()
export class ItemsService {
  constructor(
    private readonly items: ItemsRepository,
    private readonly events: ItemEventsRepository,
    private readonly locations: LocationsRepository,
    private readonly units: UnitsRepository,
    private readonly categories: CategoriesRepository,
    private readonly shoppingLists: ShoppingListsRepository,
    private readonly shoppingEntries: ShoppingListEntriesRepository,
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
    const defaultShoppingListId = dto.defaultShoppingListId ?? null;

    assertSizePair(sizeValue, sizeUnit);
    await this.assertUnits(dto.unit, sizeUnit);
    const isEdible = await this.resolveEdible(dto.category, dto.isEdible);
    await this.lockLocation(householdId, dto.locationId);
    if (defaultShoppingListId !== null) {
      await this.lockShoppingList(householdId, defaultShoppingListId);
    }

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
      defaultShoppingListId,
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
   *
   * A patch that runs the item out puts it on its default shopping list — the
   * one the same patch names, if it names one.
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
      defaultShoppingListId: dto.defaultShoppingListId,
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
    if (
      changes.defaultShoppingListId !== undefined &&
      typeof patch.defaultShoppingListId === 'string'
    ) {
      await this.lockShoppingList(householdId, patch.defaultShoppingListId);
    }

    const after = await this.items.update(householdId, id, patch);
    if (after === undefined) throw new NotFoundException('Item not found');

    await this.events.record(eventFor(membership, before, after, changes));

    const item = toPantryItem(after);
    this.changes.publish({ type: 'item.updated', item });

    if (inStock(before) && !inStock(after)) await this.putOnDefaultList(after, item);
    return item;
  }

  /**
   * Brings `quantity` of an item home, as putting the shopping away does.
   *
   * An item still in stock gains them, up to the quantity limit. One that ran
   * out starts over as a new batch: active again, holding just these, with the
   * old batch's dates cleared, and in the fallback location if its own was
   * deleted meanwhile. Recorded and announced like any update.
   */
  @Transactional()
  async restock(membership: Membership, id: string, quantity: number): Promise<PantryItem> {
    const { householdId } = membership;

    const before = await this.items.lock(householdId, id);
    if (before === undefined) throw new NotFoundException('Item not found');

    const patch: UpdateItemInput = inStock(before)
      ? { quantity: Math.min(before.quantity + quantity, MAX_ITEM_QUANTITY) }
      : {
          status: ITEM_STATUS.Active,
          quantity,
          expiresAt: null,
          openedAt: null,
          locationId: await this.shelfFor(before),
        };

    const changes = diff(before, patch);
    if (Object.keys(changes).length === 0) return toPantryItem(before);

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
   * A deleted item leaves every shopping list it was on.
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
    const entries = await this.shoppingEntries.deleteForItem(householdId, id);

    this.changes.publish({ type: 'item.deleted', householdId, id });
    if (entries.length > 0) {
      this.changes.publish({
        type: 'shopping-list-entries.deleted',
        householdId,
        ids: entries.map((entry) => entry.id),
      });
    }
  }

  /**
   * Puts an item that just ran out on its default shopping list, if it has one.
   * Already on that list, it stays as it is: quantity, tick and all.
   */
  private async putOnDefaultList(after: ItemRow, item: PantryItem): Promise<void> {
    const { householdId, defaultShoppingListId: listId } = after;
    if (listId === null) return;

    // Shared, as when the default was set. The list cannot be gone — its delete
    // clears this item's default first, and waits for the item's lock to do so.
    // An archived list is frozen: the item keeps it as its default, and goes nowhere.
    const list = await this.shoppingLists.lock(householdId, listId, 'share');
    if (list === undefined || list.archivedAt !== null) return;

    const entries = await this.shoppingEntries.addMissing(
      householdId,
      listId,
      [after.id],
      RAN_OUT_QUANTITY,
    );
    if (entries.length === 0) return;

    this.changes.publish({
      type: 'shopping-list-entries.upserted',
      householdId,
      entries: entries.map(toShoppingListEntry),
      items: [item],
    });
  }

  /**
   * Where an item that ran out goes back on the shelf: the location it was in,
   * share-locked like any location an item is filed under, or the household's
   * fallback location if that one has been deleted since.
   */
  private async shelfFor(item: ItemRow): Promise<string> {
    const own = await this.locations.lock(item.householdId, item.locationId, 'share');
    if (own !== undefined) return own.id;

    const fallback = await this.locations.lockFallback(item.householdId);
    if (fallback === undefined) {
      // Only a household created without one: every new household gets it.
      throw new ConflictException(
        `"${item.name}" was in a location that has since been deleted, and the household has ` +
          'no fallback location to put it back in.',
      );
    }
    return fallback.id;
  }

  /**
   * Share-locks the shopping list an item is about to name as its default, so a
   * concurrent delete of that list waits for this write. A list that does not
   * exist, or belongs to another household, is reported as missing; an archived
   * one is frozen, so nothing may start going on it.
   */
  private async lockShoppingList(householdId: string, listId: string): Promise<void> {
    const list = await this.shoppingLists.lock(householdId, listId, 'share');
    if (list === undefined) {
      throw new BadRequestException(
        'defaultShoppingListId does not name a shopping list in this household',
      );
    }
    if (list.archivedAt !== null) {
      throw new BadRequestException(
        `defaultShoppingListId names "${list.name}", which is archived: restore it first`,
      );
    }
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
