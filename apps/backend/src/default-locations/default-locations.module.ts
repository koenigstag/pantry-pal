import { Module } from '@nestjs/common';

import { DefaultLocationsService } from './default-locations.service';

@Module({
  providers: [DefaultLocationsService],
  exports: [DefaultLocationsService],
})
export class DefaultLocationsModule {}
