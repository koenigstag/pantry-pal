import {
  BadRequestException,
  ConflictException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  findPostgresError,
  PG_ERROR,
  RecipesRepository,
  Transactional,
  type HouseholdRecipeRow,
  type HouseholdRecipeSummaryRow,
  type RecipeRow,
  type RecipeTranslationSummaryRow,
} from '@pantry-pal/db';
import {
  localeLookupOrder,
  MAX_RECIPE_TITLE_LENGTH,
  MAX_RECIPES_PER_HOUSEHOLD,
  RECIPE_IMPORT_ERROR,
  type AdminRecipe,
  type Recipe,
  type RecipeDocument,
  type RecipeSummary,
} from '@pantry-pal/shared';
import type { AdminRecipeDto, ImportRecipeDto } from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { ChangeFeed } from '../realtime/change-feed';
import { CooklangTitleMissingError, parseCooklang } from './cooklang';
import { checkRecipeUrl, fetchRecipePage, RecipeImportError } from './page-fetcher';
import { findPageRecipe, languageTag } from './page-recipe';
import { pageRecipeToCooklang } from './page-to-cooklang';

/** A text in one language: what a reader is served. */
interface Text {
  locale: string;
  title: string;
  document: RecipeDocument;
}

/**
 * Recipes: the household's own, imported from web pages, and the
 * recommendations every household sees, written through the admin API.
 *
 * Each is Cooklang text, stored as written with the JSON parsed from it; a
 * translation is another text of the same recipe. Readers get the text for
 * their exact tag, else for its language, else the original.
 *
 * A household's changes are announced as `recipes.changed`, without the
 * recipes: members may read different languages, and a broadcast reaches the
 * whole household's room in one.
 */
@Injectable()
export class RecipesService {
  constructor(
    private readonly recipes: RecipesRepository,
    private readonly changes: ChangeFeed,
  ) {}

  /** The household's own recipes and every recommendation, newest first. */
  async list(membership: Membership, locale: string): Promise<RecipeSummary[]> {
    const rows = await this.recipes.listForHousehold(membership.householdId);
    const texts = await this.translatedTexts(
      rows.map((row) => row.id),
      locale,
    );
    return rows.map((row) => toSummary(row, texts.get(row.id) ?? originalText(row)));
  }

  async get(membership: Membership, id: string, locale: string): Promise<Recipe> {
    const row = await this.recipes.findForHousehold(membership.householdId, id);
    if (row === undefined) throw new NotFoundException('Recipe not found');

    const order = localeLookupOrder(locale);
    const translations = await this.recipes.findTranslations(id, order);
    const translation = order
      .map((tag) => translations.find((entry) => entry.locale === tag))
      .find((entry) => entry !== undefined);

    return translation === undefined
      ? toRecipe(row, originalText(row), row.source)
      : toRecipe(row, translation, translation.source);
  }

