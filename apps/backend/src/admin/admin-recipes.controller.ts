import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import type { AdminRecipe, RecipeRelinkSummary } from '@pantry-pal/shared';
import { AdminRecipeDto } from '@pantry-pal/shared/dto';

import { AdminOnly } from '../auth/access.decorators';
import { RecipesService } from '../recipes/recipes.service';

/**
 * `/api/v1/admin/recipes`, authenticated with the `x-admin-api-key` header: the
 * recommendations every household sees, each as Cooklang text with its
 * translations. Households that saved one see a change at their next read.
 */
@AdminOnly()
@Controller('admin/recipes')
export class AdminRecipesController {
  constructor(private readonly recipes: RecipesService) {}

  /** Newest first, each with every translation. */
  @Get()
  list(): Promise<AdminRecipe[]> {
    return this.recipes.listRecommendations();
  }

  /**
   * Parses every recipe again, the households' own included, and matches its
   * ingredients anew. Run it after `pnpm db:ingredients`: recipes saved before
   * the ingredients were there matched none. Declared before `:recipeId`.
   */
  @Post('relink')
  @HttpCode(HttpStatus.OK)
  relink(): Promise<RecipeRelinkSummary> {
    return this.recipes.relinkAll();
  }

  @Get(':recipeId')
  get(@Param('recipeId', ParseUUIDPipe) id: string): Promise<AdminRecipe> {
    return this.recipes.getRecommendation(id);
  }

  /** 400 when a text has no `title` in its metadata. */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@Body() dto: AdminRecipeDto): Promise<AdminRecipe> {
    return this.recipes.createRecommendation(dto);
  }

  /** Replaces it whole: a translation left out is deleted. */
  @Put(':recipeId')
  replace(
    @Param('recipeId', ParseUUIDPipe) id: string,
    @Body() dto: AdminRecipeDto,
  ): Promise<AdminRecipe> {
    return this.recipes.replaceRecommendation(id, dto);
  }

  /** Households that saved it lose it from their favourites. */
  @Delete(':recipeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(@Param('recipeId', ParseUUIDPipe) id: string): Promise<void> {
    return this.recipes.deleteRecommendation(id);
  }
}
