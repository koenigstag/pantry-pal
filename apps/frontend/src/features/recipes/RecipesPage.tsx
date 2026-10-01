import type { RecipeSummary } from '@pantry-pal/shared';
import { Check, Clock, CookingPot, Link2, Star, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { messages } from '../../i18n/messages';
import { usePantryStore, useRecipes } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { PageStatus } from '../shell/PageStatus';
import { ImportRecipeDialog } from './ImportRecipeDialog';
import { COOKABLE_TAB, RECIPES_TAB_PARAM, recipeLink, RECOMMENDATIONS_TAB } from './recipeRoutes';

/**
 * The Recipes page: the household's favourites — its own recipes, imported from
 * recipe sites, and the recommendations it saved — the recommendations, and
 * what can be cooked from what the household has. The tab is a query
 * parameter, so each is a link and Back walks through them.
 */
export const RecipesPage = observer(function RecipesPage(): ReactElement {
  const pantry = usePantryStore();
  const recipes = useRecipes();
  const [params] = useSearchParams();
  const [importing, setImporting] = useState(false);
  const tab = params.get(RECIPES_TAB_PARAM);
  const showRecommendations = tab === RECOMMENDATIONS_TAB;
  const showCookable = tab === COOKABLE_TAB;
  const householdId = pantry.householdId;

  useEffect(() => {
    if (householdId !== null) void recipes.load();
  }, [recipes, householdId]);

  const shown = showCookable
    ? recipes.cookable
    : showRecommendations
      ? recipes.recommendations
      : recipes.favourites;

  return (
    <div className="flex min-h-[calc(100dvh-var(--spacing-tab-bar))] flex-col md:min-h-dvh">
      <header className="bg-accent text-on-accent md:bg-transparent md:text-ink">
        <div className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 md:px-8 md:pt-8">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {messages.recipes.title}
          </h1>
          <button
            type="button"
            onClick={() => setImporting(true)}
            className="focus-ring ms-auto flex h-9 cursor-pointer items-center gap-1.5 rounded-full border border-on-accent/40 px-3 text-sm font-medium transition-colors hover:bg-on-accent/10 md:border-line md:hover:bg-sunken"
          >
            <Link2 aria-hidden="true" className="size-4" />
            {messages.recipes.add}
          </button>
        </div>

        <nav aria-label={messages.recipes.tabs} className="px-4 pb-3 md:px-8">
          <ul className="scrollbar-none flex gap-2 overflow-x-auto p-1">
            <RecipeTab
              to="."
              active={!showRecommendations && !showCookable}
              label={messages.recipes.favourites}
            />
            <RecipeTab
              to={`?${RECIPES_TAB_PARAM}=${COOKABLE_TAB}`}
              active={showCookable}
              label={messages.recipes.cookable}
            />
            <RecipeTab
              to={`?${RECIPES_TAB_PARAM}=${RECOMMENDATIONS_TAB}`}
              active={showRecommendations}
              label={messages.recipes.recommendations}
            />
          </ul>
        </nav>
      </header>

      <div className="flex-1 px-4 pt-4 pb-6 md:px-8">
        {recipes.loadState === 'error' ? (
          <PageStatus
            tone="error"
            title={messages.recipes.loadFailed}
            action={{ label: messages.recipes.retry, onClick: () => void recipes.load() }}
          />
        ) : recipes.loadState !== 'ready' ? (
          <PageStatus title={messages.common.loading} />
        ) : shown.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-center text-ink-muted">
            <CookingPot aria-hidden="true" className="size-10" strokeWidth={1.5} />
            <p className="font-medium text-ink">
              {showCookable
                ? messages.recipes.noCookable
                : showRecommendations
                  ? messages.recipes.noRecommendations
                  : messages.recipes.noFavourites}
            </p>
            {!showRecommendations && (
              <p className="max-w-sm text-sm">
                {showCookable ? messages.recipes.noCookableHint : messages.recipes.noFavouritesHint}
              </p>
            )}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {shown.map((recipe) => (
              <RecipeCard key={recipe.id} recipe={recipe} />
            ))}
          </ul>
        )}
      </div>

      <ImportRecipeDialog open={importing} onClose={() => setImporting(false)} />
    </div>
  );
});

function RecipeTab({
  to,
  active,
  label,
}: {
  to: string;
  active: boolean;
  label: string;
}): ReactElement {
  return (
    <li>
      <Link
        to={to}
        aria-current={active ? 'page' : undefined}
        className={cn(
          'focus-ring flex h-9 items-center rounded-full px-4 text-sm whitespace-nowrap transition-colors',
          active
            ? 'font-semibold ring-2 ring-on-accent ring-inset md:bg-accent md:text-on-accent md:ring-0'
            : 'text-on-accent/85 hover:bg-on-accent/10 md:text-ink-muted md:hover:bg-sunken md:hover:text-ink',
        )}
      >
        {label}
      </Link>
    </li>
  );
}

const RecipeCard = observer(function RecipeCard({
  recipe,
}: {
  recipe: RecipeSummary;
}): ReactElement {
  return (
    <li>
      <Link
        to={recipeLink(recipe.id)}
        className="focus-ring flex h-full gap-3 overflow-hidden rounded-xl border border-line bg-surface p-3 transition-colors hover:bg-sunken"
      >
        <RecipeImage url={recipe.imageUrl} className="size-20 shrink-0 rounded-lg" />
        <div className="flex min-w-0 flex-col gap-1">
          <p className="line-clamp-2 font-medium break-words" lang={recipe.locale}>
            {recipe.title}
          </p>
          <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-ink-muted">
            {recipe.time !== null && (
              <span className="flex items-center gap-1">
                <Clock aria-hidden="true" className="size-3.5" />
                {recipe.time}
              </span>
            )}
            {recipe.servings !== null && (
              <span className="flex items-center gap-1">
                <Users aria-hidden="true" className="size-3.5" />
                {messages.recipes.servings(recipe.servings)}
              </span>
            )}
            {recipe.ingredientCount > 0 && (
              <span>{messages.recipes.ingredientCount(recipe.ingredientCount)}</span>
            )}
          </p>
          {recipe.inStockCount > 0 && (
            <p className="flex items-center gap-1 text-xs font-medium text-success">
              <Check aria-hidden="true" className="size-3.5" />
              {messages.recipes.inStock(recipe.inStockCount, recipe.ingredientCount)}
            </p>
          )}
          {recipe.householdId === null && recipe.favourite && (
            <p className="flex items-center gap-1 text-xs text-accent">
              <Star aria-hidden="true" className="size-3.5 fill-current" />
              {messages.recipes.favourites}
            </p>
          )}
        </div>
      </Link>
    </li>
  );
});

/** The recipe's photo, or a pot where it has none or it fails to load. Decorative: the title names the recipe. */
export function RecipeImage({
  url,
  className,
}: {
  url: string | null;
  className?: string;
}): ReactElement {
  const [failed, setFailed] = useState(false);
  if (url === null || failed) {
    return (
      <div className={cn('flex items-center justify-center bg-sunken text-ink-muted', className)}>
        <CookingPot aria-hidden="true" className="size-8" strokeWidth={1.5} />
      </div>
    );
  }
  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setFailed(true)}
      className={cn('bg-sunken object-cover', className)}
    />
  );
}
