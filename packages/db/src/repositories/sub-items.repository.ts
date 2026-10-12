import { ITEM_STATUS } from '@pantry-pal/shared';
import { and, asc, count, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { items, subItems, type SubItemRow } from '../schema';

/** Units of one item whose last day is a given day, as the expiry notification lists them. */
export interface ExpiringItem {
  householdId: string;
  itemId: string;
  name: string;
  /** How many of its units expire that day. */
  units: number;
}

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

  /**
   * The items on the shelf in these households with units whose last day is
   * `day` (`YYYY-MM-DD`): active units of active items, by `effective_expires_at`,
   * so an opened jar's period after opening counts. By name within a household.
   */
  expiringOn(householdIds: readonly string[], day: string): Promise<ExpiringItem[]> {
    if (householdIds.length === 0) return Promise.resolve([]);

    return this.db
      .select({
        householdId: items.householdId,
        itemId: items.id,
        name: items.name,
        units: count(),
      })
      .from(subItems)
      .innerJoin(
        items,
        and(eq(items.householdId, subItems.householdId), eq(items.id, subItems.itemId)),
      )
      .where(
        and(
          inArray(subItems.householdId, [...householdIds]),
          eq(subItems.effectiveExpiresAt, day),
          eq(subItems.status, ITEM_STATUS.Active),
          isNull(subItems.deletedAt),
          eq(items.status, ITEM_STATUS.Active),
          isNull(items.deletedAt),
        ),
      )
      .groupBy(items.householdId, items.id, items.name)
      .orderBy(asc(items.householdId), asc(sql`lower(${items.name})`), asc(items.id));
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
