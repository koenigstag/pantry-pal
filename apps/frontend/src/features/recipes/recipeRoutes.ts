import { ROUTES } from '../shell/navigation';

/** The Recommendations tab is a query parameter: Favourites, the default, stays out of the URL. */
export const RECIPES_TAB_PARAM = 'tab';
export const RECOMMENDATIONS_TAB = 'recommendations';

export const recipeLink = (recipeId: string): string =>
  `${ROUTES.recipes}/${encodeURIComponent(recipeId)}`;
