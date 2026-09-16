import { and, asc, count, eq, inArray, isNull, max, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { locations, type LocationRow, type NewLocationRow } from '../schema';

export type CreateLocationInput = Pick<NewLocationRow, 'name' | 'icon' | 'sortOrder'>;

/** A location of a household being created, which is where the fallback comes from. */
export type CreateInitialLocationInput = CreateLocationInput & Pick<NewLocationRow, 'isFallback'>;
export type UpdateLocationInput = Partial<Pick<NewLocationRow, 'name' | 'icon'>>;

/** A location whose id the caller generated, so the caller knows the whole order before inserting. */
export type CreateLocationWithIdInput = CreateLocationInput & Pick<LocationRow, 'id'>;

/** One location's part of `updateMany`. An omitted field keeps its current value. */
export interface LocationChange {
  id: string;
  name?: string;
  /** `null` removes the icon. */
  icon?: string | null;
}

/**
 * Every read here excludes soft-deleted locations: a deleted location only
 * survives so that history rows can keep referencing it.
 */
export class LocationsRepository {
  constructor(private readonly db: Database) {}

  /** Display order. Ties — possible only in data written outside a reorder — fall back to name. */
  list(householdId: string): Promise<LocationRow[]> {
    return this.db
      .select()
      .from(locations)
      .where(and(eq(locations.householdId, householdId), isNull(locations.deletedAt)))
      .orderBy(asc(locations.sortOrder), asc(sql`lower(${locations.name})`), asc(locations.id));
  }

  async findById(householdId: string, id: string): Promise<LocationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(locations)
      .where(this.active(householdId, id))
      .limit(1);

    return row;
  }

  /**
   * Reads a location and row-locks it until the transaction ends.
   *
   * `share` for writers that need the location to stay put while they file an
   * item under it; `update` for the delete, which must wait for those writers.
   * Because the lock re-checks `deleted_at` after waiting, an item can never be
   * filed under a location deleted a moment earlier.
   */
  async lock(
    householdId: string,
    id: string,
    strength: 'share' | 'update',
  ): Promise<LocationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(locations)
      .where(this.active(householdId, id))
      .for(strength);

    return row;
  }

  async count(householdId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(locations)
      .where(and(eq(locations.householdId, householdId), isNull(locations.deletedAt)));

    return row?.total ?? 0;
  }

  /** One past the current last position, so a new location appends. */
  async nextSortOrder(householdId: string): Promise<number> {
    const [row] = await this.db
      .select({ last: max(locations.sortOrder) })
      .from(locations)
      .where(and(eq(locations.householdId, householdId), isNull(locations.deletedAt)));

    return row?.last === null || row?.last === undefined ? 0 : row.last + 1;
  }

  async create(householdId: string, input: CreateLocationInput): Promise<LocationRow> {
    const [row] = await this.db
      .insert(locations)
      .values({ ...input, householdId })
      .returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  /**
   * Reads the household's fallback location and share-locks it until the
   * transaction ends, so it stays put while items are moved into it.
   */
  async lockFallback(householdId: string): Promise<LocationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(locations)
      .where(
        and(
          eq(locations.householdId, householdId),
          eq(locations.isFallback, true),
          isNull(locations.deletedAt),
        ),
      )
      .for('share');

    return row;
  }

  /**
   * Bulk insert for seeding a household. A name that already exists (ignoring
   * case) is skipped rather than failing the batch.
   */
  createMany(
    householdId: string,
    inputs: readonly CreateInitialLocationInput[],
  ): Promise<LocationRow[]> {
    if (inputs.length === 0) return Promise.resolve([]);

    return this.db
      .insert(locations)
      .values(inputs.map((input) => ({ ...input, householdId })))
      .onConflictDoNothing()
      .returning();
  }

  /**
   * Bulk insert for a caller that has already checked the names, such as the
   * locations editor. Unlike `createMany`, a name that exists fails the whole
   * statement instead of being skipped.
   */
  createAll(
    householdId: string,
    inputs: readonly CreateLocationWithIdInput[],
  ): Promise<LocationRow[]> {
    if (inputs.length === 0) return Promise.resolve([]);

    return this.db
      .insert(locations)
      .values(inputs.map((input) => ({ ...input, householdId })))
      .returning();
  }

  /**
   * Renames and re-icons several locations at once, in two statements.
   *
   * The name index is unique and cannot be deferred, so Postgres checks it row
   * by row, and names that swap or rotate ("Fridge" ↔ "Freezer") would collide
   * halfway through a single UPDATE. Every renamed row therefore first takes a
   * placeholder — its id behind a leading space, which no trimmed name can
   * equal — and only then its new name.
   *
   * Between the two statements the renamed rows carry placeholders, so call
   * this inside a transaction. The new names must not collide with each other
   * or with the household's other active locations; the index rejects the
   * statement if they do.
   */
  async updateMany(householdId: string, changes: readonly LocationChange[]): Promise<void> {
    const renamed = changes.flatMap(({ id, name }) => (name === undefined ? [] : [{ id, name }]));
    const reiconed = changes.flatMap(({ id, icon }) => (icon === undefined ? [] : [{ id, icon }]));
    if (renamed.length === 0 && reiconed.length === 0) return;

    if (renamed.length > 0) {
      await this.db
        .update(locations)
        .set({ name: sql`' ' || ${locations.id}::text` })
        .where(
          this.activeIn(
            householdId,
            renamed.map(({ id }) => id),
          ),
        );
    }

    // Casts as in `setSortOrders`: bare parameters would leave the CASE untyped.
    const names = sql.join(
      renamed.map(({ id, name }) => sql`when ${id}::uuid then ${name}::text`),
      sql` `,
    );
    const icons = sql.join(
      reiconed.map(({ id, icon }) => sql`when ${id}::uuid then ${icon}::text`),
      sql` `,
    );

    await this.db
      .update(locations)
      .set({
        ...(renamed.length > 0 && {
          name: sql`case ${locations.id} ${names} else ${locations.name} end`,
        }),
        ...(reiconed.length > 0 && {
          icon: sql`case ${locations.id} ${icons} else ${locations.icon} end`,
        }),
      })
      .where(
        this.activeIn(householdId, [...new Set([...renamed, ...reiconed].map(({ id }) => id))]),
      );
  }

  async update(
    householdId: string,
    id: string,
    patch: UpdateLocationInput,
  ): Promise<LocationRow | undefined> {
    // Drizzle throws "No values to set" on an empty SET, even though
    // `updated_at` has `$onUpdate`. An empty patch is a no-op, not an error.
    if (Object.values(patch).every((value) => value === undefined)) {
      return this.findById(householdId, id);
    }

    const [row] = await this.db
      .update(locations)
      .set(patch)
      .where(this.active(householdId, id))
      .returning();

    return row;
  }

  /**
   * Sets `sort_order` to each id's index in `orderedIds`, in one statement.
   *
   * Ids that are not active locations of the household are ignored, so the
   * caller validates the list first. Returns the rows it changed, in no
   * particular order.
   */
  setSortOrders(householdId: string, orderedIds: readonly string[]): Promise<LocationRow[]> {
    if (orderedIds.length === 0) return Promise.resolve([]);

    // Casts are required: bare parameters would type the CASE as text.
    const positions = sql.join(
      orderedIds.map((id, index) => sql`when ${id}::uuid then ${index}::integer`),
      sql` `,
    );

    return this.db
      .update(locations)
      .set({ sortOrder: sql`case ${locations.id} ${positions} end` })
      .where(this.activeIn(householdId, orderedIds))
      .returning();
  }

  async softDelete(householdId: string, id: string): Promise<LocationRow | undefined> {
    const [row] = await this.db
      .update(locations)
      .set({ deletedAt: sql`now()` })
      .where(this.active(householdId, id))
      .returning();

    return row;
  }

  private active(householdId: string, id: string) {
    return and(
      eq(locations.householdId, householdId),
      eq(locations.id, id),
      isNull(locations.deletedAt),
    );
  }

  private activeIn(householdId: string, ids: readonly string[]) {
    return and(
      eq(locations.householdId, householdId),
      inArray(locations.id, [...ids]),
      isNull(locations.deletedAt),
    );
  }
}
