import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
} from '@nestjs/common';
import type { Unit } from '@pantry-pal/shared';
import { CreateUnitDto, UpdateUnitDto } from '@pantry-pal/shared/dto';

import { AdminOnly } from '../auth/access.decorators';
import { UnitsService } from '../units/units.service';

/** `/api/v1/admin/units`, authenticated with the `x-admin-api-key` header. */
@AdminOnly()
@Controller('admin/units')
export class AdminUnitsController {
  constructor(private readonly units: UnitsService) {}

  @Get()
  list(): Promise<Unit[]> {
    return this.units.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateUnitDto): Promise<Unit> {
    return this.units.create(dto);
  }

  @Get(':code')
  get(@Param('code') code: string): Promise<Unit> {
    return this.units.get(code);
  }

  @Patch(':code')
  update(@Param('code') code: string, @Body() dto: UpdateUnitDto): Promise<Unit> {
    return this.units.update(code, dto);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('code') code: string): Promise<void> {
    return this.units.remove(code);
  }
}
