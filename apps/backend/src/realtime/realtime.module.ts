import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { HouseholdsModule } from '../households/households.module';
import { ItemsModule } from '../items/items.module';
import { LocationsModule } from '../locations/locations.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { PantryGateway } from './pantry.gateway';

@Module({
  imports: [AuthModule, HouseholdsModule, ItemsModule, LocationsModule, ShoppingListsModule],
  providers: [PantryGateway],
})
export class RealtimeModule {}
