import { searchText, SUPPORTED_LANGUAGES } from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';

import type { Database } from './client';
import {
  ingredientNames,
  ingredientParents,
  ingredients,
  type NewIngredientNameRow,
  type NewIngredientRow,
} from './schema';

/**
 * The Open Food Facts ingredients taxonomy as one JSON file: every entry's
 * names, synonyms and parents in every language. ODbL — the app credits Open
 * Food Facts wherever it shows these names.
 */
export const OFF_INGREDIENTS_TAXONOMY_URL =
  'https://static.openfoodfacts.org/data/taxonomies/ingredients.full.json';

/** The languages the app speaks: the only names worth storing. */
export const INGREDIENT_LANGUAGES = SUPPORTED_LANGUAGES;

/**
 * Branches of the taxonomy that are not things anyone keeps on a shelf: what
 * food labels list (flavourings, enzymes, wine grape varieties), not what
 * recipes call for. Each goes with everything under it.
 */
const EXCLUDED_BRANCHES = [
  'en:enzyme',
  'en:extract',
  'en:ferment',
  'en:fiber',
  'en:flavouring',
  'en:minerals',
  'en:preparation',
  'en:protein',
  'en:varietal',
  'en:vitamins',
];

/**
 * Variants that differ from their parent only in where they come from or how
 * they were labelled — "rice from Italy", "organic milk" — which would crowd
 * search with near-duplicates of the thing itself.
 */
const VARIANT_ID = /-from-|-of-origin|-origin$|^en:organic-/;

/** Additives by their E number: `en:e330`. */
const E_NUMBER_ID = /^[a-z]{2}:e\d/;

interface TaxonomyEntry {
  name?: Record<string, string>;
  synonyms?: Record<string, string[]>;
  parents?: string[];
  children?: string[];
  e_number?: unknown;
  additives_classes?: unknown;
}

export interface TaxonomyIngredientName {
  readonly locale: string;
  readonly name: string;
  readonly isPrimary: boolean;
}

export interface TaxonomyIngredient {
  readonly id: string;
  /** English. */
  readonly name: string;
  readonly names: readonly TaxonomyIngredientName[];
  /** Parents that were kept too; an edge to a dropped entry is dropped with it. */
  readonly parents: readonly string[];
}

/**
 * The entries of `ingredients.full.json` worth offering, with their names in
 * `languages`. Kept: everything with an English name, outside the excluded
 * branches, that is neither an additive nor an origin or label variant.
 */
export function parseOffTaxonomy(
  raw: unknown,
  languages: readonly string[] = INGREDIENT_LANGUAGES,
): TaxonomyIngredient[] {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new Error('The taxonomy is not a JSON object of entries');
  }
  const taxonomy = raw as Record<string, TaxonomyEntry>;

  const excluded = new Set<string>();
  const exclude = (id: string): void => {
    if (excluded.has(id)) return;
    excluded.add(id);
    for (const child of taxonomy[id]?.children ?? []) exclude(child);
  };
  for (const branch of EXCLUDED_BRANCHES) exclude(branch);

  const kept = new Map<string, TaxonomyEntry & { name: Record<string, string> }>();
  for (const [id, entry] of Object.entries(taxonomy)) {
    const english = entry.name?.en?.trim();
    if (
      english === undefined ||
      english === '' ||
      excluded.has(id) ||
      E_NUMBER_ID.test(id) ||
      VARIANT_ID.test(id) ||
      entry.e_number !== undefined ||
      entry.additives_classes !== undefined
    ) {
      continue;
    }
    kept.set(id, entry as TaxonomyEntry & { name: Record<string, string> });
  }

  return [...kept].map(([id, entry]) => ({
    id,
    name: entry.name.en!.trim(),
    names: languages.flatMap((locale) => namesIn(entry, locale)),
    parents: (entry.parents ?? []).filter((parent) => parent !== id && kept.has(parent)),
  }));
}

/** The primary name first, then the synonyms that fold to something else. */
function namesIn(entry: TaxonomyEntry, locale: string): TaxonomyIngredientName[] {
  const names: TaxonomyIngredientName[] = [];
  const seen = new Set<string>();
  const add = (name: string, isPrimary: boolean): void => {
    const trimmed = name.trim();
    const key = searchText(trimmed);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    names.push({ locale, name: trimmed, isPrimary });
  };

  const primary = entry.name?.[locale];
  if (primary !== undefined) add(primary, true);
  for (const synonym of entry.synonyms?.[locale] ?? []) add(synonym, false);

  return names;
}

export interface IngredientImportSummary {
  readonly ingredients: number;
  readonly names: number;
  readonly parents: number;
}

/** Rows per INSERT: well under Postgres' 65,535 bind parameters. */
const CHUNK = 1000;

const chunks = <T>(rows: readonly T[]): T[][] =>
  Array.from({ length: Math.ceil(rows.length / CHUNK) }, (_, i) =>
    rows.slice(i * CHUNK, (i + 1) * CHUNK),
  );

/**
 * Writes the taxonomy in one transaction, as often as it is run.
 *
 * - Ingredients are upserted and **never deleted**: items may name any of them.
 *   One the taxonomy dropped keeps its row and its English `name`, so items
 *   tagged with it still show it.
 * - Names and parents are replaced whole, so a dropped ingredient has no names
 *   left and leaves search, and a renamed one is found by its new name only.
 */
export async function importIngredients(
  db: Database,
  entries: readonly TaxonomyIngredient[],
): Promise<IngredientImportSummary> {
  const ingredientRows: NewIngredientRow[] = entries.map(({ id, name }) => ({ id, name }));
  const nameRows: NewIngredientNameRow[] = entries.flatMap(({ id, names }) =>
    names.map(({ locale, name, isPrimary }) => ({
      ingredientId: id,
      locale,
      name,
      searchName: searchText(name),
      isPrimary,
    })),
  );
  const parentRows = entries.flatMap(({ id, parents }) =>
    parents.map((parentId) => ({ ingredientId: id, parentId })),
  );

  await db.transaction(async (tx) => {
    // One statement at a time: a transaction is one connection, which runs them in turn anyway.
    /* oxlint-disable no-await-in-loop */
    for (const rows of chunks(ingredientRows)) {
      await tx
        .insert(ingredients)
        .values(rows)
        .onConflictDoUpdate({
          target: ingredients.id,
          set: { name: sql`excluded.name`, updatedAt: sql`now()` },
          // Leaves `updated_at` alone where nothing changed.
          setWhere: sql`${ingredients.name} is distinct from excluded.name`,
        });
    }

    await tx.delete(ingredientNames);
    for (const rows of chunks(nameRows)) await tx.insert(ingredientNames).values(rows);

    await tx.delete(ingredientParents);
    for (const rows of chunks(parentRows)) await tx.insert(ingredientParents).values(rows);
    /* oxlint-enable no-await-in-loop */
  });

  return { ingredients: ingredientRows.length, names: nameRows.length, parents: parentRows.length };
}
