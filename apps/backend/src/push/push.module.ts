import { Global, Module } from '@nestjs/common';

import { JobsModule } from '../jobs/jobs.module';
import { PushActivity } from './push-activity';
import { PushDevicesService } from './push-devices.service';
import { PushNotifier } from './push-notifier.service';
import { PushSender } from './push-sender.service';
import { PushController } from './push.controller';

/**
 * Global, like `ChangeFeedModule`, so the domain services can record activity
 * without importing this module, and it imports none of theirs: its own reads
 * go through the repositories, so no cycle can form.
 */
@Global()
@Module({
  imports: [JobsModule],
  controllers: [PushController],
  providers: [PushSender, PushActivity, PushDevicesService, PushNotifier],
  exports: [PushActivity],
})
export class PushModule {}
