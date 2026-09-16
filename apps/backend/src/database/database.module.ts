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
  AppSettingsRepository,
  createDatabase,
  createTransactionalDatabase,
  HouseholdMembersRepository,
  HouseholdsRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
  seedUnits,
  UnitsRepository,
  UsersRepository,
  type Database,
  type DatabaseHandle,
} from '@pantry-pal/db';

import { DatabaseExceptionFilter } from './database-exception.filter';
import { DATABASE, DATABASE_HANDLE } from './database.tokens';

const REPOSITORIES = [
  AppSettingsRepository,
  HouseholdMembersRepository,
  HouseholdsRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
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
  ) {}

  /**
   * Doubles as the startup connectivity check: an unreachable database fails
   * the boot here instead of on the first request.
   *
   * Units are seeded only into an empty table. Seeding on every boot would
   * resurrect units an admin deliberately deleted.
   */
  async onModuleInit(): Promise<void> {
    if ((await this.units.count()) === 0) {
      await seedUnits(this.handle.db);
      this.logger.log('Seeded the empty units table');
    }
  }

  async onApplicationShutdown(): Promise<void> {
    await this.handle.close();
  }
}