  /**
   * Fetches a page, finds the recipe its site marked up, and keeps it as the
   * household's own, in Cooklang. A page imported before answers with that copy.
   *
   * No transaction: the fetch takes seconds, and the write is one row. A
   * concurrent import of the same page loses at the unique index and answers
   * with the winner's copy.
   */
  async import(
    membership: Membership,
    userId: string,
    locale: string,
    dto: ImportRecipeDto,
  ): Promise<Recipe> {
    const url = checkRecipeUrl(dto.url).href;

    const existing = await this.recipes.findBySourceUrl(membership.householdId, url);
    if (existing !== undefined) return this.get(membership, existing.id, locale);

    if (
      (await this.recipes.countForHousehold(membership.householdId)) >= MAX_RECIPES_PER_HOUSEHOLD
    ) {
      throw new RecipeImportError(
        RECIPE_IMPORT_ERROR.TooMany,
        `A household keeps at most ${MAX_RECIPES_PER_HOUSEHOLD} recipes`,
      );
    }

    const page = await fetchRecipePage(url);
    const found = findPageRecipe(page.html);
    if (found === null) {
      throw new RecipeImportError(
        RECIPE_IMPORT_ERROR.NoRecipe,
        'No recipe is marked up on that page',
      );
    }

    const recipeLocale = found.language ?? languageTag(locale.split('-')[0] ?? locale) ?? 'en';
    const recipe = { ...found, title: found.title.slice(0, MAX_RECIPE_TITLE_LENGTH) };
    const source = pageRecipeToCooklang(recipe, url, recipeLocale);
    const document = parseCooklang(source);

    let created: RecipeRow;
    try {
      created = await this.recipes.create({
        householdId: membership.householdId,
        locale: recipeLocale,
        title: document.title.slice(0, MAX_RECIPE_TITLE_LENGTH),
        source,
        document,
        sourceUrl: url,
        imageUrl: recipe.imageUrl,
        createdBy: userId,
      });
    } catch (error) {
      if (findPostgresError(error)?.code !== PG_ERROR.UniqueViolation) throw error;
      const winner = await this.recipes.findBySourceUrl(membership.householdId, url);
      if (winner === undefined) throw error;
      return this.get(membership, winner.id, locale);
    }

    this.changes.publish({ type: 'recipes.changed', householdId: membership.householdId });
    return this.get(membership, created.id, locale);
  }

  /** The household's own recipe. A recommendation is let go of with `unfavourite` instead. */
  async remove(membership: Membership, id: string): Promise<void> {
    const row = await this.recipes.findForHousehold(membership.householdId, id);
    if (row === undefined) throw new NotFoundException('Recipe not found');
    if (row.householdId === null) {
      throw new ConflictException('A recommendation is not deleted: take it out of favourites');
    }
    await this.recipes.deleteOwn(membership.householdId, id);
    this.changes.publish({ type: 'recipes.changed', householdId: membership.householdId });
  }

  /** Saves a recommendation to the household's favourites, or takes it out. */
  async setFavourite(membership: Membership, id: string, favourite: boolean): Promise<void> {
    const row = await this.recipes.findForHousehold(membership.householdId, id);
    if (row === undefined) throw new NotFoundException('Recipe not found');
    if (row.householdId !== null) {
      throw new ConflictException("The household's own recipes are always among its favourites");
    }

    const changed = favourite
      ? await this.recipes.addFavourite(membership.householdId, id)
      : await this.recipes.removeFavourite(membership.householdId, id);
    if (changed)
      this.changes.publish({ type: 'recipes.changed', householdId: membership.householdId });
  }

  // ── Recommendations, through the admin API ─────────────────────────────────

  async listRecommendations(): Promise<AdminRecipe[]> {
    const [rows, translations] = await Promise.all([
      this.recipes.listRecommendations(),
      this.recipes.listRecommendationTranslations(),
    ]);
    return rows.map((row) =>
      toAdminRecipe(
        row,
        translations.filter((translation) => translation.recipeId === row.id),
      ),
    );
  }

  async getRecommendation(id: string): Promise<AdminRecipe> {
    const row = await this.recipes.findRecommendation(id);
    if (row === undefined) throw new NotFoundException('Recommendation not found');
    return toAdminRecipe(row, await this.recipes.findTranslations(id));
  }

  @Transactional()
  async createRecommendation(dto: AdminRecipeDto): Promise<AdminRecipe> {
    const { original, translations } = parseAdminRecipe(dto);
    const row = await this.recipes.create({
      householdId: null,
      locale: dto.locale,
      title: original.title.slice(0, MAX_RECIPE_TITLE_LENGTH),
      source: dto.source,
      document: original,
      sourceUrl: dto.sourceUrl ?? null,
      imageUrl: dto.imageUrl ?? null,
      createdBy: null,
    });
    await this.recipes.replaceTranslations(row.id, translations);
    return this.getRecommendation(row.id);
  }

