import { MAX_RECIPE_TITLE_LENGTH, type RecipeDocument } from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import {
  check,
  index,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar,
} from 'drizzle-orm/pg-core';

import { households } from './households';
import { users } from './users';

/**
 * Recipes, kept as Cooklang text (https://cooklang.org) in the language they
 * were written in, beside the JSON the backend parses from it.
 *
 * One table, two roles, like `products`: a row with a `household_id` is that
 * household's own, imported by a member; a row without is a recommendation,
 * the same for every household and written through the admin API. A household
 * keeps the recommendations it likes in `recipe_favourites`.
 *
 * `document` is derived: the backend parses `source` whenever it writes one,
 * and nothing writes the JSON alone. It is stored so clients never parse, and
 * so ingredients can be searched.
 */
export const recipes = pgTable(
  'recipes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Null marks a recommendation, visible to every household. */
    householdId: uuid('household_id').references(() => households.id, { onDelete: 'cascade' }),
    /** The language `source` is written in, as a BCP 47 tag. Checked for its form only. */
    locale: text('locale').notNull(),
    /** From the text's `title` metadata, kept as a column to list recipes without their documents. */
    title: varchar('title', { length: MAX_RECIPE_TITLE_LENGTH }).notNull(),
    /** Cooklang text, as written or imported. */
    source: text('source').notNull(),
    document: jsonb('document').$type<RecipeDocument>().notNull(),
    /** The page it was imported from, or credited to. */
    sourceUrl: text('source_url'),
    imageUrl: text('image_url'),
    /** The member who imported it; null for recommendations, and once they leave no trace. */
    createdBy: uuid('created_by').references(() => users.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('recipes_locale_check', sql`locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'`),
    index('recipes_household_created_idx').on(t.householdId, t.createdAt),
    /** Importing a page twice finds the first copy. Partial: recommendations and hand-written recipes repeat freely. */
    uniqueIndex('recipes_household_source_url_idx')
      .on(t.householdId, t.sourceUrl)
      .where(sql`household_id is not null and source_url is not null`),
  ],
);

/**
 * A recipe in another language: its own Cooklang text and the JSON parsed from
 * it. A reader takes the row for their exact tag (`fr-CA`), else for its
 * language (`fr`), else the recipe as written — `pickTranslation` in
 * `@pantry-pal/shared`.
 */
export const recipeTranslations = pgTable(
  'recipe_translations',
  {
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    locale: text('locale').notNull(),
    title: varchar('title', { length: MAX_RECIPE_TITLE_LENGTH }).notNull(),
    source: text('source').notNull(),
    document: jsonb('document').$type<RecipeDocument>().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.recipeId, t.locale] }),
    check('recipe_translations_locale_check', sql`locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'`),
  ],
);

/**
 * The recommendations a household saved. Its own recipes need no row: they
 * are its favourites by being its own. That a row names a recommendation, not
 * another household's recipe, is the backend's to keep: a CHECK cannot see
 * the recipe's row.
 */
export const recipeFavourites = pgTable(
  'recipe_favourites',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    recipeId: uuid('recipe_id')
      .notNull()
      .references(() => recipes.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.householdId, t.recipeId] })],
);

export type RecipeRow = typeof recipes.$inferSelect;
export type NewRecipeRow = typeof recipes.$inferInsert;
export type RecipeTranslationRow = typeof recipeTranslations.$inferSelect;
export type NewRecipeTranslationRow = typeof recipeTranslations.$inferInsert;
