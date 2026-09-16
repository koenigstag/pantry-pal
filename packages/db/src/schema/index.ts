/**
 * Drizzle table definitions, one file per aggregate, re-exported here so that
 * `drizzle.config.ts` and `createDatabase()` both see the whole schema through
 * a single import.
 *
 * Export order follows the foreign-key graph: `units`, `users` and
 * `app_settings` have no dependencies, everything else builds on `households`.
 *
 * Value sets (roles, statuses, event types, unit kinds) are not defined here:
 * they live in `@pantry-pal/shared`, because the request DTOs and the frontend
 * need the same lists the CHECK constraints are generated from.
 */
export * from './units';
export * from './users';
export * from './app-settings';
export * from './households';
export * from './locations';
export * from './products';
export * from './items';
export * from './item-events';
