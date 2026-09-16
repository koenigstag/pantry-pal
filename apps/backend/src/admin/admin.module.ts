import { Module } from '@nestjs/common';

import { CategoriesModule } from '../categories/categories.module';
import { SettingsModule } from '../settings/settings.module';
import { UnitsModule } from '../units/units.module';
import { AdminCategoriesController } from './admin-categories.controller';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUnitsController } from './admin-units.controller';

/** Global reference data and defaults. Every route here is `@AdminOnly()`. */
@Module({
  imports: [CategoriesModule, SettingsModule, UnitsModule],
  controllers: [AdminCategoriesController, AdminSettingsController, AdminUnitsController],
})
export class AdminModule {}
