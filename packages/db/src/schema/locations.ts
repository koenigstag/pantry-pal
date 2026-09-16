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
