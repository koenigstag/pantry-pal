import { searchText, SUPPORTED_LANGUAGES } from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';

import type { Database } from './client';
import {
  categories,
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

/**
 * Which category an ingredient's items most likely belong in, by the branch of
 * the taxonomy it sits under: the nearest such branch decides, and among
 * branches equally near, the first listed here — tomato juice is a juice before
 * it is a vegetable. Codes of `CATEGORY_SEED`. Canned and frozen are how a thing
 * is kept, not what it is, so no branch leads there; nor to the non-food
 * categories. Anything else gets none, and an item keeps its own.
 */
export const CATEGORY_BRANCHES: readonly (readonly [branch: string, category: string])[] = [
  ['en:juice', 'beverages'],
  ['en:alcohol', 'beverages'],
  ['en:coffee', 'beverages'],
  ['en:tea', 'beverages'],
  ['en:water', 'beverages'],
  ['en:fish', 'fish'],
  ['en:shellfish', 'fish'],
  ['en:meat', 'meat'],
  ['en:poultry', 'meat'],
  ['en:game-animal', 'meat'],
  ['en:dairy', 'dairy'],
  ['en:egg', 'dairy'],
  ['en:cereal', 'grains'],
  ['en:flour', 'grains'],
  ['en:rice', 'grains'],
  ['en:bread', 'grains'],
  ['en:dough', 'grains'],
  ['en:pulse', 'grains'],
  ['en:spice', 'spices'],
  ['en:herb', 'spices'],
  ['en:salt', 'spices'],
  ['en:pepper', 'spices'],
  ['en:vegetable', 'produce'],
  ['en:fruit', 'produce'],
  ['en:mushroom', 'produce'],
];

/**
 * Entries that are no ingredient at all: numbering and markers copied from
 * ingredient lists (`n°`, `no1`), colour words, and label jargon.
 */
const NOT_AN_INGREDIENT_ID = /^en:(n|no\d+|fd-c|colourful|grey|carrier|sorrel-or-acid)$/;

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
  /** A category code from `CATEGORY_BRANCHES`, or `null`. */
  readonly category: string | null;
}

/**
 * The entries of `ingredients.full.json` worth offering, with their names in
 * `languages`. Kept: everything with an English name, outside the excluded
 * branches, that is neither an additive nor an origin or label variant.
 */
/**
 * Names the taxonomy lacks, by language and then ingredient id: the primary
 * name first, then synonyms. `data/ingredient-names.<language>.json`, machine
 * translated and reviewed by hand; see `scripts/import-ingredients.mjs`.
 */
export type IngredientTranslations = Readonly<
  Record<string, Readonly<Record<string, readonly string[]>>>
>;

export interface ParseTaxonomyOptions {
  /** The languages to keep names in; the app's own by default. */
  languages?: readonly string[];
  /**
   * Names to add where the taxonomy has none. The taxonomy's own primary name
   * always wins: once it has one, a translation here only adds synonyms.
   */
  translations?: IngredientTranslations;
}

export function parseOffTaxonomy(
  raw: unknown,
  { languages = INGREDIENT_LANGUAGES, translations = {} }: ParseTaxonomyOptions = {},
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
      NOT_AN_INGREDIENT_ID.test(id) ||
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
    names: languages.flatMap((locale) => namesIn(entry, locale, translations[locale]?.[id])),
    parents: (entry.parents ?? []).filter((parent) => parent !== id && kept.has(parent)),
    category: categoryOf(taxonomy, id),
  }));
}

/**
 * Juices the taxonomy files only under their fruit — tomato juice sits under
 * tomato alone — named for what they are: `…-juice`, but not `…-in-…-juice`,
 * tomatoes in their juice.
 */
const JUICE_ID = /^(?!.*-in-).*-juice$/;

const BRANCH_RANK = new Map(CATEGORY_BRANCHES.map(([branch], rank) => [branch, rank]));
const BRANCH_CATEGORY = new Map(CATEGORY_BRANCHES);

/**
 * The category of the nearest branch above `id`, itself included, walking the
 * whole taxonomy — dropped entries too, which still say where a thing sits.
 */
function categoryOf(taxonomy: Record<string, TaxonomyEntry>, id: string): string | null {
  if (JUICE_ID.test(id)) return 'beverages';
  const seen = new Set<string>([id]);
  let level = [id];
  while (level.length > 0) {
    const branch = level
      .filter((node) => BRANCH_RANK.has(node))
      .toSorted((a, b) => BRANCH_RANK.get(a)! - BRANCH_RANK.get(b)!)[0];
    if (branch !== undefined) return BRANCH_CATEGORY.get(branch) ?? null;

    level = level
      .flatMap((node) => taxonomy[node]?.parents ?? [])
      .filter((parent) => !seen.has(parent) && seen.add(parent));
  }
  return null;
}

