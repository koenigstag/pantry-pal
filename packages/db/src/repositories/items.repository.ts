import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { ITEM_STATUS, items, type ItemRow, type NewItemRow } from '../schema';

/** Everything the caller supplies; tenancy and identity are applied by the repository. */
export type CreateItemInput = Omit<
  NewItemRow,
  'id' | 'householdId' | 'createdAt' | 'updatedAt' | 'deletedAt'
>;

export type UpdateItemInput = Partial<CreateItemInput>;

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
   * The main list: most urgent first.
   *
   * Ordered by `effective_expires_at`, never `expires_at` — an opened jar with a
   * short period-after-opening has to outrank its printed date. Postgres sorts
   * NULLs last on ASC, so items with no expiry fall to the bottom, matching
   * `sortByUrgency` in `@pantry-pal/shared`.
   */
  listActive(householdId: string): Promise<ItemRow[]> {
    return this.db
      .select()
      .from(items)
      .where(
        and(
          eq(items.householdId, householdId),
          isNull(items.deletedAt),
          eq(items.status, ITEM_STATUS.Active),
        ),
      )
      .orderBy(asc(items.effectiveExpiresAt), asc(items.name));
  }

  /**
   * Delta for a reconnecting WebSocket client. Soft-deleted rows are included
   * on purpose: they are the tombstones that tell the client what to drop.
   */
  listChangedSince(householdId: string, since: Date): Promise<ItemRow[]> {
    return this.db
      .select()
      .from(items)
      .where(and(eq(items.householdId, householdId), gt(items.updatedAt, since)))
      .orderBy(asc(items.updatedAt));
  }

  async findById(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [row] = await this.db
      .select()
      .from(items)
      .where(and(eq(items.householdId, householdId), eq(items.id, id), isNull(items.deletedAt)))
      .limit(1);

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
    const [row] = await this.db
      .update(items)
      .set(patch)
      .where(and(eq(items.householdId, householdId), eq(items.id, id), isNull(items.deletedAt)))
      .returning();

    return row;
  }

  /** Soft delete: the row survives so the change still shows up in a delta sync. */
  async softDelete(householdId: string, id: string): Promise<ItemRow | undefined> {
    const [row] = await this.db
      .update(items)
      .set({ deletedAt: sql`now()` })
      .where(and(eq(items.householdId, householdId), eq(items.id, id), isNull(items.deletedAt)))
      .returning();

    return row;
  }
}
