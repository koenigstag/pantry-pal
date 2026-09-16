import {
  MAX_ITEM_NAME_LENGTH,
  PANTRY_CATEGORIES,
  QUANTITY_UNIT_KIND,
  type PantryCategory,
} from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { inList, literal } from './_sql';
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
    defaultCategory: text('default_category').$type<PantryCategory>(),
    /**
     * The count unit a new batch is counted in: 'can', 'jar', 'blister'. A count
     * unit for the same reason `items.unit` is one — see
     * `products_default_unit_count_fk`.
     */
    defaultUnit: text('default_unit'),
    /** Always `count`: the half of `products_default_unit_count_fk` that pins the kind. */
    defaultUnitKind: text('default_unit_kind')
      .$type<typeof QUANTITY_UNIT_KIND>()
      .notNull()
      .default(QUANTITY_UNIT_KIND),
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
    /** Not checked while `default_unit` is null: a product need not have a default. */
    foreignKey({
      name: 'products_default_unit_count_fk',
      columns: [t.defaultUnit, t.defaultUnitKind],
      foreignColumns: [units.code, units.kind],
    }).onDelete('restrict'),
    check(
      'products_category_check',
      sql`default_category is null or default_category in (${inList(PANTRY_CATEGORIES)})`,
    ),
    check(
      'products_default_unit_kind_count',
      sql`default_unit_kind = ${literal(QUANTITY_UNIT_KIND)}`,
    ),
  ],
);

export type ProductRow = typeof products.$inferSelect;
