import {
  ITEM_STATUS,
  ITEM_STATUSES,
  MAX_ITEM_NAME_LENGTH,
  QUANTITY_UNIT_KIND,
  type ItemStatus,
} from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { inList, literal } from './_sql';
import { categories } from './categories';
import { households } from './households';
import { locations } from './locations';
import { products } from './products';
import { shoppingLists } from './shopping-lists';
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
    /** A `categories.code`: see `items_category_fk`. */
    category: text('category').notNull(),
    /**
     * Food or drink. Equal to the category's `is_edible`, except in the default
     * category (`other`), where the user decides. The items and categories
     * services keep it so; no constraint can state the exception.
     */
    isEdible: boolean('is_edible').notNull(),

    /**
     * Quantity is two parts so `2 cans × 400 g` can be represented: how many
     * (`quantity` + `unit`), and what is inside one of them (`size_value` +
     * `size_unit`).
     *
     * `quantity` counts whole things, so it is an integer, in a count unit —
     * `pcs`, `bottle`, `bag`: see `items_unit_count_fk`. An amount is a size,
     * `1 bag × 1.5 kg`, whose unit may be of any kind. `size_value` stays
     * numeric, and its `mode: 'number'` matters — numeric otherwise arrives as
     * the string "1.500".
     */
    quantity: integer('quantity').notNull(),
    unit: text('unit').notNull(),
    /**
     * Always `count`, and set by the database: the half of `items_unit_count_fk`
     * that pins the kind. A foreign key can only compare columns, so the kind it
     * requires has to be one.
     */
    unitKind: text('unit_kind')
      .$type<typeof QUANTITY_UNIT_KIND>()
      .notNull()
      .default(QUANTITY_UNIT_KIND),
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
    /**
     * The shopping list the item goes on by itself when it runs out: used up,
     * thrown out, or down to zero. Must belong to the same household: see
     * `items_default_shopping_list_household_fk`.
     */
    defaultShoppingListId: uuid('default_shopping_list_id'),
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

    /**
     * Things are counted, never weighed: `2 kg` of rice has no row in `units`
     * as `('kg', 'count')`, so it is refused, and `1 bag × 2 kg` is how it is
     * stored. Adding a count unit is still an INSERT.
     *
     * The same key refuses changing the kind of a count unit in use.
     */
    foreignKey({
      name: 'items_unit_count_fk',
      columns: [t.unit, t.unitKind],
      foreignColumns: [units.code, units.kind],
    }).onDelete('restrict'),

    /**
     * Categories are rows, so adding one needs no migration. RESTRICT counts
     * deleted and consumed items too: a category that ever held one stays.
     */
    foreignKey({
      name: 'items_category_fk',
      columns: [t.category],
      foreignColumns: [categories.code],
    }).onDelete('restrict'),

    /**
     * Tenancy again, for the default shopping list; not checked while the column
     * is null. A list that is still some item's default cannot be deleted, so
     * `ShoppingListsService` clears those defaults first and announces each
     * item. `ON DELETE SET NULL (default_shopping_list_id)` would clear them
     * too, but silently: no broadcast, and no `updated_at` for a delta sync.
     */
    foreignKey({
      name: 'items_default_shopping_list_household_fk',
      columns: [t.householdId, t.defaultShoppingListId],
      foreignColumns: [shoppingLists.householdId, shoppingLists.id],
    }).onDelete('no action'),

    /**
     * Redundant as a uniqueness rule, but the target of
     * `shopping_list_entries_item_household_fk`, which keeps a list's entries
     * within its household.
     */
    unique('items_household_id_id_unique').on(t.householdId, t.id),

    check('items_status_check', sql`status in (${inList(ITEM_STATUSES)})`),
    check('items_quantity_positive', sql`quantity >= 0`),
    check('items_unit_kind_count', sql`unit_kind = ${literal(QUANTITY_UNIT_KIND)}`),
    /** Both or neither: a size value without its unit is meaningless. */
    check('items_size_pair', sql`(size_value is null) = (size_unit is null)`),

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
    /** Clearing a deleted list from the items that went on it, and the key's own check. */
    index('items_default_shopping_list_idx')
      .on(t.householdId, t.defaultShoppingListId)
      .where(sql`default_shopping_list_id is not null`),
  ],
);

export type ItemRow = typeof items.$inferSelect;
export type NewItemRow = typeof items.$inferInsert;
