import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
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
 * Copied into each household on creation from the `default-locations` setting
 * (falling back to `DEFAULT_LOCATIONS` in `@pantry-pal/shared`); users rename,
 * reorder and add their own.
 *
 * Location (_where_ a thing is) is a separate axis from category (_what_ it is).
 * A jar of paprika is location "Spices", category "spices"; ibuprofen is
 * location "Medicines", category "medicine".
 */
export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    /** Display order, ascending. Rewritten densely (0..n-1) by a reorder. */
    sortOrder: integer('sort_order').notNull().default(0),
    /**
     * The household's catch-all ("Other"): where a deleted location's active
     * items go unless the caller names another. It can be reordered but neither
     * renamed nor deleted, so every household keeps somewhere to put things.
     * Deleting is refused here too (`locations_fallback_not_deleted`); renaming
     * only by `LocationsService`, since a CHECK cannot see the old name.
     */
    isFallback: boolean('is_fallback').notNull().default(false),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
    /**
     * Soft delete, for the same reasons as `items`: consumed and discarded items
     * keep pointing at the place they lived, and a delta sync needs the tombstone.
     */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
  },
  (t) => [
    /**
     * Case-insensitive, so "Fridge" and "fridge" cannot both exist. Partial, so a
     * deleted "Pantry" does not block creating a new one.
     */
    uniqueIndex('locations_household_name_idx')
      .on(t.householdId, sql`lower(name)`)
      .where(sql`deleted_at is null`),
    index('locations_household_sort_idx').on(t.householdId, t.sortOrder),
    /** A sync pull walks a household's storage spaces in this order, from its checkpoint. */
    index('locations_household_sync_idx').on(t.householdId, t.updatedAt, t.id),
    /** One fallback per household. Creating the household gives it that one. */
    uniqueIndex('locations_household_fallback_idx')
      .on(t.householdId)
      .where(sql`is_fallback`),
    check('locations_fallback_not_deleted', sql`not is_fallback or deleted_at is null`),
    /**
     * Redundant as a uniqueness rule (`id` is already unique), but a composite
     * foreign key needs a unique target: it is what lets `items` require that
     * an item's location belongs to the item's own household.
     */
    unique('locations_household_id_id_unique').on(t.householdId, t.id),
  ],
);

export type LocationRow = typeof locations.$inferSelect;
export type NewLocationRow = typeof locations.$inferInsert;
