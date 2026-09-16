import { boolean, integer, pgTable, text } from 'drizzle-orm/pg-core';

/**
 * Reference data, like `units`: adding `pet-supplies` is an INSERT through the
 * admin API, never a migration — which is why `items.category` and
 * `products.default_category` are foreign keys and not CHECK constraints.
 */
export const categories = pgTable('categories', {
  /** Immutable: items and products reference it. Lowercase words joined by hyphens. */
  code: text('code').primaryKey(),
  /** English. The frontend shows its own catalog's name for a code it knows. */
  label: text('label').notNull(),
  /** Picker order, ascending; ties fall back to the code. */
  sortOrder: integer('sort_order').notNull().default(0),
  /**
   * Food or drink. Items in the category copy it — except in the default
   * category (`other`), where it is only where a new item starts and each item
   * decides for itself.
   */
  isEdible: boolean('is_edible').notNull().default(true),
});

export type CategoryRow = typeof categories.$inferSelect;
export type NewCategoryRow = typeof categories.$inferInsert;
