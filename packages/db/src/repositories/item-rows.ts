import { ITEM_STATUS } from '@pantry-pal/shared';
import { and, asc, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';

import { items, subItems, type ItemRecord } from '../schema';
import type { Executor } from '../transaction';

/** The dates of one unit, as an item shows them. */
export interface ItemUnitState {
  expiresAt: string | null;
  openedAt: string | null;
  periodAfterOpeningDays: number | null;
}

/**
 * An item as every caller reads it: the `items` row, its quantity — the count of
 * its active units — and the dates of its lead unit, with that unit's
 * `effective_expires_at`.
 *
 * This is the shape the API has always served, one set of dates per item, so the
 * services, the sync pull and the offline mirror read items exactly as they did
 * before units had rows of their own.
 */
export type ItemRow = ItemRecord &
  ItemUnitState & {
    quantity: number;
    effectiveExpiresAt: string | null;
  };

/**
 * Which unit an item's dates are read from. The active unit that goes first —
 * soonest `effective_expires_at`, as the pantry list is sorted — or, with none
 * active, the unit changed last: an item stepped down to zero keeps showing the
 * dates it had, as it did when they were columns of the item.
 */
export const LEAD_UNIT_ORDER = [
  sql`(${subItems.status} = ${ITEM_STATUS.Active}) desc`,
  sql`case when ${subItems.status} = ${ITEM_STATUS.Active} then ${subItems.effectiveExpiresAt} end asc nulls last`,
  desc(subItems.updatedAt),
  asc(subItems.id),
];

/**
 * The two lateral subqueries an `ItemRow` is read with, and its fields. Join
 * both to `items` with `leftJoinLateral(…, sql\`true\`)`, then select `fields`.
 *
 * A function of the executor, not a repository method, so the test household
 * fixture reads its items back inside its own transaction the same way.
 */
export function itemRowSelection(db: Executor) {
  const activeUnits = db
    .select({ quantity: sql<number>`count(*)::int`.as('quantity') })
    .from(subItems)
    .where(
      and(
        eq(subItems.itemId, items.id),
        eq(subItems.status, ITEM_STATUS.Active),
        isNull(subItems.deletedAt),
      ),
    )
    .as('active_units');

  const leadUnit = db
    .select({
      expiresAt: subItems.expiresAt,
      openedAt: subItems.openedAt,
      periodAfterOpeningDays: subItems.periodAfterOpeningDays,
      effectiveExpiresAt: subItems.effectiveExpiresAt,
    })
    .from(subItems)
    .where(and(eq(subItems.itemId, items.id), isNull(subItems.deletedAt)))
    .orderBy(...LEAD_UNIT_ORDER)
    .limit(1)
    .as('lead_unit');

  const fields = {
    ...getTableColumns(items),
    // An aggregate always yields a row, so the count is never null; the
    // COALESCE is for the type the outer join gives it.
    quantity: sql<number>`coalesce(${activeUnits.quantity}, 0)`.mapWith(Number),
    expiresAt: leadUnit.expiresAt,
    openedAt: leadUnit.openedAt,
    periodAfterOpeningDays: leadUnit.periodAfterOpeningDays,
    effectiveExpiresAt: leadUnit.effectiveExpiresAt,
  };

  return { activeUnits, leadUnit, fields };
}
