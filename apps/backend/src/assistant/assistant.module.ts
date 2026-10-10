import { Module } from '@nestjs/common';

import { DataModule } from '../data/data.module';
import { HouseholdsModule } from '../households/households.module';
import { ItemsModule } from '../items/items.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { AssistantModel } from './assistant-model';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/** Writes only through the modules it imports: imports for new items, items and lists for the rest. */
@Module({
  imports: [HouseholdsModule, ItemsModule, ShoppingListsModule, DataModule],
  controllers: [AssistantController],
  providers: [AssistantModel, AssistantService],
})
export class AssistantModule {}
