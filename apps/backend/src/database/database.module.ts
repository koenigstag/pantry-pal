import {
  Global,
  Inject,
  Logger,
  Module,
  type OnApplicationShutdown,
  type OnModuleInit,
  type Provider,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import {
  CategoriesRepository,
  createDatabase,
  createTransactionalDatabase,
  DefaultLocationsRepository,
  HouseholdMembersRepository,
  HouseholdsRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
  RefreshTokensRepository,
  seedCategories,
  seedDefaultLocations,
  seedUnits,
  ShoppingListEntriesRepository,
  ShoppingListsRepository,
  SubItemsRepository,
  UnitsRepository,
  UsersRepository,
  type Database,
  type DatabaseHandle,
} from '@pantry-pal/db';

import { DatabaseExceptionFilter } from './database-exception.filter';
import { DATABASE, DATABASE_HANDLE } from './database.tokens';

const REPOSITORIES = [
  CategoriesRepository,
  DefaultLocationsRepository,
  HouseholdMembersRepository,
  HouseholdsRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
  RefreshTokensRepository,
  ShoppingListEntriesRepository,
  ShoppingListsRepository,
  SubItemsRepository,
  UnitsRepository,
  UsersRepository,
];

/**
 * Repositories are plain classes from `@pantry-pal/db`, free of Nest decorators
 * on purpose, so each is bridged into DI here with a factory. The class itself
 * is the token, so services inject them by type like any other provider.
 *
 * Every repository receives the transactional proxy, never the raw pool. That is
 * what lets a `@Transactional()` service method pull several repositories into
 * one transaction without passing anything around.
 */
const repositoryProviders: Provider[] = REPOSITORIES.map((Repository) => ({
  provide: Repository,
  inject: [DATABASE],
  useFactory: (db: Database) => new Repository(db),
}));

@Global()
@Module({
  providers: [
    {
      provide: DATABASE_HANDLE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): DatabaseHandle =>
        createDatabase(config.getOrThrow<string>('database.url'), {
          max: config.getOrThrow<number>('database.poolMax'),
        }),
    },
    {
      provide: DATABASE,
      inject: [DATABASE_HANDLE],
      useFactory: (handle: DatabaseHandle): Database => createTransactionalDatabase(handle.db),
    },
    ...repositoryProviders,
    { provide: APP_FILTER, useClass: DatabaseExceptionFilter },
  ],
  exports: [DATABASE, ...REPOSITORIES],
})
export class DatabaseModule implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(DatabaseModule.name);

  constructor(
    @Inject(DATABASE_HANDLE) private readonly handle: DatabaseHandle,
    private readonly units: UnitsRepository,
    private readonly categories: CategoriesRepository,
    private readonly defaultLocations: DefaultLocationsRepository,
  ) {}

  /**
   * Doubles as the startup connectivity check: an unreachable database fails
   * the boot here instead of on the first request.
   *
   * Units, categories and default storage spaces are seeded only into an empty
   * table. Seeding on every boot would resurrect rows an admin deliberately
   * deleted. (Migrations `0002_categories` and `0005_default_locations` already
   * insert theirs; this covers a schema created with `db:push`.)
   */
  async onModuleInit(): Promise<void> {
    if ((await this.units.count()) === 0) {
      await seedUnits(this.handle.db);
      this.logger.log('Seeded the empty units table');
    }
    if ((await this.categories.count()) === 0) {
      await seedCategories(this.handle.db);
      this.logger.log('Seeded the empty categories table');
    }
    if ((await this.defaultLocations.count()) === 0) {
      await seedDefaultLocations(this.handle.db);
      this.logger.log('Seeded the empty default storage spaces');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
