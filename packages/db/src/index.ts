export { createDatabase, type Database, type DatabaseHandle } from './client';
export * as schema from './schema';
export type {
  CategoryRow,
  DefaultLocationRow,
  DefaultLocationTranslationRow,
  HouseholdMemberRow,
  HouseholdRow,
  ItemEventRow,
  ItemRow,
  LocationRow,
  ProductRow,
  RefreshTokenRow,
  UnitRow,
  UserRow,
} from './schema';
export * from './repositories';
export {
  createTransactionalDatabase,
  currentExecutor,
  isTransactionActive,
  runInTransaction,
  runOnCommit,
  Transactional,
  PROPAGATION,
  type Executor,
  type Propagation,
  type Transaction,
  type TransactionalOptions,
} from './transaction';
export { findPostgresError, PG_ERROR, type PgErrorCode, type PostgresErrorInfo } from './errors';
export {
  CATEGORY_SEED,
  DEFAULT_LOCATION_SEED,
  seedCategories,
  seedDefaultLocations,
  seedHouseholdLocations,
  seedUnits,
  UNIT_SEED,
} from './seed';
export {
  buildConnectionString,
  CONNECTION_ENV_KEYS,
  resolveConnectionString,
  type ConnectionParts,
} from './connection-string';
