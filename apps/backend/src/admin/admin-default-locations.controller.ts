import { Body, Controller, Get, Put } from '@nestjs/common';
import type { DefaultLocation } from '@pantry-pal/shared';
import { ReplaceDefaultLocationsDto } from '@pantry-pal/shared/dto';

import { AdminOnly } from '../auth/access.decorators';
import { DefaultLocationsService } from '../default-locations/default-locations.service';

/**
 * `/api/v1/admin/default-locations`, authenticated with the `x-admin-api-key`
 * header: the storage spaces every new household starts with.
 */
@AdminOnly()
@Controller('admin/default-locations')
export class AdminDefaultLocationsController {
  constructor(private readonly defaults: DefaultLocationsService) {}

  /** In the order a new household gets them, each with its translations. */
  @Get()
  list(): Promise<DefaultLocation[]> {
    return this.defaults.list();
  }

  /** Replaces the whole list. Households created from now on get it; existing ones keep theirs. */
  @Put()
  replace(@Body() dto: ReplaceDefaultLocationsDto): Promise<DefaultLocation[]> {
    return this.defaults.replace(dto);
  }
}
