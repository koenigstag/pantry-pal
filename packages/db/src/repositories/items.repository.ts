import { ITEM_STATUS, type ItemStatus } from '@pantry-pal/shared';
import {
  and,
  asc,
  count,
  eq,
  getTableColumns,
  inArray,
  isNull,
  ne,
  sql,
  type SQL,
} from 'drizzle-orm';

import type { Database } from '../client';
import { items, type ItemRow, type NewItemRow } from '../schema';
import { syncStamp, syncWindowWhere, type SyncWindow, type WithSyncStamp } from './sync-window';

/**
 * Everything the caller supplies; tenancy and identity are applied by the
 * repository, and `unitKind` by the database.
 */
export type CreateItemInput = Omit<
  NewItemRow,
  'id' | 'householdId' | 'unitKind' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export type UpdateItemInput = Partial<CreateItemInput>;

export interface ListItemsFilter {
  /** Omit for every status. Soft-deleted rows are never listed. */
  status?: ItemStatus;
  locationId?: string;
}

/**
 * Plain class, no decorators: `apps/backend` bridges it into Nest DI with a
 * `useFactory`, which is what keeps this package free of `@nestjs/*`.
 *
 * `db` is the transactional proxy from `createTransactionalDatabase()`, so
 * these methods participate in an ambient transaction without knowing it — no
 * executor parameter is threaded through, and none should be added.
 */
export class ItemsRepository {
  constructor(private readonly db: Database) {}

  /**
   * Most urgent first.
   *
   * Ordered by `effective_expires_at`, never `expires_at` — an opened jar with a
   * short period-after-opening has to outrank its printed date. Postgres sorts
   * NULLs last on ASC, so items with no expiry fall to the bottom, matching
   * `sortByUrgency` in `@pantry-pal/shared`.
   */
  list(householdId: string, { status, locationId }: ListItemsFilter = {}): Promise<ItemRow[]> {
    const conditions: SQL[] = [eq(items.householdId, householdId), isNull(items.deletedAt)];
    if (status !== undefined) conditions.push(eq(items.status, status));
    if (locationId !== undefined) conditions.push(eq(items.locationId, locationId));

    return this.db
      .select()
      .from(items)
      .where(and(...conditions))
      .orderBy(asc(items.effectiveExpiresAt), asc(items.name), asc(items.id));
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
    return this.db
      .select({ ...getTableColumns(items), syncUpdatedAt: syncStamp(items.updatedAt) })
      .from(items)
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
    const [row] = await this.db.select().from(items).where(this.live(householdId, id)).limit(1);

    return row;
  }

  /** Items by id, whatever their status. Soft-deleted ones and ids of other households are left out. */
  findByIds(householdId: string, ids: readonly string[]): Promise<ItemRow[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this.db.select().from(items).where(this.liveIn(householdId, ids)).orderBy(asc(items.id));
  }

  /**
   * `findByIds`, row-locked until the transaction ends: `share` to keep items
   * from being deleted while entries naming them are written, `update` to
   * change them. Locked in id order, so two callers locking overlapping sets
   * cannot deadlock on each other.
   */
  lockMany(
    householdId: string,
    ids: readonly string[],
    strength: 'share' | 'update',
  ): Promise<ItemRow[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this.db
      .select()
      .from(items)
      .where(this.liveIn(householdId, ids))
      .orderBy(asc(items.id))
      .for(strength);
  }

  /**
   * Reads an item and row-locks it until the transaction ends, so a
   * read-compare-write (an update that records what changed) cannot interleave
   * with another one on the same item.
   */
  async lock(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [row] = await this.db
      .select()
      .from(items)
      .where(this.live(householdId, id))
      .for('update');

    return row;
  }

  async create(householdId: string, input: CreateItemInput): Promise<ItemRow> {
    const [row] = await this.db
      .insert(items)
      .values({ ...input, householdId })
      .returning();

    // `.returning()` on a single-row insert always yields one row; the guard is
    // for the type, not for a case that can happen.
    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

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

    const [row] = await this.db
      .update(items)
      .set(patch)
      .where(this.live(householdId, id))
      .returning();

    return row;
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
  clearDefaultShoppingList(householdId: string, listId: string): Promise<ItemRow[]> {
    return this.db
      .update(items)
      .set({ defaultShoppingListId: null })
      .where(and(eq(items.householdId, householdId), eq(items.defaultShoppingListId, listId)))
      .returning();
  }

  /** Soft delete: the row survives so the change still shows up in a delta sync. */
  async softDelete(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [row] = await this.db
      .update(items)
      .set({ deletedAt: sql`now()` })
      .where(this.live(householdId, id))
      .returning();

    return row;
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
  moveActive(
    householdId: string,
    fromLocationId: string,
    toLocationId: string,
  ): Promise<ItemRow[]> {
    return this.db
      .update(items)
      .set({ locationId: toLocationId })
      .where(this.activeIn(householdId, fromLocationId))
      .returning();
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
}
