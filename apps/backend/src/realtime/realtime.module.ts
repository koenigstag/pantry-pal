import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HouseholdsModule } from '../households/households.module';
import { ItemsModule } from '../items/items.module';
import { LocationsModule } from '../locations/locations.module';
import { PantryGateway } from './pantry.gateway';

@Module({
  imports: [AuthModule, HouseholdsModule, ItemsModule, LocationsModule],
  providers: [PantryGateway],
})
export class RealtimeModule {}
