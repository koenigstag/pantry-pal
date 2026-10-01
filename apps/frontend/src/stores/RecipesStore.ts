import {
  MAX_RECIPES_PER_HOUSEHOLD,
  PANTRY_EVENT,
  RECIPE_IMPORT_ERROR,
  type Recipe,
  type RecipeSummary,
  type RecipesChangedPayload,
} from '@pantry-pal/shared';
import { makeAutoObservable, observableRef, runInAction } from 'mobx';

import { messages } from '../i18n/messages';
import { ApiError, type PantryApi } from '../services/api';
import type { PantrySocket } from '../services/socket';
import type { PantryStore } from './PantryStore';

type LoadState = 'idle' | 'loading' | 'ready' | 'error';

export type RecipeResult<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * The household's recipes: its own, imported from recipe sites, and the
 * recommendations every household sees, in this user's language where the
 * server has a translation.
 *
 * Online only, like the editors: recipes are not in the offline mirror. The
 * service worker's read cache still shows the last list fetched. Another
 * member's change arrives as `RecipesChanged`, which names no recipe — each
 * member reads their own language — so a list on screen is fetched again.
 */
export class RecipesStore {
  private readonly api: PantryApi;
  private readonly socket: PantrySocket;
  private readonly pantry: PantryStore;

  recipes: readonly RecipeSummary[] = [];
  loadState: LoadState = 'idle';
  /** Which household `recipes` belongs to: a household switch must not show the last one's. */
  private loadedFor: string | null = null;

  constructor(api: PantryApi, socket: PantrySocket, pantry: PantryStore) {
    this.api = api;
    this.socket = socket;
    this.pantry = pantry;

    makeAutoObservable<RecipesStore, 'api' | 'socket' | 'pantry' | 'loadedFor'>(
      this,
      { api: false, socket: false, pantry: false, loadedFor: false, recipes: observableRef },
      { autoBind: true },
    );

    this.socket.on(PANTRY_EVENT.RecipesChanged, this.handleChanged);
  }

  dispose(): void {
    this.socket.off(PANTRY_EVENT.RecipesChanged, this.handleChanged);
  }

  /** The household's own recipes and the recommendations it saved, newest first. */
  get favourites(): readonly RecipeSummary[] {
    return this.recipes.filter((recipe) => recipe.favourite);
  }

  get recommendations(): readonly RecipeSummary[] {
    return this.recipes.filter((recipe) => recipe.householdId === null);
  }

  /** Fetches the list, keeping the one on screen while it does. */
  async load(): Promise<void> {
    const householdId = this.pantry.householdId;
    if (householdId === null) return;

    if (this.loadedFor !== householdId) {
      this.recipes = [];
      this.loadState = 'loading';
    }
    try {
      const recipes = await this.api.listRecipes(householdId);
      runInAction(() => {
        if (this.pantry.householdId !== householdId) return;
        this.recipes = recipes;
        this.loadedFor = householdId;
        this.loadState = 'ready';
      });
    } catch {
      runInAction(() => {
        // A list already shown stays: a failed refresh is not worth losing it over.
        if (this.loadedFor !== householdId) this.loadState = 'error';
      });
    }
  }

  async get(recipeId: string): Promise<RecipeResult<Recipe>> {
    const householdId = this.pantry.householdId;
    if (householdId === null) return { ok: false, error: messages.recipes.loadFailed };
    try {
      return { ok: true, value: await this.api.getRecipe(householdId, recipeId) };
    } catch (error) {
      const notFound = error instanceof ApiError && (error.status === 404 || error.status === 400);
      return {
        ok: false,
        error: notFound ? messages.recipes.notFound : messages.recipes.loadFailed,
      };
    }
  }

  /** Keeps the recipe a page marks up, then shows the list with it. */
  async importFromUrl(url: string): Promise<RecipeResult<Recipe>> {
    const householdId = this.pantry.householdId;
    if (householdId === null) return { ok: false, error: messages.recipes.loadFailed };
    try {
      const recipe = await this.api.importRecipe(householdId, { url });
      void this.load();
      return { ok: true, value: recipe };
    } catch (error) {
      return { ok: false, error: importError(error) };
    }
  }

  /** The household's own recipe. */
  async remove(recipeId: string): Promise<string | null> {
    const householdId = this.pantry.householdId;
    if (householdId === null) return messages.recipes.changeFailed;
    try {
      await this.api.removeRecipe(householdId, recipeId);
      runInAction(() => {
        this.recipes = this.recipes.filter((recipe) => recipe.id !== recipeId);
      });
      return null;
    } catch {
      return messages.recipes.changeFailed;
    }
  }

  /** Saves a recommendation to the favourites, or takes it out. Shown at once, put back on failure. */
  async setFavourite(recipeId: string, favourite: boolean): Promise<string | null> {
    const householdId = this.pantry.householdId;
    if (householdId === null) return messages.recipes.changeFailed;

    const mark = (value: boolean): void => {
      this.recipes = this.recipes.map((recipe) =>
        recipe.id === recipeId ? { ...recipe, favourite: value } : recipe,
      );
    };
    mark(favourite);
    try {
      await this.api.setRecipeFavourite(householdId, recipeId, favourite);
      return null;
    } catch {
      runInAction(() => mark(!favourite));
      return messages.recipes.changeFailed;
    }
  }

  private handleChanged(payload: RecipesChangedPayload): void {
    if (payload.householdId === this.loadedFor) void this.load();
  }
}

/** The catalog's words for a refusal's `code`. */
function importError(error: unknown): string {
  const t = messages.recipes.import.errors;
  if (!(error instanceof ApiError)) return messages.errors.unreachable;
  switch (error.code) {
    case RECIPE_IMPORT_ERROR.BlockedUrl:
      return t.blockedUrl;
    case RECIPE_IMPORT_ERROR.Unreachable:
      return t.unreachable;
    case RECIPE_IMPORT_ERROR.NotAPage:
      return t.notAPage;
    case RECIPE_IMPORT_ERROR.NoRecipe:
      return t.noRecipe;
    case RECIPE_IMPORT_ERROR.TooMany:
      return t.tooMany(MAX_RECIPES_PER_HOUSEHOLD);
    default:
      // The DTO's own 400 for a malformed URL carries no code.
      return error.status === 400 ? t.invalidUrl : messages.errors.unreachable;
  }
}
