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
import type { PantryItem } from '@pantry-pal/shared';
import { CreatePantryItemDto, UpdatePantryItemDto } from '@pantry-pal/shared/dto';

import { PantryService } from './pantry.service';

/**
 * Mounted under the global prefix, so the effective base path is
 * `/api/v1/items` (see `API_BASE_PATH` in `@pantry-pal/shared`).
 *
 * The DTOs are imported as values, not types: Nest's `ValidationPipe` reads the
 * runtime class from the parameter's decorator metadata.
 */
@Controller('items')
export class PantryController {
  constructor(private readonly pantry: PantryService) {}

  @Get()
  findAll(): PantryItem[] {
    return this.pantry.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string): PantryItem {
    return this.pantry.findOne(id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreatePantryItemDto): PantryItem {
    return this.pantry.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePantryItemDto): PantryItem {
    return this.pantry.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('id') id: string): void {
    this.pantry.remove(id);
  }
}
