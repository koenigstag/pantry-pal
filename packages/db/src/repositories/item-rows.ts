import { ITEM_STATUS, type ItemStatus } from '@pantry-pal/shared';
import { and, asc, desc, eq, getTableColumns, isNull, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';

import { items, subItems, type ItemRecord } from '../schema';
import type { Executor } from '../transaction';

/** The dates of one unit, as an item shows them. */
export interface ItemUnitState {
  expiresAt: string | null;
  openedAt: string | null;
  periodAfterOpeningDays: number | null;
}

/**
 * One active unit, as an `ItemRow` carries it: read in the same query as its
 * item, as JSON, so its instants are already ISO-8601 text.
 */
export interface ItemRowSubItem extends ItemUnitState {
  id: string;
  effectiveExpiresAt: string | null;
  fillPercent: number;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * An item as every caller reads it: the `items` row, its quantity — the count of
 * its active units — the dates of its lead unit, with that unit's
 * `effective_expires_at`, and the active units themselves, oldest first.
 *
 * The quantity and the dates are the shape the API always served, one set of
 * dates per item; `subItems` is what lets the units differ.
 */
export type ItemRow = ItemRecord &
  ItemUnitState & {
    quantity: number;
    effectiveExpiresAt: string | null;
    subItems: ItemRowSubItem[];
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

/** An instant as JavaScript's `toISOString()` writes it: UTC, to the millisecond. */
const isoInstant = (column: PgColumn) =>
  sql`to_char(${column} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`;

/**
 * The two lateral subqueries an `ItemRow` is read with, and its fields. Join
 * both to `items` with `leftJoinLateral(…, sql\`true\`)`, then select `fields`.
 *
 * A function of the executor, not a repository method, so the test household
 * fixture reads its items back inside its own transaction the same way.
 */
export function itemRowSelection(db: Executor) {
  // Aggregates always yield a row, so an item without active units still gets
  // its count, 0, and its units, `[]` (`json_agg` of no rows is NULL).
  const activeUnits = db
    .select({
      quantity: sql<number>`count(*)::int`.as('quantity'),
      subItems: sql<ItemRowSubItem[]>`coalesce(json_agg(json_build_object(
        'id', ${subItems.id},
        'expiresAt', ${subItems.expiresAt},
        'openedAt', ${subItems.openedAt},
        'periodAfterOpeningDays', ${subItems.periodAfterOpeningDays},
        'effectiveExpiresAt', ${subItems.effectiveExpiresAt},
        'fillPercent', ${subItems.fillPercent},
        'status', ${subItems.status},
        'createdAt', ${isoInstant(subItems.createdAt)},
        'updatedAt', ${isoInstant(subItems.updatedAt)}
      ) order by ${subItems.createdAt}, ${subItems.id}), '[]'::json)`.as('units'),
    })
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
    // Never null, as above; the COALESCEs are for the types the outer join gives them.
    quantity: sql<number>`coalesce(${activeUnits.quantity}, 0)`.mapWith(Number),
    expiresAt: leadUnit.expiresAt,
    openedAt: leadUnit.openedAt,
    periodAfterOpeningDays: leadUnit.periodAfterOpeningDays,
    effectiveExpiresAt: leadUnit.effectiveExpiresAt,
    subItems: sql<ItemRowSubItem[]>`coalesce(${activeUnits.subItems}, '[]'::json)`,
  };

  return { activeUnits, leadUnit, fields };
}
