import { DEFAULT_CATEGORY, DEFAULT_LOCATIONS, withFallbackLocation } from '@pantry-pal/shared';

import {
  categories,
  locations,
  units,
  type CategoryRow,
  type LocationRow,
  type UnitRow,
} from './schema';
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
 *
 * Count units are what an item is counted in, so containers are units too: a
 * bottle is one piece. Their labels are the singular noun; the frontend's
 * message catalog has the plurals, and shows the label for a code it lacks.
 */
export const UNIT_SEED: readonly UnitRow[] = [
  { code: 'pcs', label: 'pcs', kind: 'count', system: 'both', factor: 1 },
  { code: 'bag', label: 'bag', kind: 'count', system: 'both', factor: 1 },
  { code: 'blister', label: 'blister', kind: 'count', system: 'both', factor: 1 },
  { code: 'bottle', label: 'bottle', kind: 'count', system: 'both', factor: 1 },
  { code: 'box', label: 'box', kind: 'count', system: 'both', factor: 1 },
  { code: 'can', label: 'can', kind: 'count', system: 'both', factor: 1 },
  { code: 'jar', label: 'jar', kind: 'count', system: 'both', factor: 1 },
  { code: 'pack', label: 'pack', kind: 'count', system: 'both', factor: 1 },
  { code: 'pill', label: 'pill', kind: 'count', system: 'both', factor: 1 },
  { code: 'tube', label: 'tube', kind: 'count', system: 'both', factor: 1 },

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
 *
 * Existing codes are left alone, so re-running it only adds the missing ones:
 * units introduced since, and any an admin deleted.
 */
export async function seedUnits(db: Executor): Promise<void> {
  await db
    .insert(units)
    .values([...UNIT_SEED])
    .onConflictDoNothing({ target: units.code });
}

/**
 * The category reference data, in picker order. Positions are 10 apart, so an
 * admin can slot a category between two without renumbering; `other`, the
 * catch-all a new item starts in, comes last.
 *
 * `isEdible` is what items in the category are. Medicine is swallowed but is
 * not food. For `other` it is only where a new item starts: each item in it
 * decides for itself.
 *
 * Labels are English. The frontend's message catalog names these same codes and
 * shows a label only for a code it lacks. Migrations `0002_categories` and
 * `0003_edible` insert and flag this list as it stood then; update them too
 * while they are unreleased, and add a migration once they are.
 */
export const CATEGORY_SEED: readonly CategoryRow[] = [
  { code: 'produce', label: 'Produce', sortOrder: 10, isEdible: true },
  { code: 'dairy', label: 'Dairy', sortOrder: 20, isEdible: true },
  { code: 'meat', label: 'Meat', sortOrder: 30, isEdible: true },
  { code: 'fish', label: 'Fish', sortOrder: 40, isEdible: true },
  { code: 'grains', label: 'Grains', sortOrder: 50, isEdible: true },
  { code: 'canned', label: 'Canned', sortOrder: 60, isEdible: true },
  { code: 'frozen', label: 'Frozen', sortOrder: 70, isEdible: true },
  { code: 'spices', label: 'Spices', sortOrder: 80, isEdible: true },
  { code: 'beverages', label: 'Beverages', sortOrder: 90, isEdible: true },
  { code: 'medicine', label: 'Medicine', sortOrder: 100, isEdible: false },
  { code: 'personal-care', label: 'Personal care', sortOrder: 110, isEdible: false },
  { code: 'cleaning', label: 'Cleaning', sortOrder: 120, isEdible: false },
  { code: DEFAULT_CATEGORY, label: 'Other', sortOrder: 130, isEdible: true },
];

/**
 * Idempotent, like `seedUnits`: existing codes are left alone, including their
 * labels and positions, so re-running it only restores missing defaults.
 */
export async function seedCategories(db: Executor): Promise<void> {
  await db
    .insert(categories)
    .values([...CATEGORY_SEED])
    .onConflictDoNothing({ target: categories.code });
}

/**
 * Gives a household the default starting places, "Other" among them as its
 * fallback. The rest are ordinary rows, so the user can rename, reorder, delete
 * or add to them straight away.
 *
 * Re-running it on an existing household only adds defaults introduced since:
 * the unique index on `(household_id, lower(name))` turns every existing name
 * into a no-op. It would also re-add a default the user deleted, so backfill
 * deliberately rather than on every boot.
 */
export function seedDefaultLocations(db: Executor, householdId: string): Promise<LocationRow[]> {
  const defaults = withFallbackLocation(DEFAULT_LOCATIONS.map((name) => ({ name, icon: null })));

  return db
    .insert(locations)
    .values(
      defaults.map(({ name, icon, isFallback }, index) => ({
        householdId,
        name,
        icon,
        isFallback,
        sortOrder: index,
      })),
    )
    .onConflictDoNothing()
    .returning();
}
