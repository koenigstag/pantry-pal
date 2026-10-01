import { BadRequestException, Injectable } from '@nestjs/common';
import { IngredientsRepository } from '@pantry-pal/db';
import { INGREDIENT_SEARCH_LIMIT, type Ingredient, type IngredientMatch } from '@pantry-pal/shared';
import type { IngredientsQueryDto } from '@pantry-pal/shared/dto';

/**
 * Ingredients are global reference data, imported from the Open Food Facts
 * taxonomy (`pnpm --filter @pantry-pal/db db:ingredients`) and never written
 * through the API. Until that import runs, every search comes back empty.
 */
@Injectable()
export class IngredientsService {
  constructor(private readonly ingredients: IngredientsRepository) {}

  /** A search's matches, best first, or the ingredients a lookup names, in `ids`' order. */
  async query({ q, ids, lang }: IngredientsQueryDto): Promise<IngredientMatch[] | Ingredient[]> {
    if ((q === undefined) === (ids === undefined)) {
      throw new BadRequestException('Send either q or ids');
    }

    if (q !== undefined) return this.ingredients.search(q, lang, INGREDIENT_SEARCH_LIMIT);

    const found = new Map(
      (await this.ingredients.findByIds([...new Set(ids)], lang)).map((row) => [row.id, row]),
    );
    return [...new Set(ids)].flatMap((id) => found.get(id) ?? []);
  }
}
