import { Module } from '@nestjs/common';

import { PantryController } from './pantry.controller';
import { PantryGateway } from './pantry.gateway';
import { PantryService } from './pantry.service';

@Module({
  controllers: [PantryController],
  providers: [PantryService, PantryGateway],
  exports: [PantryService],
})
export class PantryModule {}
