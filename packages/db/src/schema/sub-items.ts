import { ITEM_STATUS, ITEM_STATUSES, type ItemStatus } from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

import { inList, literal } from './_sql';
import { households } from './households';
import { items } from './items';

/**
 * One unit of an item — a bottle, a can, a tube — with its own dates and fill
 * level. An item's quantity is the count of its active units: it is never
 * stored, so the two cannot disagree.
 *
 * Every item has at least one row here from the moment it exists: creating one
 * needs a quantity of at least 1, and units are only ever consumed or
 * soft-deleted, never removed. A unit's `status` is its own (stepping a quantity
 * down consumes units); the item's `status` is the whole item's lifecycle, so an
 * item can be on the shelf with no units left, as it could with quantity 0.
 */
export const subItems = pgTable(
  'sub_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Must belong to the same household: see `sub_items_item_household_fk`. */
    itemId: uuid('item_id').notNull(),

    /** `date`, not timestamptz: a carton expires on a day, not an instant. */
    expiresAt: date('expires_at'),
    openedAt: date('opened_at'),
    /** The "12M" symbol on cosmetics and syrups. */
    periodAfterOpeningDays: integer('period_after_opening_days'),
    /**
     * `LEAST` skips NULLs and `date + int` yields a date, so an opened jar
     * marked "use within 5 days" correctly outranks its printed 2027 date.
     *
     * Read THIS column when computing expiry status, never `expires_at`. It is
     * generated from this row's own columns only: a generated column cannot
     * read another table.
     */
    effectiveExpiresAt: date('effective_expires_at').generatedAlwaysAs(
      sql`least(expires_at, opened_at + period_after_opening_days)`,
    ),
    /**
     * How full the unit is, in percent. An empty unit is consumed rather than
     * kept at 0, and a partly used one has been opened: see the two checks.
     */
    fillPercent: smallint('fill_percent').notNull().default(100),

    status: text('status').$type<ItemStatus>().notNull().default(ITEM_STATUS.Active),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * Tenancy by key, as for `shopping_list_entries`: a unit cannot belong to
     * another household's item. `items_household_id_id_unique` is the target.
     * The cascade fires only when the item's household goes: items are
     * soft-deleted.
     */
    foreignKey({
      name: 'sub_items_item_household_fk',
      columns: [t.householdId, t.itemId],
      foreignColumns: [items.householdId, items.id],
    }).onDelete('cascade'),

    check('sub_items_status_check', sql`status in (${inList(ITEM_STATUSES)})`),
    check('sub_items_fill_range', sql`fill_percent between 1 and 100`),
    check('sub_items_fill_needs_opened', sql`fill_percent = 100 or opened_at is not null`),

    /** An item's units: counting the active ones, and finding the one that goes first. */
    index('sub_items_item_idx')
      .on(t.itemId)
      .where(sql`deleted_at is null`),
    /** What is going off, soonest first, across a household. */
    index('sub_items_expiry_idx')
      .on(t.householdId, t.effectiveExpiresAt)
      .where(sql`deleted_at is null and status = ${literal(ITEM_STATUS.Active)}`),
  ],
);

export type SubItemRow = typeof subItems.$inferSelect;
export type NewSubItemRow = typeof subItems.$inferInsert;
