import { ITEM_STATUS, type RecipeDocument } from '@pantry-pal/shared';
import { and, asc, count, desc, eq, getTableColumns, inArray, isNull, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  ingredientParents,
  items,
  recipeFavourites,
  recipes,
  recipeTranslations,
  type NewRecipeRow,
  type NewRecipeTranslationRow,
  type RecipeRow,
  type RecipeTranslationRow,
  subItems,
} from '../schema';

/** A recipe as a household sees it: whether it is among its favourites, too. */
export type HouseholdRecipeRow = RecipeRow & { favourite: boolean };

/** What a list shows: everything but the Cooklang text. */
export type HouseholdRecipeSummaryRow = Omit<HouseholdRecipeRow, 'source'>;

export type RecipeTranslationSummaryRow = Pick<
  RecipeTranslationRow,
  'recipeId' | 'locale' | 'title' | 'document'
>;

export type CreateRecipeInput = Pick<
  NewRecipeRow,
  | 'householdId'
  | 'locale'
  | 'title'
  | 'source'
  | 'document'
  | 'sourceUrl'
  | 'imageUrl'
  | 'createdBy'
>;

export type UpdateRecipeInput = Partial<
  Pick<NewRecipeRow, 'locale' | 'title' | 'source' | 'document' | 'sourceUrl' | 'imageUrl'>
>;

/**
 * Recipes: a household's own and the recommendations every household sees,
 * their translations, and the recommendations each household saved.
 *
 * Reads for a household see its own recipes and the recommendations, never
 * another household's: every such query filters on `visibleTo`.
 */
export class RecipesRepository {
  constructor(private readonly db: Database) {}

  /** Newest first, recommendations and the household's own together. */
  listForHousehold(householdId: string): Promise<HouseholdRecipeSummaryRow[]> {
    return this.db
      .select({
        id: recipes.id,
        householdId: recipes.householdId,
        locale: recipes.locale,
        title: recipes.title,
        document: recipes.document,
        sourceUrl: recipes.sourceUrl,
        imageUrl: recipes.imageUrl,
        createdBy: recipes.createdBy,
        createdAt: recipes.createdAt,
        updatedAt: recipes.updatedAt,
        favourite: this.favourite(householdId),
      })
      .from(recipes)
      .where(this.visibleTo(householdId))
      .orderBy(desc(recipes.createdAt), asc(recipes.id));
  }

  async findForHousehold(householdId: string, id: string): Promise<HouseholdRecipeRow | undefined> {
    const [row] = await this.db
      .select({ ...getTableColumns(recipes), favourite: this.favourite(householdId) })
      .from(recipes)
      .where(and(eq(recipes.id, id), this.visibleTo(householdId)))
      .limit(1);
    return row;
  }

  /** The household's own copy of a page, if it imported it before. */
  async findBySourceUrl(householdId: string, sourceUrl: string): Promise<RecipeRow | undefined> {
    const [row] = await this.db
      .select()
      .from(recipes)
      .where(and(eq(recipes.householdId, householdId), eq(recipes.sourceUrl, sourceUrl)))
      .limit(1);
    return row;
  }

  async countForHousehold(householdId: string): Promise<number> {
    const [row] = await this.db
      .select({ total: count() })
      .from(recipes)
      .where(eq(recipes.householdId, householdId));
    return row?.total ?? 0;
  }

  /** The translations of `recipeIds` in any of `locales`: a reader's tag and its language. */
  listTranslations(
    recipeIds: readonly string[],
    locales: readonly string[],
  ): Promise<RecipeTranslationSummaryRow[]> {
    if (recipeIds.length === 0 || locales.length === 0) return Promise.resolve([]);
    return this.db
      .select({
        recipeId: recipeTranslations.recipeId,
        locale: recipeTranslations.locale,
        title: recipeTranslations.title,
        document: recipeTranslations.document,
      })
      .from(recipeTranslations)
      .where(
        and(
          inArray(recipeTranslations.recipeId, [...recipeIds]),
          inArray(recipeTranslations.locale, [...locales]),
        ),
      );
  }

  /** One recipe's translations, whole, in any of `locales`, or in all of them when omitted. */
  findTranslations(recipeId: string, locales?: readonly string[]): Promise<RecipeTranslationRow[]> {
    return this.db
      .select()
      .from(recipeTranslations)
      .where(
        and(
          eq(recipeTranslations.recipeId, recipeId),
          locales === undefined ? undefined : inArray(recipeTranslations.locale, [...locales]),
        ),
      )
      .orderBy(asc(recipeTranslations.locale));
  }

  async create(input: CreateRecipeInput): Promise<RecipeRow> {
    const [row] = await this.db.insert(recipes).values(input).returning();
    if (row === undefined) throw new Error('INSERT ... RETURNING returned no row');
    return row;
  }

  /** The household's own recipe, gone with its translations. Answers whether there was one. */
  async deleteOwn(householdId: string, id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(recipes)
      .where(and(eq(recipes.id, id), eq(recipes.householdId, householdId)))
      .returning({ id: recipes.id });
    return deleted.length > 0;
  }

  /** Saves a recommendation; saving it twice changes nothing. Answers whether it was new. */
  async addFavourite(householdId: string, recipeId: string): Promise<boolean> {
    const added = await this.db
      .insert(recipeFavourites)
      .values({ householdId, recipeId })
      .onConflictDoNothing()
      .returning({ recipeId: recipeFavourites.recipeId });
    return added.length > 0;
  }

