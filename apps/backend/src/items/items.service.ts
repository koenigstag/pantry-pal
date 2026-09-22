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
  SubItemsRepository,
  Transactional,
  UnitsRepository,
  type ItemRow,
  type NewUnitInput,
  type RecordEventInput,
  type SubItemRow,
  type UpdateItemInput,
  type UpdateSubItemInput,
} from '@pantry-pal/db';
import {
  COUNT_UNIT,
  DEFAULT_CATEGORY,
  DEFAULT_SHOPPING_ENTRY_QUANTITY,
  FULL_FILL_PERCENT,
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
  type NewSubItemDto,
  type UpdatePantryItemDto,
  type UpdateSubItemDto,
} from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { ChangeFeed } from '../realtime/change-feed';
import { toShoppingListEntry } from '../shopping-lists/shopping-list.mapper';
import { toPantryItem } from './item.mapper';

type ItemField = keyof UpdateItemInput;
type Changes = Partial<Record<ItemField, { from: unknown; to: unknown }>>;

/** What a write to one unit may change. */
type SubItemField = keyof UpdateSubItemInput;
type SubItemChangeLog = Partial<Record<SubItemField, { from: unknown; to: unknown }>>;

/**
 * Changes to an item's units, applied in this order: units added, units
 * changed, units deleted as mistakes.
 */
export interface SubItemChanges {
  add?: readonly NewSubItemDto[];
  update?: readonly { id: string; patch: UpdateSubItemDto }[];
  remove?: readonly string[];
}

/** A change to an item as a whole: its own fields, then its units. */
export interface ItemChanges {
  patch?: UpdatePantryItemDto;
  subItems?: SubItemChanges;
}

interface WriteOptions {
  /**
   * Whether an item that runs out goes on its default shopping list. The
   * offline mirror puts it there itself, and pushes that entry next.
   */
  listWhenRunOut?: boolean;
}

/** On the shelf with some left. Running out is leaving this state. */
const inStock = (row: ItemRow): boolean => row.status === ITEM_STATUS.Active && row.quantity > 0;

