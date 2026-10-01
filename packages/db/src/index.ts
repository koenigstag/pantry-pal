export { createDatabase, type Database, type DatabaseHandle } from './client';
export * as schema from './schema';
export type {
  CategoryRow,
  DefaultLocationRow,
  DefaultLocationTranslationRow,
  HouseholdMemberRow,
  HouseholdRow,
  IngredientNameRow,
  IngredientParentRow,
  IngredientRow,
  ItemEventRow,
  ItemRecord,
  LocationRow,
  ProductRow,
  RefreshTokenRow,
  ShoppingListEntryRow,
  ShoppingListRow,
  SubItemRow,
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
  importIngredients,
  INGREDIENT_LANGUAGES,
  OFF_INGREDIENTS_TAXONOMY_URL,
  parseOffTaxonomy,
  type IngredientImportSummary,
  type TaxonomyIngredient,
  type TaxonomyIngredientName,
} from './ingredients-taxonomy';
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
