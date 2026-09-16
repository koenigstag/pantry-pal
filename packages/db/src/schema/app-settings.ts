import { jsonb, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/**
 * Global, admin-managed settings as key -> jsonb.
 *
 * Deliberately untyped at this level. The keys, their value types and their
 * defaults live in `@pantry-pal/shared` (`APP_SETTING`), and the backend
 * validates a value against its DTO on every write and every read — so a row
 * edited by hand into a bad shape degrades to the default instead of breaking
 * callers.
 *
 * An absent row means "use the default", so a fresh database needs no seed and
 * resetting a setting is a DELETE.
 */
export const appSettings = pgTable('app_settings', {
  key: text('key').primaryKey(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type AppSettingRow = typeof appSettings.$inferSelect;
