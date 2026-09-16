import { sql } from 'drizzle-orm';
import { check, numeric, pgTable, text } from 'drizzle-orm/pg-core';

import { inList } from './_sql';

/** Conversions never bridge two kinds: `oz` is mass, `fl oz` is volume. */
export const UNIT_KINDS = ['mass', 'volume', 'count'] as const;
export const UNIT_SYSTEMS = ['metric', 'imperial', 'both'] as const;

export type UnitKind = (typeof UNIT_KINDS)[number];
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];

/**
 * Reference data, not domain logic. Adding `fl_oz_us` or `tbsp` is an INSERT,
 * never a migration — which is why `items.unit` is a foreign key and not a
 * CHECK constraint.
 */
export const units = pgTable(
  'units',
  {
    /** Unambiguous by design: `fl_oz_us` and `fl_oz_uk` differ by 4%, pints by 20%. */
    code: text('code').primaryKey(),
    /** Rendered verbatim by the frontend: 'ml', 'fl oz'. */
    label: text('label').notNull(),
    kind: text('kind').$type<UnitKind>().notNull(),
    /** Filters the create/edit picker only; never restricts what can be stored. */
    system: text('system').$type<UnitSystem>().notNull(),
    /** To base g | ml | pcs. Exact by definition. Nothing reads it yet. */
    factor: numeric('factor', { precision: 20, scale: 10, mode: 'number' }).notNull(),
  },
  () => [
    check('units_kind_check', sql`kind in (${inList(UNIT_KINDS)})`),
    check('units_system_check', sql`system in (${inList(UNIT_SYSTEMS)})`),
    check('units_factor_positive', sql`factor > 0`),
  ],
);

export type UnitRow = typeof units.$inferSelect;
