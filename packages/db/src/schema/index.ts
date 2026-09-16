/**
 * Drizzle table definitions, one file per aggregate, re-exported here so that
 * `drizzle.config.ts` and `createDatabase()` both see the whole schema through
 * a single import.
 *
 * Export order follows the foreign-key graph: `units` and `users` have no
 * dependencies, everything else builds on `households`.
 */
export * from './units';
export * from './users';
export * from './households';
export * from './locations';
export * from './products';
export * from './items';
export * from './item-events';
