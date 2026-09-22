import { and, count, eq, isNull, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { items, subItems, type SubItemRow } from '../schema';

/** What a write may change on one unit. */
export type UpdateSubItemInput = Partial<
  Pick<SubItemRow, 'expiresAt' | 'openedAt' | 'periodAfterOpeningDays' | 'fillPercent' | 'status'>
>;

/**
 * An item's units one at a time, each in a state of its own: changed, or
 * deleted as a mistake. `ItemsRepository` creates them — `createWithUnits` and
 * `addUnits` for units in states of their own — and reads and writes the item
 * as a whole.
 *
 * Plain class, no decorators, like every repository here. Callers hold the
 * item's lock (`ItemsRepository.lock`) first: that one lock is what keeps two
 * writes to an item's units from interleaving. Every write also moves the
 * item's `updated_at`, which is how a sync pull finds the item changed.
 */
export class SubItemsRepository {
  constructor(private readonly db: Database) {}

  /** One unit of the item, whatever its status. Soft-deleted ones are gone. */
  async find(householdId: string, itemId: string, id: string): Promise<SubItemRow | undefined> {
    const [row] = await this.db
      .select()
      .from(subItems)
      .where(this.live(householdId, itemId, id))
      .limit(1);

    return row;
  }

  /** How many units the item has, whatever their status: an item keeps at least one. */
  async countLive(householdId: string, itemId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(subItems)
      .where(this.liveOf(householdId, itemId));

    return row?.total ?? 0;
  }

  /**
   * Changes one unit of the item, and returns it as it is now; `undefined` when
   * the item has no such unit. An empty patch writes nothing.
   */
  async update(
    householdId: string,
    itemId: string,
    id: string,
    patch: UpdateSubItemInput,
  ): Promise<SubItemRow | undefined> {
    // Drizzle throws "No values to set" on an empty SET, `$onUpdate` columns notwithstanding.
    if (Object.values(patch).every((value) => value === undefined)) {
      return this.find(householdId, itemId, id);
    }

    const [row] = await this.db
      .update(subItems)
      .set(patch)
      .where(this.live(householdId, itemId, id))
      .returning();
    if (row !== undefined) await this.touch(householdId, itemId);
    return row;
  }

  /**
   * Soft delete, for a unit added by mistake: using one up or throwing it out is
   * a status. The row stays, like every deleted row, and leaves the item's reads.
   */
  async softDelete(
    householdId: string,
    itemId: string,
    id: string,
  ): Promise<SubItemRow | undefined> {
    const [row] = await this.db
      .update(subItems)
      .set({ deletedAt: sql`now()` })
      .where(this.live(householdId, itemId, id))
      .returning();
    if (row !== undefined) await this.touch(householdId, itemId);
    return row;
  }

  private async touch(householdId: string, itemId: string): Promise<void> {
    await this.db
      .update(items)
      .set({ updatedAt: new Date() })
      .where(and(eq(items.householdId, householdId), eq(items.id, itemId)));
  }

  private liveOf(householdId: string, itemId: string) {
    return and(
      eq(subItems.householdId, householdId),
      eq(subItems.itemId, itemId),
      isNull(subItems.deletedAt),
    );
  }

  private live(householdId: string, itemId: string, id: string) {
    return and(this.liveOf(householdId, itemId), eq(subItems.id, id));
  }
}
