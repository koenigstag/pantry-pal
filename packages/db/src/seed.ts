import { DEFAULT_LOCATIONS } from '@pantry-pal/shared';

import { locations, units, type LocationRow, type UnitRow } from './schema';
import type { Executor } from './transaction';

/**
 * The unit reference data.
 *
 * Every factor is exact by definition, not an approximation — do not round
 * them. Mass is identical in both systems (`oz` and `lb` are avoirdupois
 * everywhere); only fluid measures diverge, which is why the US and UK volume
 * codes are distinct rather than a single ambiguous `fl_oz`. A generated total
 * would have no way to know which one a bare `fl_oz` meant.
 *
 * `factor` converts to the base unit for its kind: grams, millilitres, pieces.
 * Nothing reads it yet — conversions are deferred — but the column is here so
 * that adding them later needs no migration and no backfill.
 */
export const UNIT_SEED: readonly UnitRow[] = [
  { code: 'pcs', label: 'pcs', kind: 'count', system: 'both', factor: 1 },

  { code: 'g', label: 'g', kind: 'mass', system: 'metric', factor: 1 },
  { code: 'kg', label: 'kg', kind: 'mass', system: 'metric', factor: 1000 },
  { code: 'ml', label: 'ml', kind: 'volume', system: 'metric', factor: 1 },
  { code: 'l', label: 'l', kind: 'volume', system: 'metric', factor: 1000 },

  { code: 'oz', label: 'oz', kind: 'mass', system: 'imperial', factor: 28.349_523_125 },
  { code: 'lb', label: 'lb', kind: 'mass', system: 'imperial', factor: 453.592_37 },

  {
    code: 'fl_oz_us',
    label: 'fl oz',
    kind: 'volume',
    system: 'imperial',
    factor: 29.573_529_562_5,
  },
  { code: 'cup_us', label: 'cup', kind: 'volume', system: 'imperial', factor: 236.588_236_5 },
  { code: 'pt_us', label: 'pt', kind: 'volume', system: 'imperial', factor: 473.176_473 },
  { code: 'gal_us', label: 'gal', kind: 'volume', system: 'imperial', factor: 3785.411_784 },

  { code: 'fl_oz_uk', label: 'fl oz', kind: 'volume', system: 'imperial', factor: 28.413_062_5 },
  { code: 'pt_uk', label: 'pt', kind: 'volume', system: 'imperial', factor: 568.261_25 },
  { code: 'gal_uk', label: 'gal', kind: 'volume', system: 'imperial', factor: 4546.09 },
];

/**
 * Idempotent: safe to run on every boot and after every migration.
 *
 * `items.unit` is a foreign key into this table, so no item can be written
 * until it has been populated at least once. Accepts a transaction as well as
 * the pool, so it composes into a larger seed.
 */
export async function seedUnits(db: Executor): Promise<void> {
  await db
    .insert(units)
    .values([...UNIT_SEED])
    .onConflictDoNothing({ target: units.code });
}

/**
 * Gives a household the default starting places. They are ordinary rows, so
 * the user can rename, reorder, delete or add to them straight away.
 *
 * Re-running it on an existing household only adds defaults introduced since:
 * the unique index on `(household_id, lower(name))` turns every existing name
 * into a no-op. It would also re-add a default the user deleted, so backfill
 * deliberately rather than on every boot.
 */
export function seedDefaultLocations(db: Executor, householdId: string): Promise<LocationRow[]> {
  return db
    .insert(locations)
    .values(DEFAULT_LOCATIONS.map((name, index) => ({ householdId, name, sortOrder: index })))
    .onConflictDoNothing()
    .returning();
}
