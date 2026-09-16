import { asc, count, eq, inArray, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { items, products, units, type NewUnitRow, type UnitRow } from '../schema';

export type UpdateUnitInput = Partial<Omit<NewUnitRow, 'code'>>;

/** Kinds in picker order: counting first, then weights, then volumes. */
const KIND_ORDER = sql`case ${units.kind} when 'count' then 0 when 'mass' then 1 else 2 end`;

export class UnitsRepository {
  constructor(private readonly db: Database) {}

  /** Grouped by kind, smallest unit first within each. */
  list(): Promise<UnitRow[]> {
    return this.db
      .select()
      .from(units)
      .orderBy(asc(KIND_ORDER), asc(units.factor), asc(units.code));
  }

  async findByCode(code: string): Promise<UnitRow | undefined> {
    const [row] = await this.db.select().from(units).where(eq(units.code, code)).limit(1);
    return row;
  }

  /** Which of `codes` exist — one round trip to check an item's `unit` and `size_unit` together. */
  async findExistingCodes(codes: readonly string[]): Promise<Set<string>> {
    if (codes.length === 0) return new Set();

    const rows = await this.db
      .select({ code: units.code })
      .from(units)
      .where(inArray(units.code, [...codes]));

    return new Set(rows.map((row) => row.code));
  }

  async count(): Promise<number> {
    const [row] = await this.db.select({ total: count() }).from(units);
    return row?.total ?? 0;
  }

  async create(input: NewUnitRow): Promise<UnitRow> {
    const [row] = await this.db.insert(units).values(input).returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  async update(code: string, patch: UpdateUnitInput): Promise<UnitRow | undefined> {
    // An empty SET is an error in Drizzle; an empty patch is a no-op here.
    if (Object.values(patch).every((value) => value === undefined)) {
      return this.findByCode(code);
    }

    const [row] = await this.db.update(units).set(patch).where(eq(units.code, code)).returning();
    return row;
  }

  async delete(code: string): Promise<UnitRow | undefined> {
    const [row] = await this.db.delete(units).where(eq(units.code, code)).returning();
    return row;
  }

  /**
   * Whether anything references the unit — soft-deleted and consumed items
   * included, because the foreign keys count those too.
   */
  async isInUse(code: string): Promise<boolean> {
    const result = await this.db.execute<{ in_use: boolean }>(
      sql`select exists (select 1 from ${items} where ${or(
        eq(items.unit, code),
        eq(items.sizeUnit, code),
      )}) or exists (select 1 from ${products} where ${eq(products.defaultUnit, code)}) as in_use`,
    );

    return result.rows[0]?.in_use === true;
  }
}
