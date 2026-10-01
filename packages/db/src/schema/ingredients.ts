import { sql } from 'drizzle-orm';
import { boolean, check, index, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * What an item is, independent of its name, brand or language: `en:whole-milk`.
 * Recipes will name the same rows, so an item tagged with one can be matched
 * against them whatever the household called it.
 *
 * Global reference data, imported from the Open Food Facts ingredients taxonomy
 * (`pnpm db:ingredients`, ODbL): never written through the API, and never
 * deleted by a re-import, since `items.ingredient_id` may name any row.
 */
export const ingredients = pgTable('ingredients', {
  /**
   * The taxonomy's own id: its canonical language and name, `en:whole-milk`.
   * Immutable — items reference it — and stable across imports.
   */
  id: text('id').primaryKey(),
  /** English, the name wherever the reader's language has none. */
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/**
 * Every name an ingredient goes by, in each language the app speaks: one primary
 * name per language, which is what a reader of that language sees, and its
 * synonyms, which only search reads. English rows are here too, so a search
 * looks in one table.
 */
export const ingredientNames = pgTable(
  'ingredient_names',
  {
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    /** A language, `uk` — the taxonomy names languages, not regions. */
    locale: text('locale').notNull(),
    name: text('name').notNull(),
    /**
     * `name` folded for search by `searchText` in shared: lowercase, without
     * accents or stress marks. Computed by the importer, not by Postgres, whose
     * `unaccent` is not immutable and so cannot be indexed.
     */
    searchName: text('search_name').notNull(),
    /** The language's display name; the rest are synonyms. */
    isPrimary: boolean('is_primary').notNull().default(false),
  },
  (t) => [
    primaryKey({ columns: [t.ingredientId, t.locale, t.searchName] }),
    check('ingredient_names_locale_check', sql`locale ~ '^[a-z]{2,3}$'`),
    /** Substring and similarity search: `LIKE '%…%'` and `%` both use it. */
    index('ingredient_names_search_idx').using('gin', t.searchName.op('gin_trgm_ops')),
  ],
);

/**
 * The taxonomy's hierarchy, `en:whole-milk` under `en:milk`. A graph rather
 * than a tree: a row may have several parents. Recipe matching will read it, so
 * that cheddar satisfies a recipe asking for cheese.
 */
export const ingredientParents = pgTable(
  'ingredient_parents',
  {
    ingredientId: text('ingredient_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
    parentId: text('parent_id')
      .notNull()
      .references(() => ingredients.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.ingredientId, t.parentId] }),
    index('ingredient_parents_parent_idx').on(t.parentId),
  ],
);

export type IngredientRow = typeof ingredients.$inferSelect;
export type NewIngredientRow = typeof ingredients.$inferInsert;
export type IngredientNameRow = typeof ingredientNames.$inferSelect;
export type NewIngredientNameRow = typeof ingredientNames.$inferInsert;
export type IngredientParentRow = typeof ingredientParents.$inferSelect;
