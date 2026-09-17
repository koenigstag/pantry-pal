import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CategoriesModule } from '../categories/categories.module';
import { SettingsModule } from '../settings/settings.module';
import { UnitsModule } from '../units/units.module';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUnitsController } from './admin-units.controller';
import { AdminUsersController } from './admin-users.controller';

/** Global reference data, defaults and password resets. Every route here is `@AdminOnly()`. */
@Module({
  imports: [AuthModule, CategoriesModule, SettingsModule, UnitsModule],
  controllers: [
    AdminCategoriesController,
    AdminSettingsController,
    AdminUnitsController,
    AdminUsersController,
  ],
})
export class AdminModule {}
