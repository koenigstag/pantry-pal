import { and, asc, count, eq, inArray, max, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { shoppingLists, type NewShoppingListRow, type ShoppingListRow } from '../schema';

export type CreateShoppingListInput = Pick<NewShoppingListRow, 'name' | 'sortOrder'>;

/** A list the editor adds, with the id the caller generated so it knows the whole order first. */
export interface CreateShoppingListWithIdInput extends CreateShoppingListInput {
  id: string;
  archived: boolean;
}

/** One list's part of `updateMany`. An omitted field keeps its current value. */
export interface ShoppingListChange {
  id: string;
  name?: string;
  /** `true` archives it, stamped with the database's clock; `false` restores it. */
  archived?: boolean;
}

/** A household's shopping lists. What is on them is `ShoppingListEntriesRepository`'s. */
export class ShoppingListsRepository {
  constructor(private readonly db: Database) {}

  /** Display order. Ties fall back to name, then id, so the order is stable. */
  list(householdId: string): Promise<ShoppingListRow[]> {
    return this.db
      .select()
      .from(shoppingLists)
      .where(eq(shoppingLists.householdId, householdId))
      .orderBy(
        asc(shoppingLists.sortOrder),
        asc(sql`lower(${shoppingLists.name})`),
        asc(shoppingLists.id),
      );
  }

  async findById(householdId: string, id: string): Promise<ShoppingListRow | undefined> {
    const [row] = await this.db
      .select()
      .from(shoppingLists)
      .where(this.one(householdId, id))
      .limit(1);

    return row;
  }

  /**
   * Reads a list and row-locks it until the transaction ends: `share` for a
   * write that puts something on it or makes it an item's default, so it stays
   * while that write runs; `update` for changing the list itself.
   */
  async lock(
    householdId: string,
    id: string,
    strength: 'share' | 'update',
  ): Promise<ShoppingListRow | undefined> {
    const [row] = await this.db
      .select()
      .from(shoppingLists)
      .where(this.one(householdId, id))
      .for(strength);

    return row;
  }

  async count(householdId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(shoppingLists)
      .where(eq(shoppingLists.householdId, householdId));

    return row?.total ?? 0;
  }

  /** One past the current last position, so a new list appends. */
  async nextSortOrder(householdId: string): Promise<number> {
    const [row] = await this.db
      .select({ last: max(shoppingLists.sortOrder) })
      .from(shoppingLists)
      .where(eq(shoppingLists.householdId, householdId));

    return row?.last === null || row?.last === undefined ? 0 : row.last + 1;
  }

  async create(householdId: string, input: CreateShoppingListInput): Promise<ShoppingListRow> {
    const [row] = await this.db
      .insert(shoppingLists)
      .values({ ...input, householdId })
      .returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  async rename(
    householdId: string,
    id: string,
    name: string,
  ): Promise<ShoppingListRow | undefined> {
    const [row] = await this.db
      .update(shoppingLists)
      .set({ name })
      .where(this.one(householdId, id))
      .returning();

    return row;
  }

  /**
   * Hard delete: its entries cascade. Refused by
   * `items_default_shopping_list_household_fk` while any item still names the
   * list as its default, so clear those first.
   */
  async delete(householdId: string, id: string): Promise<ShoppingListRow | undefined> {
    const [row] = await this.db.delete(shoppingLists).where(this.one(householdId, id)).returning();
    return row;
  }

  /** Bulk insert for the editor, which has checked the names already: a clash fails the statement. */
  createAll(
    householdId: string,
    inputs: readonly CreateShoppingListWithIdInput[],
  ): Promise<ShoppingListRow[]> {
    if (inputs.length === 0) return Promise.resolve([]);

    return this.db
      .insert(shoppingLists)
      .values(
        inputs.map(({ archived, ...input }) => ({
          ...input,
          householdId,
          archivedAt: archived ? sql`now()` : null,
        })),
      )
      .returning();
  }

  /**
   * Renames, archives and restores several lists at once, in two statements.
   *
   * The name index is unique and cannot be deferred, so names that swap
   * ("Market" ↔ "Groceries") would collide halfway through a single UPDATE.
   * Every renamed row first takes a placeholder — its id behind a leading
   * space, which no trimmed name can equal — and only then its new name, as
   * `LocationsRepository.updateMany` does. Call it inside a transaction.
   */
  async updateMany(householdId: string, changes: readonly ShoppingListChange[]): Promise<void> {
    const renamed = changes.flatMap(({ id, name }) => (name === undefined ? [] : [{ id, name }]));
    const archiving = changes.flatMap(({ id, archived }) =>
      archived === undefined ? [] : [{ id, archived }],
    );
    if (renamed.length === 0 && archiving.length === 0) return;

    if (renamed.length > 0) {
      await this.db
        .update(shoppingLists)
        .set({ name: sql`' ' || ${shoppingLists.id}::text` })
        .where(
          this.some(
            householdId,
            renamed.map(({ id }) => id),
          ),
        );
    }

    // Casts are required: bare parameters would leave the CASE untyped.
    const names = sql.join(
      renamed.map(({ id, name }) => sql`when ${id}::uuid then ${name}::text`),
      sql` `,
    );
    const archivedAt = sql.join(
      archiving.map(({ id, archived }) =>
        archived
          ? sql`when ${id}::uuid then coalesce(${shoppingLists.archivedAt}, now())`
          : sql`when ${id}::uuid then null::timestamptz`,
      ),
      sql` `,
    );

    await this.db
      .update(shoppingLists)
      .set({
        ...(renamed.length > 0 && {
          name: sql`case ${shoppingLists.id} ${names} else ${shoppingLists.name} end`,
        }),
        ...(archiving.length > 0 && {
          archivedAt: sql`case ${shoppingLists.id} ${archivedAt} else ${shoppingLists.archivedAt} end`,
        }),
      })
      .where(this.some(householdId, [...new Set([...renamed, ...archiving].map(({ id }) => id))]));
  }

  /** Sets `sort_order` to each id's index in `orderedIds`, in one statement. Unknown ids are ignored. */
  async setSortOrders(householdId: string, orderedIds: readonly string[]): Promise<void> {
    if (orderedIds.length === 0) return;

    const positions = sql.join(
      orderedIds.map((id, index) => sql`when ${id}::uuid then ${index}::integer`),
      sql` `,
    );

    await this.db
      .update(shoppingLists)
      .set({ sortOrder: sql`case ${shoppingLists.id} ${positions} end` })
      .where(this.some(householdId, orderedIds));
  }

  private one(householdId: string, id: string) {
    return and(eq(shoppingLists.householdId, householdId), eq(shoppingLists.id, id));
  }

  private some(householdId: string, ids: readonly string[]) {
    return and(eq(shoppingLists.householdId, householdId), inArray(shoppingLists.id, [...ids]));
  }
}
