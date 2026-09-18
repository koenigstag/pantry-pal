import { sql } from 'drizzle-orm';
import {
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { households } from './households';

/**
 * A household's named shopping lists. What is on them lives in
 * `shopping_list_entries`, and an item names the list it goes on when it runs
 * out (`items.default_shopping_list_id`).
 *
 * Soft-deleted, like locations, though nothing points at an old list: a client
 * syncing its offline mirror has to be told that a list is gone, and a row that
 * simply vanished says nothing. `ShoppingListsService` clears the items'
 * defaults first, which `items_default_shopping_list_household_fk` insists on,
 * and soft-deletes the entries itself, since no cascade fires any more.
 */
export const shoppingLists = pgTable(
  'shopping_lists',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    /** Display order, ascending. A new list appends; the editor rewrites it densely. */
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * Archived: frozen until restored. Nothing is added to it, not even by an
     * item running out that has it as its default, and nothing on it changes.
     * `ShoppingListsService` and `ItemsService` keep that; its entries and the
     * items' defaults stay, so restoring brings it back as it was.
     */
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    /**
     * Case-insensitive, like location names: a picker cannot tell "Market" from
     * "market". Archived lists count too, so restoring one never collides;
     * deleted ones do not, so their names are free again.
     */
    uniqueIndex('shopping_lists_household_name_idx')
      .on(t.householdId, sql`lower(name)`)
      .where(sql`deleted_at is null`),
    index('shopping_lists_household_sort_idx').on(t.householdId, t.sortOrder),
    /** A sync pull walks a household's lists in this order, from its checkpoint. */
    index('shopping_lists_household_sync_idx').on(t.householdId, t.updatedAt, t.id),
    /**
     * Redundant as a uniqueness rule, but the target of the composite foreign
     * keys that keep entries and item defaults inside their own household.
     */
    unique('shopping_lists_household_id_id_unique').on(t.householdId, t.id),
  ],
);

export type ShoppingListRow = typeof shoppingLists.$inferSelect;
export type NewShoppingListRow = typeof shoppingLists.$inferInsert;