  /** Answers whether it was saved. */
  async removeFavourite(householdId: string, recipeId: string): Promise<boolean> {
    const removed = await this.db
      .delete(recipeFavourites)
      .where(
        and(eq(recipeFavourites.householdId, householdId), eq(recipeFavourites.recipeId, recipeId)),
      )
      .returning({ recipeId: recipeFavourites.recipeId });
    return removed.length > 0;
  }

  /**
   * The ingredients the household has, as a recipe asks for them: those of its
   * active items with a unit on the shelf, and every ingredient above them in
   * the taxonomy, since cheddar is cheese and whole milk is milk.
   */
  async stockedIngredientIds(householdId: string): Promise<Set<string>> {
    const result = await this.db.execute<{ id: string }>(sql`
      with recursive stocked(id) as (
        select distinct i.ingredient_id
        from ${items} i
        where i.household_id = ${householdId}
          and i.ingredient_id is not null
          and i.deleted_at is null
          and i.status = ${ITEM_STATUS.Active}
          and exists (
            select 1 from ${subItems} s
            where s.item_id = i.id and s.deleted_at is null and s.status = ${ITEM_STATUS.Active}
          )
        union
        select p.parent_id from ${ingredientParents} p join stocked on p.ingredient_id = stocked.id
      )
      select id from stocked`);
    return new Set(result.rows.map((row) => row.id));
  }

  /** Every recipe's original text, for relinking: household recipes and recommendations alike. */
  listAllSources(): Promise<Array<Pick<RecipeRow, 'id' | 'locale' | 'source'>>> {
    return this.db
      .select({ id: recipes.id, locale: recipes.locale, source: recipes.source })
      .from(recipes)
      .orderBy(asc(recipes.id));
  }

  listAllTranslationSources(): Promise<
    Array<Pick<RecipeTranslationRow, 'recipeId' | 'locale' | 'source'>>
  > {
    return this.db
      .select({
        recipeId: recipeTranslations.recipeId,
        locale: recipeTranslations.locale,
        source: recipeTranslations.source,
      })
      .from(recipeTranslations)
      .orderBy(asc(recipeTranslations.recipeId), asc(recipeTranslations.locale));
  }

  /** A text parsed again: its document and the title that came with it. Leaves `updated_at` alone. */
  async setDocument(id: string, title: string, document: RecipeDocument): Promise<void> {
    await this.db
      .update(recipes)
      .set({ title, document, updatedAt: sql`${recipes.updatedAt}` })
      .where(eq(recipes.id, id));
  }

  async setTranslationDocument(
    recipeId: string,
    locale: string,
    title: string,
    document: RecipeDocument,
  ): Promise<void> {
    await this.db
      .update(recipeTranslations)
      .set({ title, document })
      .where(and(eq(recipeTranslations.recipeId, recipeId), eq(recipeTranslations.locale, locale)));
  }

  // ── Recommendations, through the admin API ─────────────────────────────────

  listRecommendations(): Promise<RecipeRow[]> {
    return this.db
      .select()
      .from(recipes)
      .where(isNull(recipes.householdId))
      .orderBy(desc(recipes.createdAt), asc(recipes.id));
  }

  /** Every translation of every recommendation. */
  listRecommendationTranslations(): Promise<RecipeTranslationRow[]> {
    return this.db
      .select({
        recipeId: recipeTranslations.recipeId,
        locale: recipeTranslations.locale,
        title: recipeTranslations.title,
        source: recipeTranslations.source,
        document: recipeTranslations.document,
      })
      .from(recipeTranslations)
      .innerJoin(recipes, eq(recipes.id, recipeTranslations.recipeId))
      .where(isNull(recipes.householdId))
      .orderBy(asc(recipeTranslations.recipeId), asc(recipeTranslations.locale));
  }

  async findRecommendation(id: string): Promise<RecipeRow | undefined> {
    const [row] = await this.db
      .select()
      .from(recipes)
      .where(and(eq(recipes.id, id), isNull(recipes.householdId)))
      .limit(1);
    return row;
  }

  /** An empty patch is a no-op, as Drizzle refuses an empty SET. */
  async updateRecommendation(id: string, patch: UpdateRecipeInput): Promise<RecipeRow | undefined> {
    if (Object.keys(patch).length === 0) return this.findRecommendation(id);
    const [row] = await this.db
      .update(recipes)
      .set(patch)
      .where(and(eq(recipes.id, id), isNull(recipes.householdId)))
      .returning();
    return row;
  }

  /** Swaps a recipe's translations for `rows`. Call it inside a transaction. */
  async replaceTranslations(
    recipeId: string,
    rows: readonly Omit<NewRecipeTranslationRow, 'recipeId'>[],
  ): Promise<void> {
    await this.db.delete(recipeTranslations).where(eq(recipeTranslations.recipeId, recipeId));
    if (rows.length > 0) {
      await this.db.insert(recipeTranslations).values(rows.map((row) => ({ ...row, recipeId })));
    }
  }

  /** Answers whether there was one. Households that saved it lose it with it. */
  async deleteRecommendation(id: string): Promise<boolean> {
    const deleted = await this.db
      .delete(recipes)
      .where(and(eq(recipes.id, id), isNull(recipes.householdId)))
      .returning({ id: recipes.id });
    return deleted.length > 0;
  }

  /** The household's own recipes and every recommendation. */
  private visibleTo(householdId: string) {
    return or(eq(recipes.householdId, householdId), isNull(recipes.householdId));
  }

  /** Own recipes are favourites by being the household's; recommendations once saved. */
  private favourite(householdId: string) {
    return sql<boolean>`(${recipes.householdId} is not null or exists (
      select 1 from ${recipeFavourites}
      where ${recipeFavourites.householdId} = ${householdId}
        and ${recipeFavourites.recipeId} = ${recipes.id}
    ))`.mapWith(Boolean);
  }
}
