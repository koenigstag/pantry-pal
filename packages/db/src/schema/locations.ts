import { sql } from 'drizzle-orm';
import { index, integer, pgTable, text, timestamp, uniqueIndex, uuid } from 'drizzle-orm/pg-core';

import { households } from './households';

/**
 * Seeded per household on creation; users rename, reorder and add their own.
 *
 * Location (_where_ a thing is) is a separate axis from category (_what_ it is).
 * A jar of paprika is location "Spices", category "spices"; ibuprofen is
 * location "Medicines", category "medicine".
 */
export const DEFAULT_LOCATIONS = [
  'Kitchen',
  'Fridge',
  'Freezer',
  'Pantry',
  'Spices',
  'Bathroom',
  'Medicines',
  /** Last, like `'other'` in PANTRY_CATEGORIES: the catch-all for anything unplaced. */
  'Other',
] as const;

export const locations = pgTable(
  'locations',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    icon: text('icon'),
    sortOrder: integer('sort_order').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    /** Case-insensitive, so "Fridge" and "fridge" cannot both exist. */
    uniqueIndex('locations_household_name_idx').on(t.householdId, sql`lower(name)`),
    index('locations_household_sort_idx').on(t.householdId, t.sortOrder),
  ],
);

export type LocationRow = typeof locations.$inferSelect;
