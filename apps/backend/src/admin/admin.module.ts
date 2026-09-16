import { Module } from '@nestjs/common';

import { SettingsModule } from '../settings/settings.module';
import { UnitsModule } from '../units/units.module';
import { AdminSettingsController } from './admin-settings.controller';
import { AdminUnitsController } from './admin-units.controller';

/** Global reference data and defaults. Every route here is `@AdminOnly()`. */
@Module({
  imports: [SettingsModule, UnitsModule],
  controllers: [AdminSettingsController, AdminUnitsController],
})
export class AdminModule {}
