import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

/**
 * The storage spaces every new household starts with. A household gets copies,
 * named in its creator's language through `default_location_translations`, and
 * owns them from then on: no household row references these, so changing the
 * defaults never reaches an existing household.
 *
 * Reference data like `categories`, written through the admin API — but as a
 * whole list, since its order and its one fallback belong to the list.
 */
export const defaultLocations = pgTable(
  'default_locations',
  {
    /** Translations reference it. Lowercase words joined by hyphens: `spices`. */
    code: text('code').primaryKey(),
    /** English: the name wherever no translation applies. */
    name: text('name').notNull(),
    icon: text('icon'),
    /** A new household's order, ascending; ties fall back to the code. */
    sortOrder: integer('sort_order').notNull().default(0),
    /** Becomes the household's fallback location. The admin API requires exactly one. */
    isFallback: boolean('is_fallback').notNull().default(false),
  },
  (t) => [
    /** As within a household, where the copies land. */
    uniqueIndex('default_locations_name_idx').on(sql`lower(name)`),
    uniqueIndex('default_locations_fallback_idx')
      .on(t.isFallback)
      .where(sql`is_fallback`),
  ],
);

/**
 * A default's name in one language. A new household takes the row for its
 * creator's exact tag (`fr-CA`), else for that tag's language (`fr`), else the
 * default's own English `name`. Most rows are languages; a regional row exists
 * only where the wording differs.
 */
export const defaultLocationTranslations = pgTable(
  'default_location_translations',
  {
    code: text('code')
      .notNull()
      .references(() => defaultLocations.code, { onDelete: 'cascade' }),
    /**
     * A BCP 47 language or language-region tag, checked here for its form only.
     * The admin API accepts supported locales and their languages; a CHECK
     * listing them would need a migration for every new language.
     */
    locale: text('locale').notNull(),
    name: text('name').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.code, t.locale] }),
    check('default_location_translations_locale_check', sql`locale ~ '^[a-z]{2,3}(-[A-Z]{2})?$'`),
    /** Two defaults cannot share a name in one language, as within a household. */
    uniqueIndex('default_location_translations_name_idx').on(t.locale, sql`lower(name)`),
  ],
);

export type DefaultLocationRow = typeof defaultLocations.$inferSelect;
export type NewDefaultLocationRow = typeof defaultLocations.$inferInsert;
export type DefaultLocationTranslationRow = typeof defaultLocationTranslations.$inferSelect;
export type NewDefaultLocationTranslationRow = typeof defaultLocationTranslations.$inferInsert;
