/**
 * Drizzle table definitions.
 *
 * Empty for now — this package is a skeleton. Tables land here one file per
 * aggregate, re-exported from this barrel so that both `drizzle.config.ts` and
 * `createDatabase()` see the whole schema through a single import.
 *
 * The agreed design (households/household_members tenancy, products + items
 * batches, a `units` lookup table, a generated `effective_expires_at`, soft
 * deletes and `pg_notify` change events) is recorded in this package's
 * CLAUDE.md, along with the one blocker that must be resolved first.
 */

// isolatedModules (tsconfig.base.json) treats a file with no import or export as
// a global script, and `createDatabase` does `import * as schema from './schema'`.
// TypeScript's own guidance for this case is an empty export.
// oxlint-disable-next-line unicorn/require-module-specifiers
export {};
