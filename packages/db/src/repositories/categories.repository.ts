import { asc, count, eq, max, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { categories, items, products, type CategoryRow, type NewCategoryRow } from '../schema';

export type UpdateCategoryInput = Partial<Omit<NewCategoryRow, 'code'>>;

/** Positions are this far apart, so a category can later be slotted between two. */
const SORT_ORDER_STEP = 10;

export class CategoriesRepository {
  constructor(private readonly db: Database) {}

  /** Picker order. Equal positions fall back to the code, so the order is stable. */
  list(): Promise<CategoryRow[]> {
    return this.db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.code));
  }

  async findByCode(code: string): Promise<CategoryRow | undefined> {
    const [row] = await this.db.select().from(categories).where(eq(categories.code, code)).limit(1);

    return row;
  }

  /**
   * Reads a category and row-locks it until the transaction ends: `share` for an
   * item write that copies its `is_edible`, so a change to the flag waits for the
   * write and then includes that item. Changing the row itself takes the
   * conflicting lock without asking.
   */
  async lock(code: string, strength: 'share' | 'update'): Promise<CategoryRow | undefined> {
    const [row] = await this.db
      .select()
      .from(categories)
      .where(eq(categories.code, code))
      .for(strength);

    return row;
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(categories);
    return row?.total ?? 0;
  }

  /** A step past the current last position, so a category created without one appends. */
  async nextSortOrder(): Promise<number> {
    const [row] = await this.db.select({ last: max(categories.sortOrder) }).from(categories);
    return row?.last === null || row?.last === undefined ? 0 : row.last + SORT_ORDER_STEP;
  }

  async create(input: NewCategoryRow): Promise<CategoryRow> {
    const [row] = await this.db.insert(categories).values(input).returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  async update(code: string, patch: UpdateCategoryInput): Promise<CategoryRow | undefined> {
    // An empty SET is an error in Drizzle; an empty patch is a no-op here.
    if (Object.values(patch).every((value) => value === undefined)) {
      return this.findByCode(code);
    }

    const [row] = await this.db
      .update(categories)
      .set(patch)
      .where(eq(categories.code, code))
      .returning();

    return row;
  }

  async delete(code: string): Promise<CategoryRow | undefined> {
    const [row] = await this.db.delete(categories).where(eq(categories.code, code)).returning();
    return row;
  }

  /**
   * Whether anything references the category — soft-deleted and consumed items
   * included, because the foreign keys count those too.
   */
  async isInUse(code: string): Promise<boolean> {
    const result = await this.db.execute<{ in_use: boolean }>(
      sql`select exists (select 1 from ${items} where ${eq(items.category, code)})
        or exists (select 1 from ${products} where ${eq(products.defaultCategory, code)}) as in_use`,
    );

    return result.rows[0]?.in_use === true;
  }
}
