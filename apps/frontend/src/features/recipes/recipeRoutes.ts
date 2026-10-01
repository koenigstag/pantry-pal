import { ROUTES } from '../shell/navigation';

/** The tab is a query parameter: Favourites, the default, stays out of the URL. */
export const RECIPES_TAB_PARAM = 'tab';
export const RECOMMENDATIONS_TAB = 'recommendations';
/** Recipes the household has something for, the fewest missing first. */
export const COOKABLE_TAB = 'cookable';

export const recipeLink = (recipeId: string): string =>
  `${ROUTES.recipes}/${encodeURIComponent(recipeId)}`;
