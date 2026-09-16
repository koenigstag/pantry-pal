import { UNIT_KINDS, UNIT_SYSTEMS, type UnitKind, type UnitSystem } from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import { check, numeric, pgTable, text, unique } from 'drizzle-orm/pg-core';

import { inList } from './_sql';

/**
 * Reference data, not domain logic. Adding `fl_oz_us`, `tbsp` or `carton` is an
 * INSERT, never a migration — which is why `items.unit` is a foreign key and not
 * a CHECK constraint.
 *
 * The kind and system value sets live in `@pantry-pal/shared`, because the
 * admin DTOs validate against the same lists these CHECKs are generated from.
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
  (t) => [
    /**
     * Redundant with the primary key, and there for the foreign keys that must
     * name a count unit (`items_unit_count_fk`): a foreign key can only point at
     * columns under a unique constraint. It also keeps a kind from changing
     * under the rows that rely on it.
     */
    unique('units_code_kind_unique').on(t.code, t.kind),
    check('units_kind_check', sql`kind in (${inList(UNIT_KINDS)})`),
    check('units_system_check', sql`system in (${inList(UNIT_SYSTEMS)})`),
    check('units_factor_positive', sql`factor > 0`),
  ],
);

export type UnitRow = typeof units.$inferSelect;
export type NewUnitRow = typeof units.$inferInsert;
