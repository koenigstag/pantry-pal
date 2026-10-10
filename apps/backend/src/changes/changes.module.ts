import { Module } from '@nestjs/common';

import { DataModule } from '../data/data.module';
import { ItemsModule } from '../items/items.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { ChangesService } from './changes.service';

/** Writes only through the modules it imports: imports for new items, items and lists for the rest. */
@Module({
  imports: [ItemsModule, ShoppingListsModule, DataModule],
  providers: [ChangesService],
  exports: [ChangesService],
})
export class ChangesModule {}
