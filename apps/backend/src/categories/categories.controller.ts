import { Controller, Get } from '@nestjs/common';
import type { Category } from '@pantry-pal/shared';

import { Public } from '../auth/access.decorators';
import { CategoriesService } from './categories.service';

/** Read-only reference data for pickers, in display order. Writes live under `/admin/categories`. */
@Public()
@Controller('categories')
export class CategoriesController {
  constructor(private readonly categories: CategoriesService) {}

  @Get()
  list(): Promise<Category[]> {
    return this.categories.list();
  }
}