  /** Replaces the recommendation whole: its text, links and every translation. */
  @Transactional()
  async replaceRecommendation(id: string, dto: AdminRecipeDto): Promise<AdminRecipe> {
    const { original, translations } = parseAdminRecipe(dto);
    const row = await this.recipes.updateRecommendation(id, {
      locale: dto.locale,
      title: original.title.slice(0, MAX_RECIPE_TITLE_LENGTH),
      source: dto.source,
      document: original,
      sourceUrl: dto.sourceUrl ?? null,
      imageUrl: dto.imageUrl ?? null,
    });
    if (row === undefined) throw new NotFoundException('Recommendation not found');
    await this.recipes.replaceTranslations(id, translations);
    return this.getRecommendation(id);
  }

  async deleteRecommendation(id: string): Promise<void> {
    if (!(await this.recipes.deleteRecommendation(id))) {
      throw new NotFoundException('Recommendation not found');
    }
  }

  /** Each recipe's text for `locale` where a translation has one: the exact tag, else its language. */
  private async translatedTexts(
    recipeIds: readonly string[],
    locale: string,
  ): Promise<Map<string, Text>> {
    const order = localeLookupOrder(locale);
    const rows = await this.recipes.listTranslations(recipeIds, order);
    const rank = (row: RecipeTranslationSummaryRow): number => order.indexOf(row.locale);

    const best = new Map<string, Text>();
    for (const row of rows.toSorted((a, b) => rank(b) - rank(a))) {
      best.set(row.recipeId, { locale: row.locale, title: row.title, document: row.document });
    }
    return best;
  }
}

/** The title missing from a text is the admin's mistake: a 400 naming which text. */
function parseAdminRecipe(dto: AdminRecipeDto): {
  original: RecipeDocument;
  translations: Array<{ locale: string; title: string; source: string; document: RecipeDocument }>;
} {
  const entries = Object.entries(dto.translations ?? {});
  if (entries.some(([locale]) => locale === dto.locale)) {
    throw new BadRequestException(
      `translations must not repeat the original's locale, ${dto.locale}`,
    );
  }

  return {
    original: parseAdminText(dto.locale, dto.source),
    translations: entries.map(([locale, source]) => {
      const document = parseAdminText(locale, source);
      return { locale, title: document.title.slice(0, MAX_RECIPE_TITLE_LENGTH), source, document };
    }),
  };
}

function parseAdminText(locale: string, source: string): RecipeDocument {
  try {
    return parseCooklang(source);
  } catch (error) {
    if (error instanceof CooklangTitleMissingError) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: `The ${locale} text has no title: add \`title:\` to its metadata`,
      });
    }
    throw error;
  }
}

function originalText(row: HouseholdRecipeSummaryRow): Text {
  return { locale: row.locale, title: row.title, document: row.document };
}

function toSummary(row: HouseholdRecipeSummaryRow, text: Text): RecipeSummary {
  return {
    id: row.id,
    householdId: row.householdId,
    title: text.title,
    locale: text.locale,
    originalLocale: row.locale,
    imageUrl: row.imageUrl,
    sourceUrl: row.sourceUrl,
    servings: text.document.servings,
    time: text.document.time,
    ingredientCount: text.document.ingredients.filter((ingredient) => ingredient.listed).length,
    favourite: row.favourite,
    createdAt: row.createdAt.toISOString(),
  };
}

function toRecipe(row: HouseholdRecipeRow, text: Text, source: string): Recipe {
  return { ...toSummary(row, text), document: text.document, source };
}

function toAdminRecipe(
  row: RecipeRow,
  translations: ReadonlyArray<{ locale: string; source: string }>,
): AdminRecipe {
  return {
    id: row.id,
    locale: row.locale,
    source: row.source,
    sourceUrl: row.sourceUrl,
    imageUrl: row.imageUrl,
    title: row.title,
    translations: Object.fromEntries(translations.map((entry) => [entry.locale, entry.source])),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}
