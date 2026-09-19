import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

import { households } from './households';
import { items } from './items';
import { shoppingLists } from './shopping-lists';

/**
 * What is on a shopping list: an item and how many to buy.
 *
 * The item is referenced, never copied, so putting the shopping away restocks
 * that very row, even one used up meanwhile, and a rename shows on the list at
 * once. Deleting an item (a correction) takes it off every list; using it up
 * does not, since that is when it needs buying.
 */
export const shoppingListEntries = pgTable(
  'shopping_list_entries',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Must belong to the same household: see `shopping_list_entries_list_household_fk`. */
    listId: uuid('list_id').notNull(),
    /** Must belong to the same household: see `shopping_list_entries_item_household_fk`. */
    itemId: uuid('item_id').notNull(),
    /** How many to buy, counted in the item's own unit, so an integer like `items.quantity`. */
    quantity: integer('quantity').notNull(),
    /** Ticked off while shopping. Putting the shopping away restocks ticked entries and deletes them. */
    checkedAt: timestamp('checked_at', { withTimezone: true }),
    /**
     * Soft-deleted, like its list: taken off the list, put away, or its item
     * deleted. The row stays as the tombstone a syncing client reads.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    /** Tenancy by key, as for `items`: an entry cannot land on another household's list. */
    foreignKey({
      name: 'shopping_list_entries_list_household_fk',
      columns: [t.householdId, t.listId],
      foreignColumns: [shoppingLists.householdId, shoppingLists.id],
    }).onDelete('cascade'),
    /**
     * Nor name another household's item. Items are only soft-deleted, so the
     * cascade fires only when their household goes.
     */
    foreignKey({
      name: 'shopping_list_entries_item_household_fk',
      columns: [t.householdId, t.itemId],
      foreignColumns: [items.householdId, items.id],
    }).onDelete('cascade'),
    /**
     * An item is on a list once; adding it again leaves the entry as it is
     * (`ON CONFLICT DO NOTHING`). Entries taken off the list are excluded, so
     * the item can go back on later, as a new entry beside the old tombstone.
     */
    uniqueIndex('shopping_list_entries_list_item_idx')
      .on(t.listId, t.itemId)
      .where(sql`deleted_at is null`),
    /** Taking an item off every list when it is deleted. */
    index('shopping_list_entries_item_idx').on(t.itemId),
    index('shopping_list_entries_household_idx').on(t.householdId),
    /** A sync pull walks a household's entries in this order, from its checkpoint. */
    index('shopping_list_entries_household_sync_idx').on(t.householdId, t.updatedAt, t.id),
    check('shopping_list_entries_quantity_positive', sql`quantity > 0`),
  ],
);

export type ShoppingListEntryRow = typeof shoppingListEntries.$inferSelect;
export type NewShoppingListEntryRow = typeof shoppingListEntries.$inferInsert;
