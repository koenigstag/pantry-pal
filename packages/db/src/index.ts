export { createDatabase, type Database, type DatabaseHandle } from './client';
export * as schema from './schema';
export type {
  AppSettingRow,
  CategoryRow,
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
export { CATEGORY_SEED, seedCategories, seedDefaultLocations, seedUnits, UNIT_SEED } from './seed';
export {
  buildConnectionString,
  CONNECTION_ENV_KEYS,
  resolveConnectionString,
  type ConnectionParts,
} from './connection-string';
