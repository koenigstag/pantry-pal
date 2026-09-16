import { Controller, Get } from '@nestjs/common';
import type { Unit } from '@pantry-pal/shared';

import { Public } from '../auth/access.decorators';
import { UnitsService } from './units.service';

/** Read-only reference data for pickers. Writes live under `/admin/units`. */
@Public()
@Controller('units')
export class UnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  list(): Promise<Unit[]> {
    return this.units.list();
  }
}
