import type { Recipe, RecipeDocument, RecipeStepItem } from '@pantry-pal/shared';
import { ArrowLeft, Clock, ExternalLink, Star, Trash, Users } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { Fragment, useEffect, useState, type ReactElement } from 'react';
import { Link, useNavigate, useParams } from 'react-router';

import { LOCALE } from '../../i18n/locale';
import { messages } from '../../i18n/messages';
import { useNotices, useRecipes } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Dialog } from '../../ui/Dialog';
import { IconButton } from '../../ui/IconButton';
import { ROUTES } from '../shell/navigation';
import { PageStatus } from '../shell/PageStatus';
import { CancelButton } from '../storage/ItemSheets';
import { isIngredientListStep, languageName, quantityText, sameLanguage } from './recipeDisplay';
import { RecipeImage } from './RecipesPage';

type Loaded =
  | { state: 'loading' }
  | { state: 'error'; message: string }
  | { state: 'ready'; recipe: Recipe };

const HEADER_BUTTON =
  'hover:bg-on-accent/15 md:text-ink-muted md:hover:bg-sunken md:hover:text-ink';

/** One recipe, `/recipes/:recipeId`, in the user's language where the server has a translation. */
export const RecipePage = observer(function RecipePage(): ReactElement {
  const { recipeId = '' } = useParams();
  const recipes = useRecipes();
  const notices = useNotices();
  const navigate = useNavigate();
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' });
  const [confirmingRemove, setConfirmingRemove] = useState(false);

  useEffect(() => {
    let current = true;
    setLoaded({ state: 'loading' });
    void (async () => {
      const result = await recipes.get(recipeId);
      if (!current) return;
      setLoaded(
        result.ok
          ? { state: 'ready', recipe: result.value }
          : { state: 'error', message: result.error },
      );
    })();
    return () => {
      current = false;
    };
  }, [recipes, recipeId]);

  const recipe = loaded.state === 'ready' ? loaded.recipe : null;

  async function toggleFavourite(): Promise<void> {
    if (recipe === null) return;
    const favourite = !recipe.favourite;
    setLoaded({ state: 'ready', recipe: { ...recipe, favourite } });
    const failure = await recipes.setFavourite(recipe.id, favourite);
    if (failure !== null) {
      setLoaded({ state: 'ready', recipe: { ...recipe, favourite: !favourite } });
      notices.error(failure);
    }
  }

  async function remove(): Promise<void> {
    if (recipe === null) return;
    setConfirmingRemove(false);
    const failure = await recipes.remove(recipe.id);
    if (failure === null) void navigate(ROUTES.recipes, { replace: true });
    else notices.error(failure);
  }

  return (
    <div className="flex min-h-[calc(100dvh-var(--spacing-tab-bar))] flex-col md:min-h-dvh">
      <header className="bg-accent text-on-accent md:bg-transparent md:text-ink">
        <div className="mx-auto flex w-full max-w-3xl items-center gap-1 px-2 pt-[max(0.5rem,env(safe-area-inset-top))] pb-1 md:px-6 md:pt-6">
          <Link
            to={ROUTES.recipes}
            aria-label={messages.recipes.back}
            title={messages.recipes.back}
            className={cn(
              'focus-ring flex size-10 items-center justify-center rounded-full transition-colors',
              HEADER_BUTTON,
            )}
          >
            <ArrowLeft aria-hidden="true" className="size-5 rtl:rotate-180" />
          </Link>
          <div className="ms-auto flex items-center gap-1">
            {recipe?.sourceUrl != null && (
              <a
                href={recipe.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={messages.recipes.source}
                title={messages.recipes.source}
                className={cn(
                  'focus-ring flex size-10 items-center justify-center rounded-full transition-colors',
                  HEADER_BUTTON,
                )}
              >
                <ExternalLink aria-hidden="true" className="size-5" />
              </a>
            )}
            {recipe !== null && recipe.householdId === null && (
              <IconButton
                icon={Star}
                label={recipe.favourite ? messages.recipes.unsave : messages.recipes.save}
                aria-pressed={recipe.favourite}
                onClick={() => void toggleFavourite()}
                className={cn(HEADER_BUTTON, recipe.favourite && '[&_svg]:fill-current')}
              />
            )}
            {recipe !== null && recipe.householdId !== null && (
              <IconButton
                icon={Trash}
                label={messages.recipes.remove}
                onClick={() => setConfirmingRemove(true)}
                className={HEADER_BUTTON}
              />
            )}
          </div>
        </div>
      </header>

      {loaded.state === 'loading' && <PageStatus title={messages.common.loading} />}
      {loaded.state === 'error' && <PageStatus tone="error" title={loaded.message} />}
      {recipe !== null && <RecipeView recipe={recipe} />}

      <Dialog
        variant="sheet"
        open={confirmingRemove}
        onClose={() => setConfirmingRemove(false)}
        title={recipe === null ? '' : messages.recipes.removeTitle(recipe.title)}
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={() => void remove()}
            className="focus-ring flex h-11 cursor-pointer items-center justify-center gap-2 rounded-xl bg-danger px-4 font-semibold text-surface transition-opacity hover:opacity-90"
          >
            <Trash aria-hidden="true" className="size-5" />
            {messages.recipes.removeConfirm}
          </button>
          <CancelButton onClick={() => setConfirmingRemove(false)} />
        </div>
      </Dialog>
    </div>
  );
});

function RecipeView({ recipe }: { recipe: Recipe }): ReactElement {
  const { document } = recipe;
  const ingredients = document.ingredients
    .map((ingredient, index) => ({ key: `ingredient-${index}`, ingredient }))
    .filter(({ ingredient }) => ingredient.listed);
  const cookware = document.cookware.filter((item) => item.listed);

  return (
    <article lang={recipe.locale} className="mx-auto w-full max-w-3xl px-4 pt-4 pb-8 md:px-8">
      {recipe.imageUrl !== null && (
        <RecipeImage url={recipe.imageUrl} className="mb-4 aspect-video w-full rounded-xl" />
      )}
      <h1 className="text-2xl font-semibold tracking-tight break-words md:text-3xl">
        {recipe.title}
      </h1>

      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-ink-muted">
        {document.time !== null && (
          <span className="flex items-center gap-1.5">
            <Clock aria-hidden="true" className="size-4" />
            {document.time}
          </span>
        )}
        {document.servings !== null && (
          <span className="flex items-center gap-1.5">
            <Users aria-hidden="true" className="size-4" />
            {messages.recipes.servings(document.servings)}
          </span>
        )}
        {!sameLanguage(recipe.locale, LOCALE) && (
          <span lang={LOCALE}>{messages.recipes.writtenIn(languageName(recipe.locale))}</span>
        )}
      </p>

      {document.description !== null && (
        <p className="mt-4 whitespace-pre-line">{document.description}</p>
      )}

      {ingredients.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold" lang={LOCALE}>
            {messages.recipes.ingredients}
          </h2>
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {ingredients.map(({ key, ingredient }) => (
              <li key={key} className="flex items-baseline justify-between gap-4 px-4 py-2.5">
                <span className="min-w-0 break-words">
                  {ingredient.name}
                  {ingredient.note !== null && (
                    <span className="text-ink-muted"> ({ingredient.note})</span>
                  )}
                </span>
                <span className="shrink-0 text-end text-ink-muted tabular-nums">
                  {quantityText(ingredient.quantity)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {cookware.length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-lg font-semibold" lang={LOCALE}>
            {messages.recipes.cookware}
          </h2>
          <p>{cookware.map((item) => item.name).join(', ')}</p>
        </section>
      )}

      <Method document={document} />
    </article>
  );
}

interface MethodSection {
  key: string;
  name: string | null;
  rows: Array<
    | { key: string; type: 'note'; text: string }
    | {
        key: string;
        type: 'step';
        number: number;
        items: Array<{ key: string; item: RecipeStepItem }>;
      }
  >;
}

/**
 * The steps to show, keyed by position — a recipe's text never reorders under
 * a reader — and numbered across the whole recipe, where Cooklang restarts the
 * count in each section. The ingredient-list step of an imported recipe is
 * left out: the list above shows it.
 */
function methodSections(document: RecipeDocument): MethodSection[] {
  let number = 0;
  return document.sections
    .map((section, sectionIndex) => ({
      key: `section-${sectionIndex}`,
      name: section.name,
      rows: section.content
        .map((content, index) => ({ content, key: `${sectionIndex}-${index}` }))
        .filter(({ content }) => !isIngredientListStep(content))
        .map(({ content, key }): MethodSection['rows'][number] => {
          if (content.type === 'note') return { key, type: 'note', text: content.text };
          number += 1;
          return {
            key,
            type: 'step',
            number,
            items: content.items.map((item, itemIndex) => ({ key: `${key}-${itemIndex}`, item })),
          };
        }),
    }))
    .filter((section) => section.rows.length > 0);
}

function Method({ document }: { document: RecipeDocument }): ReactElement | null {
  const sections = methodSections(document);
  if (sections.length === 0) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-lg font-semibold" lang={LOCALE}>
        {messages.recipes.method}
      </h2>
      {sections.map((section) => (
        <Fragment key={section.key}>
          {section.name !== null && <h3 className="mt-4 mb-2 font-semibold">{section.name}</h3>}
          <ol className="flex flex-col gap-3">
            {section.rows.map((row) =>
              row.type === 'note' ? (
                <li
                  key={row.key}
                  className="list-none rounded-lg bg-sunken px-4 py-2 text-sm text-ink-muted"
                >
                  {row.text}
                </li>
              ) : (
                <li key={row.key} className="flex gap-3">
                  <span
                    aria-hidden="true"
                    className="flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-soft text-sm font-semibold text-accent tabular-nums"
                  >
                    {row.number}
                  </span>
                  <p className="min-w-0 pt-0.5 break-words">
                    {row.items.map(({ key, item }) => (
                      <StepItem key={key} item={item} document={document} />
                    ))}
                  </p>
                </li>
              ),
            )}
          </ol>
        </Fragment>
      ))}
    </section>
  );
}

function StepItem({
  item,
  document,
}: {
  item: RecipeStepItem;
  document: RecipeDocument;
}): ReactElement {
  switch (item.type) {
    case 'text':
      return <>{item.value}</>;
    case 'ingredient': {
      const ingredient = document.ingredients[item.index];
      if (ingredient === undefined) return <></>;
      const amount = quantityText(ingredient.quantity);
      return (
        <>
          <strong className="font-semibold">{ingredient.name}</strong>
          {amount !== '' && <span className="text-ink-muted"> ({amount})</span>}
        </>
      );
    }
    case 'cookware':
      return <>{document.cookware[item.index]?.name ?? ''}</>;
    case 'timer': {
      const timer = document.timers[item.index];
      if (timer === undefined) return <></>;
      const amount = quantityText(timer.quantity);
      return (
        <strong className="font-semibold">{amount !== '' ? amount : (timer.name ?? '')}</strong>
      );
    }
  }
}
