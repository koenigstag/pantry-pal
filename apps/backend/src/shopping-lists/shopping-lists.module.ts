import { Module } from '@nestjs/common';

import { HouseholdsModule } from '../households/households.module';
import { ItemsModule } from '../items/items.module';
import { ShoppingListsController } from './shopping-lists.controller';
import { ShoppingListsService } from './shopping-lists.service';

/** Imports `ItemsModule` for restocking; items reach lists through repositories, never this module. */
@Module({
  imports: [HouseholdsModule, ItemsModule],
  controllers: [ShoppingListsController],
  providers: [ShoppingListsService],
  exports: [ShoppingListsService],
})
export class ShoppingListsModule {}
