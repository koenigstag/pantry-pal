import { sql } from 'drizzle-orm';

const quote = (value: string): string => `'${value.replaceAll("'", "''")}'`;

/**
 * Builds `'a', 'b', 'c'` for CHECK constraints generated from shared constants,
 * so `@pantry-pal/shared` stays the single source of truth for value lists.
 *
 * Note that every raw fragment in this package refers to columns by their bare
 * name. Postgres rejects qualified references such as `"items"."category"`
 * inside CHECK constraints, generated columns and index predicates.
 */
export const inList = (values: readonly string[]) => sql.raw(values.map(quote).join(', '));

/** Builds `'a'`: a CHECK that pins a column to one shared constant. */
export const literal = (value: string) => sql.raw(quote(value));
