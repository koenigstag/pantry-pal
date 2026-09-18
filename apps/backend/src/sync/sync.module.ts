import { Module } from '@nestjs/common';

import { HouseholdsModule } from '../households/households.module';
import { SyncController } from './sync.controller';
import { SyncService } from './sync.service';

/** The offline mirror's pulls. Repositories come from the global `DatabaseModule`. */
@Module({
  imports: [HouseholdsModule],
  controllers: [SyncController],
  providers: [SyncService],
})
export class SyncModule {}
