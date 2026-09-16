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
import type { Category } from '@pantry-pal/shared';
import { CreateCategoryDto, UpdateCategoryDto } from '@pantry-pal/shared/dto';

import { AdminOnly } from '../auth/access.decorators';
import { CategoriesService } from '../categories/categories.service';

/** `/api/v1/admin/categories`, authenticated with the `x-admin-api-key` header. */
@AdminOnly()
@Controller('admin/categories')
export class AdminCategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(): Promise<Category[]> {
    return this.categories.list();
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: CreateCategoryDto): Promise<Category> {
    return this.categories.create(dto);
  }

  @Get(':code')
  get(@Param('code') code: string): Promise<Category> {
    return this.categories.get(code);
  }

  @Patch(':code')
  update(@Param('code') code: string, @Body() dto: UpdateCategoryDto): Promise<Category> {
    return this.categories.update(code, dto);
  }

  @Delete(':code')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('code') code: string): Promise<void> {
    return this.categories.remove(code);
  }
}
