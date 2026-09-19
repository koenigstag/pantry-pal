import { and, asc, eq, getTableColumns, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { shoppingListEntries, type ShoppingListEntryRow } from '../schema';
import { syncStamp, syncWindowWhere, type SyncWindow, type WithSyncStamp } from './sync-window';

/** An omitted field is left alone. */
export interface UpdateShoppingListEntryInput {
  quantity?: number;
  /** Ticks the entry off, stamped with the database's clock, or unticks it. */
  checked?: boolean;
}

/**
 * The items on a household's shopping lists. Every method is scoped by
 * household; those that act on one entry are scoped by its list too, so an id
 * from another list is never found.
 *
 * Entries are soft-deleted. Every read here leaves the deleted ones out;
 * `changedSince` is the one exception, since they are what tells a syncing
 * client that an entry is off its list.
 */
export class ShoppingListEntriesRepository {
  constructor(private readonly db: Database) {}

  /** Every entry of the household, oldest first: the order they were added in. */
  listForHousehold(householdId: string): Promise<ShoppingListEntryRow[]> {
    return this.db
      .select()
      .from(shoppingListEntries)
      .where(and(eq(shoppingListEntries.householdId, householdId), this.live()))
      .orderBy(asc(shoppingListEntries.createdAt), asc(shoppingListEntries.id));
  }

  /**
   * Entries changed since the checkpoint, deleted ones included, in the order a
   * sync pull walks them.
   */
  changedSince(
    householdId: string,
    window: SyncWindow,
  ): Promise<WithSyncStamp<ShoppingListEntryRow>[]> {
    return this.db
      .select({
        ...getTableColumns(shoppingListEntries),
        syncUpdatedAt: syncStamp(shoppingListEntries.updatedAt),
      })
      .from(shoppingListEntries)
      .where(
        and(
          eq(shoppingListEntries.householdId, householdId),
          syncWindowWhere(shoppingListEntries.updatedAt, shoppingListEntries.id, window.after),
        ),
      )
      .orderBy(asc(shoppingListEntries.updatedAt), asc(shoppingListEntries.id))
      .limit(window.limit);
  }

  /**
   * The entry whatever its state, deleted included: a sync push compares
   * against it, and must tell an entry removed meanwhile from an unknown one.
   */
  async findAnyById(householdId: string, id: string): Promise<ShoppingListEntryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(shoppingListEntries)
      .where(and(eq(shoppingListEntries.householdId, householdId), eq(shoppingListEntries.id, id)))
      .limit(1);

    return row;
  }

  /** Entries of one list, by id. Ids not on it are left out. */
  findMany(
    householdId: string,
    listId: string,
    ids: readonly string[],
  ): Promise<ShoppingListEntryRow[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this.db
      .select()
      .from(shoppingListEntries)
      .where(and(this.onList(householdId, listId), inArray(shoppingListEntries.id, [...ids])))
      .orderBy(asc(shoppingListEntries.id));
  }

  /** `findMany`, row-locked until the transaction ends, in id order. */
  lockMany(
    householdId: string,
    listId: string,
    ids: readonly string[],
  ): Promise<ShoppingListEntryRow[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this.db
      .select()
      .from(shoppingListEntries)
      .where(and(this.onList(householdId, listId), inArray(shoppingListEntries.id, [...ids])))
      .orderBy(asc(shoppingListEntries.id))
      .for('update');
  }

  /**
   * Puts items on a list with `quantity` each, skipping any already on it, and
   * returns only the entries it created. One statement, so a concurrent add of
   * the same item cannot fail on the unique index — which counts entries still
   * on the list, so an item taken off can go back on as a new row.
   */
  addMissing(
    householdId: string,
    listId: string,
    itemIds: readonly string[],
    quantity: number,
  ): Promise<ShoppingListEntryRow[]> {
    if (itemIds.length === 0) return Promise.resolve([]);

    return this.db
      .insert(shoppingListEntries)
      .values(itemIds.map((itemId) => ({ householdId, listId, itemId, quantity })))
      .onConflictDoNothing({
        target: [shoppingListEntries.listId, shoppingListEntries.itemId],
        // The index's own predicate: Postgres infers a partial index only with it.
        where: sql`deleted_at is null`,
      })
      .returning();
  }

  /**
   * Puts one item on a list under the id the client chose, unless it is on the
   * list already, in which case nothing is written and `undefined` comes back.
   */
  async addOne(
    householdId: string,
    listId: string,
    entry: { id: string; itemId: string; quantity: number },
  ): Promise<ShoppingListEntryRow | undefined> {
    const [row] = await this.db
      .insert(shoppingListEntries)
      .values({ ...entry, householdId, listId })
      .onConflictDoNothing({
        target: [shoppingListEntries.listId, shoppingListEntries.itemId],
        where: sql`deleted_at is null`,
      })
      .returning();

    return row;
  }

  /** An empty patch is a no-op: Drizzle throws on an empty SET. */
  async update(
    householdId: string,
    listId: string,
    id: string,
    { quantity, checked }: UpdateShoppingListEntryInput,
  ): Promise<ShoppingListEntryRow | undefined> {
    if (quantity === undefined && checked === undefined) {
      const [row] = await this.findMany(householdId, listId, [id]);
      return row;
    }

    const [row] = await this.db
      .update(shoppingListEntries)
      .set({
        quantity,
        checkedAt: checked === undefined ? undefined : checked ? sql`now()` : null,
      })
      .where(this.one(householdId, listId, id))
      .returning();

    return row;
  }

  async delete(
    householdId: string,
    listId: string,
    id: string,
  ): Promise<ShoppingListEntryRow | undefined> {
    const [row] = await this.db
      .update(shoppingListEntries)
      .set({ deletedAt: sql`now()` })
      .where(this.one(householdId, listId, id))
      .returning();

    return row;
  }

  deleteMany(
    householdId: string,
    listId: string,
    ids: readonly string[],
  ): Promise<ShoppingListEntryRow[]> {
    if (ids.length === 0) return Promise.resolve([]);

    return this.db
      .update(shoppingListEntries)
      .set({ deletedAt: sql`now()` })
      .where(and(this.onList(householdId, listId), inArray(shoppingListEntries.id, [...ids])))
      .returning();
  }

  /** Empties a list: it was deleted, and nothing cascades from a soft delete. */
  deleteForList(householdId: string, listId: string): Promise<ShoppingListEntryRow[]> {
    return this.db
      .update(shoppingListEntries)
      .set({ deletedAt: sql`now()` })
      .where(this.onList(householdId, listId))
      .returning();
  }

  /** Takes an item off every list: it was deleted. Returns the entries removed. */
  deleteForItem(householdId: string, itemId: string): Promise<ShoppingListEntryRow[]> {
    return this.db
      .update(shoppingListEntries)
      .set({ deletedAt: sql`now()` })
      .where(
        and(
          eq(shoppingListEntries.householdId, householdId),
          eq(shoppingListEntries.itemId, itemId),
          this.live(),
        ),
      )
      .returning();
  }

  private live() {
    return isNull(shoppingListEntries.deletedAt);
  }

  private onList(householdId: string, listId: string) {
    return and(
      eq(shoppingListEntries.householdId, householdId),
      eq(shoppingListEntries.listId, listId),
      this.live(),
    );
  }

  private one(householdId: string, listId: string, id: string) {
    return and(this.onList(householdId, listId), eq(shoppingListEntries.id, id));
  }
}
