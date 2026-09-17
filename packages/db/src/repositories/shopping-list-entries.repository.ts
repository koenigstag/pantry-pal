import { and, asc, eq, inArray, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { shoppingListEntries, type ShoppingListEntryRow } from '../schema';

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
 */
export class ShoppingListEntriesRepository {
  constructor(private readonly db: Database) {}

  /** Every entry of the household, oldest first: the order they were added in. */
  listForHousehold(householdId: string): Promise<ShoppingListEntryRow[]> {
    return this.db
      .select()
      .from(shoppingListEntries)
      .where(eq(shoppingListEntries.householdId, householdId))
      .orderBy(asc(shoppingListEntries.createdAt), asc(shoppingListEntries.id));
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
   * the same item cannot fail on the unique index.
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
      .onConflictDoNothing({ target: [shoppingListEntries.listId, shoppingListEntries.itemId] })
      .returning();
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
      .delete(shoppingListEntries)
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
      .delete(shoppingListEntries)
      .where(and(this.onList(householdId, listId), inArray(shoppingListEntries.id, [...ids])))
      .returning();
  }

  /** Takes an item off every list: it was deleted. Returns the entries removed. */
  deleteForItem(householdId: string, itemId: string): Promise<ShoppingListEntryRow[]> {
    return this.db
      .delete(shoppingListEntries)
      .where(
        and(
          eq(shoppingListEntries.householdId, householdId),
          eq(shoppingListEntries.itemId, itemId),
        ),
      )
      .returning();
  }

  private onList(householdId: string, listId: string) {
    return and(
      eq(shoppingListEntries.householdId, householdId),
      eq(shoppingListEntries.listId, listId),
    );
  }

  private one(householdId: string, listId: string, id: string) {
    return and(this.onList(householdId, listId), eq(shoppingListEntries.id, id));
  }
}
