import { MAX_ITEM_NAME_LENGTH, PANTRY_CATEGORIES, type PantryCategory } from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { inList } from './_sql';
import { households } from './households';
import { units } from './units';

/**
 * The catalog half of product + batch: what a thing *is*, independent of any
 * package currently on a shelf. One product, many `items`.
 */
export const products = pgTable(
  'products',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null marks a shared global catalog row, visible to every household. */
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    name: varchar('name', { length: MAX_ITEM_NAME_LENGTH }).notNull(),
    brand: text('brand'),
    barcode: text('barcode'),
    /**
     * Display-only noun: 'can', 'jar', 'blister'. Carries no arithmetic, which
     * is why it is free text here rather than a unit — `pcs` is the only count
     * unit, so this is what keeps "3 cans of beans" from reading "3 pcs".
     */
    packageLabel: text('package_label'),
    defaultCategory: text('default_category').$type<PantryCategory>(),
    defaultUnit: text('default_unit').references(() => units.code, { onDelete: 'restrict' }),
    defaultShelfLifeDays: integer('default_shelf_life_days'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    /** Partial: most products have no barcode, and those NULLs must not collide. */
    uniqueIndex('products_household_barcode_idx')
      .on(t.householdId, t.barcode)
      .where(sql`barcode is not null`),
    index('products_barcode_idx')
      .on(t.barcode)
      .where(sql`barcode is not null`),
    index('products_household_name_idx').on(t.householdId, sql`lower(name)`),
    check(
      'products_category_check',
      sql`default_category is null or default_category in (${inList(PANTRY_CATEGORIES)})`,
    ),
  ],
);

export type ProductRow = typeof products.$inferSelect;
