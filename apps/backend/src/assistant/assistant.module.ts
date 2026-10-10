import { Module } from '@nestjs/common';

import { ChangesModule } from '../changes/changes.module';
import { HouseholdsModule } from '../households/households.module';
import { AssistantModel } from './assistant-model';
import { AssistantController } from './assistant.controller';
import { AssistantService } from './assistant.service';

/** Reads and proposes; the changes it proposes are applied by `ChangesModule`. */
@Module({
  imports: [HouseholdsModule, ChangesModule],
  controllers: [AssistantController],
  providers: [AssistantModel, AssistantService],
})
export class AssistantModule {}
