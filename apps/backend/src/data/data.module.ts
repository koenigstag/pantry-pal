import { Module } from '@nestjs/common';

import { HouseholdsModule } from '../households/households.module';
import { DataController } from './data.controller';
import { ExportService } from './export.service';
import { ImportService } from './import.service';

@Module({
  imports: [HouseholdsModule],
  controllers: [DataController],
  providers: [ExportService, ImportService],
})
export class DataModule {}
