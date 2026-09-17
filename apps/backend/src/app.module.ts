import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AdminModule } from './admin/admin.module';
import { AuthModule } from './auth/auth.module';
import { CategoriesModule } from './categories/categories.module';
import { configuration } from './config/configuration';
import { DatabaseModule } from './database/database.module';
import { HealthController } from './health/health.controller';
import { HouseholdsModule } from './households/households.module';
import { ItemsModule } from './items/items.module';
import { LocationsModule } from './locations/locations.module';
import { ChangeFeedModule } from './realtime/change-feed';
import { RealtimeModule } from './realtime/realtime.module';
import { ShoppingListsModule } from './shopping-lists/shopping-lists.module';
import { UnitsModule } from './units/units.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [configuration],
      // `.env.local` holds developer-specific overrides and is git-ignored.
      envFilePath: ['.env.local', '.env'],
    }),
    DatabaseModule,
    ChangeFeedModule,
    AuthModule,
    UnitsModule,
    CategoriesModule,
    HouseholdsModule,
    LocationsModule,
    ItemsModule,
    ShoppingListsModule,
    AdminModule,
    RealtimeModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
