import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  UseGuards,
  type HttpException,
} from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { RECIPE_IMPORT_ERROR, type Recipe, type RecipeSummary } from '@pantry-pal/shared';
import { ImportRecipeDto } from '@pantry-pal/shared/dto';

import { RECIPE_IMPORTS } from '../auth/rate-limits';
import {
  CurrentMembership,
  CurrentUser,
  type AuthenticatedUser,
  type Membership,
} from '../common/request-context';
import { HouseholdAccessGuard } from '../households/household-access.guard';
import { RecipeImportError } from './page-fetcher';
import { RecipesService } from './recipes.service';

/**
 * A household's recipes: its own, imported from web pages, and the
 * recommendations every household sees. Each comes in the caller's language
 * where a translation has one.
 */
@UseGuards(HouseholdAccessGuard)
@Controller('households/:householdId/recipes')
export class RecipesController {
  constructor(private readonly recipes: RecipesService) {}

  /** The household's own and every recommendation, newest first; `favourite` tells them apart for the page. */
  @Get()
  list(
    @CurrentMembership() membership: Membership,
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<RecipeSummary[]> {
    return this.recipes.list(membership, user.locale);
  }

  /**
   * Fetches the page and keeps the recipe its site marked up (schema.org
   * `Recipe`), as Cooklang. A page imported before answers with that copy, so
   * the answer is 200 either way. A refusal names its reason in `code`.
   * Declared before `:recipeId`, so `import` is never read as an id.
   */
  @Post('import')
  @HttpCode(HttpStatus.OK)
  @UseGuards(ThrottlerGuard)
  @Throttle(RECIPE_IMPORTS)
  async import(
    @CurrentMembership() membership: Membership,
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ImportRecipeDto,
  ): Promise<Recipe> {
    try {
      return await this.recipes.import(membership, user.id, user.locale, dto);
    } catch (error) {
      if (error instanceof RecipeImportError) throw toHttpException(error);
      throw error;
    }
  }

  @Get(':recipeId')
  get(
    @CurrentMembership() membership: Membership,
    @CurrentUser() user: AuthenticatedUser,
    @Param('recipeId', ParseUUIDPipe) id: string,
  ): Promise<Recipe> {
    return this.recipes.get(membership, id, user.locale);
  }

  /** The household's own recipe; 409 for a recommendation, which is taken out of favourites instead. */
  @Delete(':recipeId')
  @HttpCode(HttpStatus.NO_CONTENT)
  remove(
    @CurrentMembership() membership: Membership,
    @Param('recipeId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.recipes.remove(membership, id);
  }

  /** Saves a recommendation to the household's favourites. Saving it twice changes nothing. */
  @Put(':recipeId/favourite')
  @HttpCode(HttpStatus.NO_CONTENT)
  favourite(
    @CurrentMembership() membership: Membership,
    @Param('recipeId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.recipes.setFavourite(membership, id, true);
  }

  @Delete(':recipeId/favourite')
  @HttpCode(HttpStatus.NO_CONTENT)
  unfavourite(
    @CurrentMembership() membership: Membership,
    @Param('recipeId', ParseUUIDPipe) id: string,
  ): Promise<void> {
    return this.recipes.setFavourite(membership, id, false);
  }
}

/** A 400 naming what was wrong with the page, or a 409 for a household at its limit. */
function toHttpException(error: RecipeImportError): HttpException {
  const body = { message: error.message, code: error.code };
  return error.code === RECIPE_IMPORT_ERROR.TooMany
    ? new ConflictException({ statusCode: HttpStatus.CONFLICT, error: 'Conflict', ...body })
    : new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        ...body,
      });
}