/**
 * The primary name first, then the synonyms that fold to something else: the
 * taxonomy's primary, else the translation's, then the taxonomy's synonyms, then
 * the rest of the translation's.
 */
function namesIn(
  entry: TaxonomyEntry,
  locale: string,
  translated: readonly string[] = [],
): TaxonomyIngredientName[] {
  const names: TaxonomyIngredientName[] = [];
  const seen = new Set<string>();
  const add = (name: string, isPrimary: boolean): void => {
    const tidy = tidyName(locale, name);
    const key = searchText(tidy);
    if (key === '' || seen.has(key)) return;
    seen.add(key);
    names.push({ locale, name: tidy, isPrimary });
  };

  const primary = entry.name?.[locale];
  const [translatedPrimary, ...translatedSynonyms] = translated;
  if (primary !== undefined) add(primary, true);
  else if (translatedPrimary !== undefined) add(translatedPrimary, true);
  for (const synonym of entry.synonyms?.[locale] ?? []) add(synonym, false);
  if (primary !== undefined && translatedPrimary !== undefined) add(translatedPrimary, false);
  for (const synonym of translatedSynonyms) add(synonym, false);

  return names;
}

/** Languages written in Cyrillic, whose nouns take no capital. */
const CYRILLIC_LANGUAGES = new Set(['ru', 'uk']);

/** Latin letters that look like Cyrillic ones, typed by mistake into Cyrillic words. */
const CYRILLIC_LOOKALIKES: Readonly<Record<string, string>> = {
  a: 'а',
  c: 'с',
  e: 'е',
  k: 'к',
  m: 'м',
  o: 'о',
  p: 'р',
  x: 'х',
  y: 'у',
  A: 'А',
  B: 'В',
  C: 'С',
  E: 'Е',
  H: 'Н',
  K: 'К',
  M: 'М',
  O: 'О',
  P: 'Р',
  T: 'Т',
  X: 'Х',
};

/**
 * A name as the taxonomy's contributors typed it, made presentable in a
 * Cyrillic language: no stress marks (`ма́сло`), no Latin letters inside
 * Cyrillic words (`cливочное` with a Latin c), and no capital on a common noun
 * (`Молоко`), though an abbreviation keeps its capitals. Elsewhere it is only
 * trimmed.
 */
function tidyName(locale: string, name: string): string {
  const trimmed = name.trim().replace(/\s+/g, ' ');
  if (!CYRILLIC_LANGUAGES.has(locale)) return trimmed;

  const unstressed = trimmed
    .normalize('NFD')
    .replace(/[\u0300\u0301]/g, '')
    .normalize('NFC');
  const cyrillic = unstressed.replace(/[\p{L}]+/gu, (word) =>
    /\p{Script=Cyrillic}/u.test(word)
      ? word.replace(/[A-Za-z]/g, (letter) => CYRILLIC_LOOKALIKES[letter] ?? letter)
      : word,
  );
  const [first = '', second = ''] = cyrillic;
  return second === second.toLowerCase() && second !== second.toUpperCase()
    ? first.toLowerCase() + cyrillic.slice(1)
    : cyrillic;
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
 * - Ingredients are upserted, their categories with them, and **never deleted**: items may name any of them.
 *   One the taxonomy dropped keeps its row and its English `name`, so items
 *   tagged with it still show it.
 * - Names and parents are replaced whole, so a dropped ingredient has no names
 *   left and leaves search, and a renamed one is found by its new name only.
 */
export async function importIngredients(
  db: Database,
  entries: readonly TaxonomyIngredient[],
): Promise<IngredientImportSummary> {
  // A category an admin has deleted since is left out rather than failing the key.
  const known = new Set(
    (await db.select({ code: categories.code }).from(categories)).map((row) => row.code),
  );
  const ingredientRows: NewIngredientRow[] = entries.map(({ id, name, category }) => ({
    id,
    name,
    category: category !== null && known.has(category) ? category : null,
  }));
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
          set: {
            name: sql`excluded.name`,
            category: sql`excluded.category`,
            updatedAt: sql`now()`,
          },
          // Leaves `updated_at` alone where nothing changed.
          setWhere: sql`(${ingredients.name}, ${ingredients.category}) is distinct from (excluded.name, excluded.category)`,
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