const SUB_ITEM_FIELDS = [
  'expiresAt',
  'openedAt',
  'periodAfterOpeningDays',
  'fillPercent',
  'status',
] as const satisfies readonly SubItemField[];

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
    private readonly subItems: SubItemsRepository,
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

  /**
   * With `subItems`, the item starts with those units, each as given; without,
   * with `quantity` units alike, each with the dates given.
   */
  @Transactional()
  async create(membership: Membership, dto: CreatePantryItemDto): Promise<PantryItem> {
    const { householdId } = membership;
    const sizeValue = dto.sizeValue ?? null;
    const sizeUnit = dto.sizeUnit ?? null;
    const defaultShoppingListId = dto.defaultShoppingListId ?? null;

    if (dto.subItems !== undefined) assertUnitsOnCreate(dto, dto.subItems);
    assertSizePair(sizeValue, sizeUnit);
    await this.assertUnits(dto.unit, sizeUnit);
    const isEdible = await this.resolveEdible(dto.category, dto.isEdible);
    await this.lockLocation(householdId, dto.locationId);
    if (defaultShoppingListId !== null) {
      await this.lockShoppingList(householdId, defaultShoppingListId);
    }

    const fields = {
      // The client's own id when it chose one (the offline mirror does); else the database's.
      id: dto.id,
      name: dto.name,
      locationId: dto.locationId,
      category: dto.category,
      isEdible,
      unit: dto.unit,
      sizeValue,
      sizeUnit,
      notes: dto.notes ?? null,
      defaultShoppingListId,
    };
    const row =
      dto.subItems === undefined
        ? await this.items.create(householdId, {
            ...fields,
            quantity: dto.quantity,
            expiresAt: dto.expiresAt ?? null,
            openedAt: dto.openedAt ?? null,
            periodAfterOpeningDays: dto.periodAfterOpeningDays ?? null,
          })
        : await this.items.createWithUnits(householdId, fields, dto.subItems.map(toNewUnitInput));

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
   * one the same patch names, if it names one — unless `listWhenRunOut` is
   * false: the offline mirror adds that entry itself, and pushes it next.
   */
  @Transactional()
  async update(
    membership: Membership,
    id: string,
    dto: UpdatePantryItemDto,
    { listWhenRunOut = true }: { listWhenRunOut?: boolean } = {},
  ): Promise<PantryItem> {
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

    if (listWhenRunOut && inStock(before) && !inStock(after)) {
      await this.putOnDefaultList(after, item);
    }
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
      ? {
          // Up to the limit, and never below what the item holds already: one filled
          // past today's limit before it was lowered would otherwise lose units.
          quantity: Math.max(
            before.quantity,
            Math.min(before.quantity + quantity, MAX_ITEM_QUANTITY),
          ),
        }
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
   * Changes an item's units one by one, each in a state of its own: units
   * added, changed (dates, how much is left, used up or thrown out) and deleted
   * as mistakes, in that order. Each change is recorded as an event naming its
   * unit; the item is announced once.
   *
   * An item holds at most `MAX_ITEM_QUANTITY` units on the shelf, and keeps at
   * least one unit whatever its status, so deleting the last is refused: delete
   * the item instead. Running out puts the item on its default list, as `update`
   * does.
   */
  @Transactional()
  async changeSubItems(
    membership: Membership,
    itemId: string,
    changes: SubItemChanges,
    { listWhenRunOut = true }: WriteOptions = {},
  ): Promise<PantryItem> {
    const { householdId } = membership;

    // The item's lock covers its units: every write to them takes it first.
    const before = await this.items.lock(householdId, itemId);
    if (before === undefined) throw new NotFoundException('Item not found');

    const events: RecordEventInput[] = [];
    const unitEvent = (
      subItemId: string,
      type: ItemEventType,
      quantityDelta: number | null,
      payload?: Record<string, unknown>,
    ): void => {
      events.push({
        householdId,
        itemId,
        subItemId,
        userId: membership.userId,
        type,
        quantityDelta,
        ...(payload !== undefined && { payload }),
      });
    };

    const added = changes.add ?? [];
    if (added.length > 0) {
      if (before.quantity + added.length > MAX_ITEM_QUANTITY) {
        throw new BadRequestException(
          `An item holds at most ${MAX_ITEM_QUANTITY} units: this one has ${before.quantity}`,
        );
      }
      for (const unit of added) assertFill(unit);
      const held = new Set(before.subItems.map((unit) => unit.id));
      const grown = await this.items.addUnits(householdId, itemId, added.map(toNewUnitInput));
      if (grown === undefined) throw new NotFoundException('Item not found');
      // The new ones are those it did not hold: the database named some of them.
      for (const unit of grown.subItems) {
        if (!held.has(unit.id)) unitEvent(unit.id, ITEM_EVENT_TYPE.Added, 1);
      }
    }

    // Unit after unit, in the order given, under the item's lock.
    for (const { id, patch } of changes.update ?? []) {
      // oxlint-disable-next-line no-await-in-loop
      const unit = await this.subItems.find(householdId, itemId, id);
      if (unit === undefined) throw new NotFoundException(`Item has no unit ${id}`);

      const write = subItemWrite(unit, patch);
      const changed = diffSubItem(unit, write);
      if (Object.keys(changed).length === 0) continue;
      assertFill({ ...unit, ...write });

      // oxlint-disable-next-line no-await-in-loop
      await this.subItems.update(householdId, itemId, id, write);
      const { type, quantityDelta } = subItemEventType(unit, write);
      unitEvent(id, type, quantityDelta, { changes: changed });
    }

    const removed = changes.remove ?? [];
    for (const id of removed) {
      // oxlint-disable-next-line no-await-in-loop
      const unit = await this.subItems.softDelete(householdId, itemId, id);
      if (unit === undefined) throw new NotFoundException(`Item has no unit ${id}`);
      unitEvent(id, ITEM_EVENT_TYPE.Deleted, unit.status === ITEM_STATUS.Active ? -1 : null);
    }
    if (removed.length > 0 && (await this.subItems.countLive(householdId, itemId)) === 0) {
      throw new ConflictException(
        `"${before.name}" keeps at least one unit: delete the item instead`,
      );
    }

    if (events.length === 0) return toPantryItem(before);

    const after = await this.items.findById(householdId, itemId);
    if (after === undefined) throw new NotFoundException('Item not found');

    await this.events.recordMany(events);

    const item = toPantryItem(after);
    this.changes.publish({ type: 'item.updated', item });

    if (listWhenRunOut && inStock(before) && !inStock(after)) {
      await this.putOnDefaultList(after, item);
    }
    return item;
  }

  /**
   * A change to an item and its units, all or nothing: its own fields as
   * `update` applies them, then its units as `changeSubItems` does.
   */
  @Transactional()
  async applyChanges(
    membership: Membership,
    id: string,
    { patch, subItems }: ItemChanges,
    options: WriteOptions = {},
  ): Promise<void> {
    if (patch !== undefined) await this.update(membership, id, patch, options);
    if (subItems !== undefined) await this.changeSubItems(membership, id, subItems, options);
  }

  /**
   * Creates an item and applies what has happened to it since, all or nothing:
   * how the server takes an item made offline and changed there before it could
   * be sent.
   */
  @Transactional()
  async createAndApply(
    membership: Membership,
    dto: CreatePantryItemDto,
    later: ItemChanges,
    options: WriteOptions = {},
  ): Promise<void> {
    const item = await this.create(membership, dto);
    await this.applyChanges(membership, item.id, later, options);
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
      DEFAULT_SHOPPING_ENTRY_QUANTITY,
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

/**
 * With `subItems`, the units are the item's quantity and hold its dates: the
 * count has to agree, and the item's own dates are left out.
 */
function assertUnitsOnCreate(dto: CreatePantryItemDto, units: readonly NewSubItemDto[]): void {
  if (dto.quantity !== units.length) {
    throw new BadRequestException(`quantity must be the number of subItems, ${units.length}`);
  }
  if (
    dto.expiresAt !== undefined ||
    dto.openedAt !== undefined ||
    dto.periodAfterOpeningDays !== undefined
  ) {
    throw new BadRequestException(
      'With subItems, leave out expiresAt, openedAt and periodAfterOpeningDays: each unit has its own',
    );
  }
  for (const unit of units) assertFill(unit);
}

/**
 * Mirrors `sub_items_fill_needs_opened`, so the client gets a message naming
 * its mistake rather than a constraint name: a unit below full has been opened.
 */
function assertFill(unit: { fillPercent?: number; openedAt?: string | null }): void {
  const fillPercent = unit.fillPercent ?? FULL_FILL_PERCENT;
  if (fillPercent < FULL_FILL_PERCENT && (unit.openedAt ?? null) === null) {
    throw new BadRequestException(
      'A unit that is not full has been opened: give the date it was opened (openedAt)',
    );
  }
}

function toNewUnitInput(unit: NewSubItemDto): NewUnitInput {
  return {
    ...(unit.id !== undefined && { id: unit.id }),
    expiresAt: unit.expiresAt ?? null,
    openedAt: unit.openedAt ?? null,
    periodAfterOpeningDays: unit.periodAfterOpeningDays ?? null,
    fillPercent: unit.fillPercent ?? FULL_FILL_PERCENT,
  };
}

/**
 * The fields a patch writes to a unit: those it sets. A unit no longer opened
 * is full again, unless the same patch says how full.
 */
function subItemWrite(unit: SubItemRow, patch: UpdateSubItemDto): UpdateSubItemInput {
  const write: UpdateSubItemInput = {};
  if (patch.expiresAt !== undefined) write.expiresAt = patch.expiresAt;
  if (patch.openedAt !== undefined) write.openedAt = patch.openedAt;
  if (patch.periodAfterOpeningDays !== undefined) {
    write.periodAfterOpeningDays = patch.periodAfterOpeningDays;
  }
  if (patch.fillPercent !== undefined) write.fillPercent = patch.fillPercent;
  if (patch.status !== undefined) write.status = patch.status;

  if (
    write.openedAt === null &&
    write.fillPercent === undefined &&
    unit.fillPercent < FULL_FILL_PERCENT
  ) {
    write.fillPercent = FULL_FILL_PERCENT;
  }
  return write;
}

/** What `write` changes on `unit`: each field as it was and as it will be. */
function diffSubItem(unit: SubItemRow, write: UpdateSubItemInput): SubItemChangeLog {
  const changes: SubItemChangeLog = {};

  for (const field of SUB_ITEM_FIELDS) {
    const to: unknown = write[field];
    if (to === undefined) continue;

    const from: unknown = unit[field];
    if (from !== to) changes[field] = { from, to };
  }

  return changes;
}

/**
 * The event a write to one unit records, ranked as an item's are: a status
 * change outranks opening, which outranks any other edit. Leaving the shelf
 * takes one off the quantity, and coming back puts one on.
 */
function subItemEventType(
  unit: SubItemRow,
  write: UpdateSubItemInput,
): { type: ItemEventType; quantityDelta: number | null } {
  if (write.status !== undefined && write.status !== unit.status) {
    if (write.status === ITEM_STATUS.Active) {
      return { type: ITEM_EVENT_TYPE.Restored, quantityDelta: 1 };
    }
    return {
      type:
        write.status === ITEM_STATUS.Consumed
          ? ITEM_EVENT_TYPE.Consumed
          : ITEM_EVENT_TYPE.Discarded,
      // Between two off-shelf statuses, nothing more leaves.
      quantityDelta: unit.status === ITEM_STATUS.Active ? -1 : null,
    };
  }
  if (unit.openedAt === null && typeof write.openedAt === 'string') {
    return { type: ITEM_EVENT_TYPE.Opened, quantityDelta: null };
  }
  return { type: ITEM_EVENT_TYPE.Updated, quantityDelta: null };
}
