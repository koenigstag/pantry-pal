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
  foreignKey,
  index,
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

/**
 * Something the household keeps, in one location. Its units — how many there
 * are, and each one's dates and fill level — are rows of `sub_items`; the
 * quantity is their count, never a column here.
 */
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
     * What the item is counted in, and what is inside one of it, so
     * `2 cans × 400 g` can be represented: the count unit here, the size beside
     * it, and how many as the number of active `sub_items`.
     *
     * The unit is a count unit — `pcs`, `bottle`, `bag`: see
     * `items_unit_count_fk`. An amount is a size, `1 bag × 1.5 kg`, whose unit
     * may be of any kind. `size_value` stays numeric, and its `mode: 'number'`
     * matters — numeric otherwise arrives as the string "1.500".
     */
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

    notes: text('notes'),
    /**
     * The whole item's lifecycle: on the shelf, used up, or thrown out. Its units
     * have statuses of their own, so an item can stay on the shelf with none
     * left, and restoring a used-up item brings its units back as they were.
     */
    status: text('status').$type<ItemStatus>().notNull().default(ITEM_STATUS.Active),
    /**
     * The shopping list the item goes on by itself when it runs out: used up,
     * thrown out, or down to zero. Must belong to the same household: see
     * `items_default_shopping_list_household_fk`.
     */
    defaultShoppingListId: uuid('default_shopping_list_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    /**
     * Moves whenever anything a reader sees of the item changes, its units
     * included: `ItemsRepository` touches it with every unit it writes, because
     * a sync pull finds changed items by this column alone.
     */
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
     * `shopping_list_entries_item_household_fk` and `sub_items_item_household_fk`,
     * which keep a list's entries and an item's units within its household.
     */
    unique('items_household_id_id_unique').on(t.householdId, t.id),

    check('items_status_check', sql`status in (${inList(ITEM_STATUSES)})`),
    check('items_unit_kind_count', sql`unit_kind = ${literal(QUANTITY_UNIT_KIND)}`),
    /** Both or neither: a size value without its unit is meaningless. */
    check('items_size_pair', sql`(size_value is null) = (size_unit is null)`),

    index('items_location_idx')
      .on(t.householdId, t.locationId)
      .where(sql`deleted_at is null`),
    /**
     * A sync pull walks a household's items in this order, from its checkpoint,
     * with the id breaking ties. Tombstones (`deleted_at`) are included: they
     * are how a client that was away learns what to drop.
     */
    index('items_sync_idx').on(t.householdId, t.updatedAt, t.id),
    index('items_product_idx')
      .on(t.householdId, t.productId)
      .where(sql`deleted_at is null`),
    /** Clearing a deleted list from the items that went on it, and the key's own check. */
    index('items_default_shopping_list_idx')
      .on(t.householdId, t.defaultShoppingListId)
      .where(sql`default_shopping_list_id is not null`),
  ],
);

/** A row of the `items` table alone. Callers read `ItemRow`, which adds its units' state. */
export type ItemRecord = typeof items.$inferSelect;
export type NewItemRecord = typeof items.$inferInsert;
