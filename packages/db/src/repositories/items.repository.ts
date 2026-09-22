import { ITEM_STATUS, type ItemStatus } from '@pantry-pal/shared';
import {
  and,
  asc,
  count,
  desc,
  eq,
  getTableColumns,
  inArray,
  isNotNull,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { Database } from '../client';
import {
  items,
  subItems,
  type NewItemRecord,
  type NewSubItemRow,
  type SubItemRow,
} from '../schema';
import { itemRowSelection, LEAD_UNIT_ORDER, type ItemRow, type ItemUnitState } from './item-rows';
import { syncStamp, syncWindowWhere, type SyncWindow, type WithSyncStamp } from './sync-window';

export type { ItemRow, ItemRowSubItem, ItemUnitState } from './item-rows';

/**
 * The item's own fields: everything the caller supplies but its units.
 * Tenancy and identity are applied by the repository, and `unitKind` by the
 * database.
 */
export type CreateItemFieldsInput = Omit<
  NewItemRecord,
  'householdId' | 'unitKind' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

/**
 * The item's fields, and its units as `quantity` and the dates: that many units
 * are created, each with those dates.
 */
export type CreateItemInput = CreateItemFieldsInput & Partial<ItemUnitState> & { quantity: number };

export type UpdateItemInput = Partial<CreateItemInput>;

/**
 * One unit with a state of its own, as an import brings them: unlike the units
 * `create` and `update` write, these need not match each other or the item's
 * lead unit. Written active.
 */
export interface NewUnitInput extends ItemUnitState {
  /**
   * Chosen by the client, which names units before the server has seen them:
   * the offline mirror does. Omitted, the database picks one.
   */
  id?: string;
  /** 1–100. Below 100 the unit must have been opened: see `sub_items_fill_needs_opened`. */
  fillPercent: number;
}

export interface ListItemsFilter {
  /** Omit for every status. Soft-deleted rows are never listed. */
  status?: ItemStatus;
  locationId?: string;
}

/** The unit fields an update may set on an item's units. */
const UNIT_STATE_FIELDS = ['expiresAt', 'openedAt', 'periodAfterOpeningDays'] as const;

/**
 * Which active units a lower quantity takes: the ones that should go first —
 * opened before unopened, then the soonest to expire, then the oldest.
 */
const CONSUME_ORDER = [
  sql`${subItems.openedAt} is null`,
  sql`${subItems.effectiveExpiresAt} asc nulls last`,
  asc(subItems.createdAt),
  asc(subItems.id),
];

/**
 * Whose printed date and period after opening the units a higher quantity adds
 * take: the newest active unit's, the last one bought — or, with none active,
 * the lead unit's, whose dates the item shows. `freshSubItemState` in
 * `@pantry-pal/shared` is the same rule, for the offline mirror.
 */
const FRESH_UNIT_SOURCE_ORDER = [
  sql`(${subItems.status} = ${ITEM_STATUS.Active}) desc`,
  sql`case when ${subItems.status} = ${ITEM_STATUS.Active} then ${subItems.createdAt} end desc nulls last`,
  desc(subItems.updatedAt),
  asc(subItems.id),
];

/**
 * Plain class, no decorators: `apps/backend` bridges it into Nest DI with a
 * `useFactory`, which is what keeps this package free of `@nestjs/*`.
 *
 * `db` is the transactional proxy from `createTransactionalDatabase()`, so
 * these methods participate in an ambient transaction without knowing it — no
 * executor parameter is threaded through, and none should be added.
 *
 * **Units.** An item's units are rows of `sub_items`. Every method here reads
 * and writes the item as a whole (`ItemRow`): a quantity and one set of dates,
 * with its active units beside them. Writing a quantity adds fresh units or
 * consumes the ones that should go first; writing dates sets them on every unit
 * on the shelf. `createWithUnits` and `addUnits` write units in states of their
 * own, as an import or the offline mirror brings them, and `SubItemsRepository`
 * changes them one at a time; the row then shows the lead unit's. Anything a unit
 * write changes also moves the item's `updated_at`, which is how a sync pull
 * finds it.
 */
export class ItemsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Most urgent first.
   *
   * Ordered by the lead unit's `effective_expires_at`, never `expires_at` — an
   * opened jar with a short period-after-opening has to outrank its printed
   * date. Postgres sorts NULLs last on ASC, so items with no expiry fall to the
   * bottom, matching `sortByUrgency` in `@pantry-pal/shared`.
   */
  list(householdId: string, { status, locationId }: ListItemsFilter = {}): Promise<ItemRow[]> {
    const conditions: SQL[] = [eq(items.householdId, householdId), isNull(items.deletedAt)];
    if (status !== undefined) conditions.push(eq(items.status, status));
    if (locationId !== undefined) conditions.push(eq(items.locationId, locationId));

    const { query, fields } = this.selectRows();
    return query
      .where(and(...conditions))
      .orderBy(asc(fields.effectiveExpiresAt), asc(items.name), asc(items.id));
  }

  /** The main list: what is on the shelves now. */
  listActive(householdId: string): Promise<ItemRow[]> {
    return this.list(householdId, { status: ITEM_STATUS.Active });
  }

  /**
   * Items changed since the checkpoint, in the order a sync pull walks them.
   * Every status, and soft-deleted rows too: those are the tombstones that tell
   * a client what to drop.
   */
  changedSince(householdId: string, window: SyncWindow): Promise<WithSyncStamp<ItemRow>[]> {
    const { activeUnits, leadUnit, fields } = itemRowSelection(this.db);

    return this.db
      .select({ ...fields, syncUpdatedAt: syncStamp(items.updatedAt) })
      .from(items)
      .leftJoinLateral(activeUnits, sql`true`)
      .leftJoinLateral(leadUnit, sql`true`)
      .where(
        and(
          eq(items.householdId, householdId),
          syncWindowWhere(items.updatedAt, items.id, window.after),
        ),
      )
      .orderBy(asc(items.updatedAt), asc(items.id))
      .limit(window.limit);
  }

  async findById(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [row] = await this.selectRows().query.where(this.live(householdId, id)).limit(1);

    return row;
  }

  /**
   * The row whatever its state, deleted included: a sync push compares against
   * it, and must tell an item deleted meanwhile from one that never existed.
   */
  async findAnyById(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [row] = await this.selectRows()
      .query.where(and(eq(items.householdId, householdId), eq(items.id, id)))
      .limit(1);

    return row;
  }

  /** Items by id, whatever their status. Soft-deleted ones and ids of other households are left out. */
  findByIds(householdId: string, ids: readonly string[]): Promise<ItemRow[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this.selectRows().query.where(this.liveIn(householdId, ids)).orderBy(asc(items.id));
  }

  /**
   * `findByIds`, row-locked until the transaction ends: `share` to keep items
   * from being deleted while entries naming them are written, `update` to
   * change them. Locked in id order, so two callers locking overlapping sets
   * cannot deadlock on each other.
   *
   * The `items` rows are locked first, alone — Postgres refuses `FOR UPDATE`
   * beside the aggregate an `ItemRow` is read with — and read after.
   */
  async lockMany(
    householdId: string,
    ids: readonly string[],
    strength: 'share' | 'update',
  ): Promise<ItemRow[]> {
    if (ids.length === 0) return [];

    await this.db
      .select({ id: items.id })
      .from(items)
      .where(this.liveIn(householdId, ids))
      .orderBy(asc(items.id))
      .for(strength);

    return this.findByIds(householdId, ids);
  }

  /**
   * Reads an item and row-locks it until the transaction ends, so a
   * read-compare-write (an update that records what changed) cannot interleave
   * with another one on the same item. Its units need no locks of their own:
   * every write to them comes through here, under this one.
   */
  async lock(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [locked] = await this.db
      .select({ id: items.id })
      .from(items)
      .where(this.live(householdId, id))
      .for('update');
    if (locked === undefined) return undefined;

    return this.findById(householdId, id);
  }

  /**
   * Creates the item and `quantity` units, each with the given dates. Creating
   * one needs a quantity of at least 1; at 0 the item still gets one unit,
   * consumed, to hold its dates — an item always has a unit to read them from.
   */
  async create(householdId: string, input: CreateItemInput): Promise<ItemRow> {
    const { quantity, expiresAt, openedAt, periodAfterOpeningDays, ...fields } = input;
    const id = await this.insertItem(householdId, fields);

    const state = {
      expiresAt: expiresAt ?? null,
      openedAt: openedAt ?? null,
      periodAfterOpeningDays: periodAfterOpeningDays ?? null,
    };
    if (quantity > 0) {
      await this.insertUnits(householdId, id, quantity, state);
    } else {
      await this.insertUnits(householdId, id, 1, state, ITEM_STATUS.Consumed);
    }

    return this.required(householdId, id);
  }

  /**
   * Creates the item with the units given, each in a state of its own: two
   * units of one thing can expire on different days, or one can be opened.
   * There must be at least one.
   */
  async createWithUnits(
    householdId: string,
    input: CreateItemFieldsInput,
    units: readonly NewUnitInput[],
  ): Promise<ItemRow> {
    if (units.length === 0) throw new Error('createWithUnits needs at least one unit');

    const id = await this.insertItem(householdId, input);
    await this.insertStatedUnits(householdId, id, units);

    return this.required(householdId, id);
  }

  /**
   * Adds units to a live item, each in a state of its own, and moves the item's
   * `updated_at`, which is how a sync pull finds it. `undefined` when the item
   * is not there.
   */
  async addUnits(
    householdId: string,
    id: string,
    units: readonly NewUnitInput[],
  ): Promise<ItemRow | undefined> {
    const [record] = await this.db
      .update(items)
      .set({ updatedAt: new Date() })
      .where(this.live(householdId, id))
      .returning({ id: items.id });
    if (record === undefined) return undefined;

    await this.insertStatedUnits(householdId, id, units);
    return this.findById(householdId, id);
  }

  /**
   * What is on the shelves, unit by unit: the active units of the household's
   * active items, grouped by item, oldest first within each.
   */
  listActiveUnits(householdId: string): Promise<SubItemRow[]> {
    return this.db
      .select(getTableColumns(subItems))
      .from(subItems)
      .innerJoin(items, eq(items.id, subItems.itemId))
      .where(
        and(
          eq(items.householdId, householdId),
          eq(items.status, ITEM_STATUS.Active),
          isNull(items.deletedAt),
          eq(subItems.status, ITEM_STATUS.Active),
          isNull(subItems.deletedAt),
        ),
      )
      .orderBy(asc(subItems.itemId), asc(subItems.createdAt), asc(subItems.id));
  }

  /**
   * Which of `ids` are units of this household, in any state: consumed, and
   * those of deleted items, count too. Every id must be a UUID.
   */
  async findUnitIds(householdId: string, ids: readonly string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();

    const rows = await this.db
      .select({ id: subItems.id })
      .from(subItems)
      .where(and(eq(subItems.householdId, householdId), inArray(subItems.id, [...ids])));

    return new Set(rows.map((row) => row.id));
  }

  /** Items by id whatever their state, soft-deleted ones included. Every id must be a UUID. */
  findAnyByIds(householdId: string, ids: readonly string[]): Promise<ItemRow[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this.selectRows()
      .query.where(and(eq(items.householdId, householdId), inArray(items.id, [...ids])))
      .orderBy(asc(items.id));
  }

  /**
   * Brings back a soft-deleted item, into `locationId` and with `status`, its
   * units as they were — for a restored backup that still holds it. `undefined`
   * when there is no such deleted item.
   */
  async undelete(
    householdId: string,
    id: string,
    patch: { locationId: string; status: ItemStatus },
  ): Promise<ItemRow | undefined> {
    const [record] = await this.db
      .update(items)
      .set({ ...patch, deletedAt: null, updatedAt: new Date() })
      .where(and(eq(items.householdId, householdId), eq(items.id, id), isNotNull(items.deletedAt)))
      .returning({ id: items.id });
    if (record === undefined) return undefined;

    return this.findById(householdId, id);
  }

  /**
   * Writes the item's own fields, then its units: `quantity` adds units, copies
   * of the lead unit, or consumes the ones that should go first; dates are set
   * on every active unit — or, with none left, on the lead unit, whose dates the
   * item shows. In that order, so a restock that sets a quantity and clears the
   * dates in one patch leaves every new unit without them.
   */
  async update(
    householdId: string,
    id: string,
    patch: UpdateItemInput,
  ): Promise<ItemRow | undefined> {
    // Drizzle throws "No values to set" on an empty SET, even though
    // `updated_at` has `$onUpdate`. An empty patch is a no-op, not an error.
    if (Object.values(patch).every((value) => value === undefined)) {
      return this.findById(householdId, id);
    }

    const { quantity, expiresAt, openedAt, periodAfterOpeningDays, ...fields } = patch;

    // Always written, units or not: `updated_at` has to move either way.
    const [record] = await this.db
      .update(items)
      .set({ ...fields, updatedAt: new Date() })
      .where(this.live(householdId, id))
      .returning({ id: items.id });
    if (record === undefined) return undefined;

    if (quantity !== undefined) await this.setQuantity(householdId, id, quantity);

    const state: Partial<ItemUnitState> = { expiresAt, openedAt, periodAfterOpeningDays };
    if (UNIT_STATE_FIELDS.some((field) => state[field] !== undefined)) {
      await this.setUnitState(householdId, id, state);
    }

    return this.findById(householdId, id);
  }

  /**
   * Sets `is_edible` on every item in a category, in every household — the one
   * write here that crosses tenants, because categories are global. Soft-deleted
   * and past items change too, so the rule holds for every row. Only rows that
   * differ are written, and their `updated_at` moves, so a delta sync picks them
   * up. Returns how many changed.
   */
  async setEdibleInCategory(category: string, isEdible: boolean): Promise<number> {
    const rows = await this.db
      .update(items)
      .set({ isEdible })
      .where(and(eq(items.category, category), ne(items.isEdible, isEdible)))
      .returning({ id: items.id });

    return rows.length;
  }

  /**
   * Clears a shopping list from every item that has it as its default, soft-deleted
   * and past items included — `items_default_shopping_list_household_fk` counts
   * them all — and returns the rows it changed. `updated_at` moves, so a delta
   * sync picks them up.
   */
  async clearDefaultShoppingList(householdId: string, listId: string): Promise<ItemRow[]> {
    const changed = await this.db
      .update(items)
      .set({ defaultShoppingListId: null })
      .where(and(eq(items.householdId, householdId), eq(items.defaultShoppingListId, listId)))
      .returning({ id: items.id });
    if (changed.length === 0) return [];

    return this.selectRows()
      .query.where(
        and(
          eq(items.householdId, householdId),
          inArray(
            items.id,
            changed.map((row) => row.id),
          ),
        ),
      )
      .orderBy(asc(items.id));
  }

  /** Soft delete: the row survives so the change still shows up in a delta sync. */
  async softDelete(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [record] = await this.db
      .update(items)
      .set({ deletedAt: sql`now()` })
      .where(this.live(householdId, id))
      .returning({ id: items.id });
    if (record === undefined) return undefined;

    return this.findAnyById(householdId, id);
  }

  async countActiveInLocation(householdId: string, locationId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(items)
      .where(this.activeIn(householdId, locationId));

    return row?.total ?? 0;
  }

  /**
   * Moves every active item from one location to another and returns the moved
   * rows. Consumed, discarded and soft-deleted rows stay where they were: they
   * are history, and history records where things actually lived.
   */
  async moveActive(
    householdId: string,
    fromLocationId: string,
    toLocationId: string,
  ): Promise<ItemRow[]> {
    const moved = await this.db
      .update(items)
      .set({ locationId: toLocationId })
      .where(this.activeIn(householdId, fromLocationId))
      .returning({ id: items.id });

    return this.findByIds(
      householdId,
      moved.map((row) => row.id),
    );
  }

  /** `SELECT` of `ItemRow`s, ready for a `WHERE`. */
  private selectRows() {
    const { activeUnits, leadUnit, fields } = itemRowSelection(this.db);

    const query = this.db
      .select(fields)
      .from(items)
      .leftJoinLateral(activeUnits, sql`true`)
      .leftJoinLateral(leadUnit, sql`true`)
      .$dynamic();

    return { query, fields };
  }

  /** An item this call just wrote: missing would be a bug, not a request to refuse. */
  private async required(householdId: string, id: string): Promise<ItemRow> {
    const row = await this.findAnyById(householdId, id);
    if (row === undefined) throw new Error(`Item ${id} vanished inside its own write`);
    return row;
  }

  /**
   * Makes the item's active units number `quantity`. New ones are fresh — just
   * bought: unopened and full, with the printed date and period after opening of
   * the newest unit (`FRESH_UNIT_SOURCE_ORDER`). Surplus ones are consumed, those
   * that should go first first.
   */
  private async setQuantity(householdId: string, itemId: string, quantity: number): Promise<void> {
    const active = await this.db
      .select({ id: subItems.id })
      .from(subItems)
      .where(this.activeUnitsOf(householdId, itemId))
      .orderBy(...CONSUME_ORDER);

    if (quantity > active.length) {
      const [source] = await this.db
        .select({
          expiresAt: subItems.expiresAt,
          periodAfterOpeningDays: subItems.periodAfterOpeningDays,
        })
        .from(subItems)
        .where(this.unitsOf(householdId, itemId))
        .orderBy(...FRESH_UNIT_SOURCE_ORDER)
        .limit(1);

      await this.insertUnits(householdId, itemId, quantity - active.length, {
        expiresAt: source?.expiresAt ?? null,
        openedAt: null,
        periodAfterOpeningDays: source?.periodAfterOpeningDays ?? null,
      });
      return;
    }

    if (quantity < active.length) {
      await this.db
        .update(subItems)
        .set({ status: ITEM_STATUS.Consumed })
        .where(
          inArray(
            subItems.id,
            active.slice(0, active.length - quantity).map((unit) => unit.id),
          ),
        );
    }
  }

  /**
   * Sets dates on every active unit. With none left, they go on the lead unit
   * instead — the unit the item shows its dates from — so editing the dates of
   * an item at quantity 0 still reads back as written.
   */
  private async setUnitState(
    householdId: string,
    itemId: string,
    state: Partial<ItemUnitState>,
  ): Promise<void> {
    const updated = await this.db
      .update(subItems)
      .set(state)
      .where(this.activeUnitsOf(householdId, itemId))
      .returning({ id: subItems.id });
    if (updated.length > 0) return;

    const [lead] = await this.db
      .select({ id: subItems.id })
      .from(subItems)
      .where(this.unitsOf(householdId, itemId))
      .orderBy(...LEAD_UNIT_ORDER)
      .limit(1);
    if (lead === undefined) return;

    await this.db.update(subItems).set(state).where(eq(subItems.id, lead.id));
  }

  /** The `items` row alone; its id, for the units that follow. */
  private async insertItem(householdId: string, fields: CreateItemFieldsInput): Promise<string> {
    const [record] = await this.db
      .insert(items)
      .values({ ...fields, householdId })
      .returning({ id: items.id });

    // `.returning()` on a single-row insert always yields one row; the guard is
    // for the type, not for a case that can happen.
    if (record === undefined) throw new Error('Insert returned no row');
    return record.id;
  }

  private async insertUnits(
    householdId: string,
    itemId: string,
    howMany: number,
    state: ItemUnitState & { fillPercent?: number },
    status: ItemStatus = ITEM_STATUS.Active,
  ): Promise<void> {
    const unit: NewSubItemRow = { householdId, itemId, ...state, status };
    await this.db.insert(subItems).values(Array.from({ length: howMany }, () => ({ ...unit })));
  }

  private async insertStatedUnits(
    householdId: string,
    itemId: string,
    units: readonly NewUnitInput[],
  ): Promise<void> {
    if (units.length === 0) return;

    await this.db.insert(subItems).values(
      units.map((unit): NewSubItemRow => ({
        ...(unit.id !== undefined && { id: unit.id }),
        householdId,
        itemId,
        expiresAt: unit.expiresAt,
        openedAt: unit.openedAt,
        periodAfterOpeningDays: unit.periodAfterOpeningDays,
        fillPercent: unit.fillPercent,
      })),
    );
  }

  private live(householdId: string, id: string) {
    return and(eq(items.householdId, householdId), eq(items.id, id), isNull(items.deletedAt));
  }

  private liveIn(householdId: string, ids: readonly string[]) {
    return and(
      eq(items.householdId, householdId),
      inArray(items.id, [...ids]),
      isNull(items.deletedAt),
    );
  }

  private activeIn(householdId: string, locationId: string) {
    return and(
      eq(items.householdId, householdId),
      eq(items.locationId, locationId),
      eq(items.status, ITEM_STATUS.Active),
      isNull(items.deletedAt),
    );
  }

  private unitsOf(householdId: string, itemId: string) {
    return and(
      eq(subItems.householdId, householdId),
      eq(subItems.itemId, itemId),
      isNull(subItems.deletedAt),
    );
  }

  private activeUnitsOf(householdId: string, itemId: string) {
    return and(this.unitsOf(householdId, itemId), eq(subItems.status, ITEM_STATUS.Active));
  }
}
