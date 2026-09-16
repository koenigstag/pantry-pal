import {
  ITEM_STATUS,
  ITEM_STATUSES,
  MAX_ITEM_NAME_LENGTH,
  PANTRY_CATEGORIES,
  type ItemStatus,
  type PantryCategory,
} from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { inList } from './_sql';
import { households } from './households';
import { locations } from './locations';
import { products } from './products';
import { units } from './units';

/** The batch half of product + batch: one physical package, with its own expiry. */
export const items = pgTable(
  'items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Optional: a freeform item never has to become a catalog entry. */
    productId: uuid('product_id').references(() => products.id, { onDelete: 'set null' }),
    name: varchar('name', { length: MAX_ITEM_NAME_LENGTH }).notNull(),
    /** Must belong to the same household: see `items_location_household_fk`. */
    locationId: uuid('location_id').notNull(),
    category: text('category').$type<PantryCategory>().notNull(),

    /**
     * Quantity is three parts so `1 can 300 ml` can be represented:
     * how many (`quantity` + `unit`), and what is inside one of them
     * (`size_value` + `size_unit`).
     *
     * `mode: 'number'` matters — numeric otherwise arrives as the string
     * "1.000", which would not match `PantryItem.quantity: number`.
     */
    quantity: numeric('quantity', { precision: 10, scale: 3, mode: 'number' }).notNull(),
    unit: text('unit')
      .notNull()
      .references(() => units.code, { onDelete: 'restrict' }),
    sizeValue: numeric('size_value', { precision: 10, scale: 3, mode: 'number' }),
    sizeUnit: text('size_unit').references(() => units.code, { onDelete: 'restrict' }),

    /** `date`, not timestamptz: a carton expires on a day, not an instant. */
    expiresAt: date('expires_at'),
    openedAt: date('opened_at'),
    /** The "12M" symbol on cosmetics and syrups. */
    periodAfterOpeningDays: integer('period_after_opening_days'),
    /**
     * `LEAST` skips NULLs and `date + int` yields a date, so an opened jar
     * marked "use within 5 days" correctly outranks its printed 2027 date.
     *
     * Read THIS column when computing expiry status, never `expires_at`.
     */
    effectiveExpiresAt: date('effective_expires_at').generatedAlwaysAs(
      sql`least(expires_at, opened_at + period_after_opening_days)`,
    ),

    notes: text('notes'),
    status: text('status').$type<ItemStatus>().notNull().default(ITEM_STATUS.Active),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /** Soft delete: WS tombstones and reconnect deltas both need the row to survive. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * Tenancy, enforced by the database rather than trusted to every caller: a
     * plain FK on `location_id` would only check that the location exists, so an
     * item could be filed under another household's shelf.
     *
     * RESTRICT counts soft-deleted and consumed rows too, which is why locations
     * are soft-deleted rather than removed.
     */
    foreignKey({
      name: 'items_location_household_fk',
      columns: [t.householdId, t.locationId],
      foreignColumns: [locations.householdId, locations.id],
    }).onDelete('restrict'),

    check('items_category_check', sql`category in (${inList(PANTRY_CATEGORIES)})`),
    check('items_status_check', sql`status in (${inList(ITEM_STATUSES)})`),
    check('items_quantity_positive', sql`quantity >= 0`),
    /** Both or neither: a size value without its unit is meaningless. */
    check('items_size_pair', sql`(size_value is null) = (size_unit is null)`),
    /** You can only say what is inside one thing if you are counting things. */
    check('items_size_only_count', sql`size_value is null or unit = 'pcs'`),

    /** The main list query: what is going off, soonest first. */
    index('items_expiry_idx')
      .on(t.householdId, t.effectiveExpiresAt)
      .where(sql`deleted_at is null and status = 'active'`),
    index('items_location_idx')
      .on(t.householdId, t.locationId)
      .where(sql`deleted_at is null`),
    /** Reconnect delta sync: `?since=<updated_at>`, tombstones included. */
    index('items_sync_idx').on(t.householdId, t.updatedAt),
    index('items_product_idx')
      .on(t.householdId, t.productId)
      .where(sql`deleted_at is null`),
  ],
);

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
