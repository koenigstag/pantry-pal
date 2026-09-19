import { Module } from '@nestjs/common';

import { HouseholdsModule } from '../households/households.module';
import { ItemsModule } from '../items/items.module';
import { ShoppingListsModule } from '../shopping-lists/shopping-lists.module';
import { SyncPushService } from './sync-push.service';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/**
 * The offline mirror's pulls and pushes. Pushes go through `ItemsService` and
 * `ShoppingListsService`, so their rules hold for offline writes too;
 * repositories come from the global `DatabaseModule`.
 */
@Module({
  imports: [HouseholdsModule, ItemsModule, ShoppingListsModule],
  controllers: [SyncController],
  providers: [SyncService, SyncPushService],
})
export class SyncModule {}
