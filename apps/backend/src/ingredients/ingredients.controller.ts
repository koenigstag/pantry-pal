import { Controller, Get, Query } from '@nestjs/common';
import type { Ingredient, IngredientMatch } from '@pantry-pal/shared';
import { IngredientsQueryDto } from '@pantry-pal/shared/dto';

import { IngredientsService } from './ingredients.service';

/**
 * Read-only reference data for the item form's ingredient picker:
 * `?q=молоко&lang=uk` searches, `?ids=en:milk,en:egg&lang=uk` names the
 * ingredients items hold. Signed in, unlike units and categories, since a
 * search costs more than a list.
 */
@Controller('ingredients')
export class IngredientsController {
  constructor(private readonly ingredients: IngredientsService) {}

  @Get()
  query(@Query() query: IngredientsQueryDto): Promise<IngredientMatch[] | Ingredient[]> {
    return this.ingredients.query(query);
  }
}
