import {
  MAX_INGREDIENT_QUERY_LENGTH,
  type Ingredient,
  type IngredientMatch,
} from '@pantry-pal/shared';
import { Carrot, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useState, type KeyboardEvent, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { useIngredients } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { FIELD_CONTROL, type FieldControlProps } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';

/** How long typing pauses before a search is sent. */
const SEARCH_DELAY_MS = 250;
/** How many matches the list shows: the search answers with more, best first. */
const SHOWN_MATCHES = 8;
/** How many ingredients are suggested from the item's name. */
const SUGGESTIONS = 3;

interface IngredientPickerProps {
  controlProps: FieldControlProps;
  /** An ingredient id, or blank for none. */
  value: string;
  /** The item's name, which suggests ingredients while none is chosen. */
  itemName: string;
  /** The ingredient chosen, or `null` when it was removed. */
  onChange: (ingredient: Ingredient | null) => void;
}

type Search =
  | { state: 'idle' }
  | { state: 'searching'; query: string }
  | { state: 'done'; query: string; matches: IngredientMatch[] }
  | { state: 'failed'; query: string };

/**
 * What an item is, picked from the ingredients the server knows: a combobox
 * whose matches list below it, in any language the app speaks. While none is
 * chosen, the item's name suggests a few, one tap each.
 *
 * Searching needs the server; the chosen ingredient's name is kept on the
 * device (`IngredientCatalog`), so it shows offline.
 */
export const IngredientPicker = observer(function IngredientPicker({
  controlProps,
  value,
  itemName,
  onChange,
}: IngredientPickerProps): ReactElement {
  const catalog = useIngredients();
  const listId = useId();
  const [query, setQuery] = useState('');
  const [search, setSearch] = useState<Search>({ state: 'idle' });
  const [suggestions, setSuggestions] = useState<IngredientMatch[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    if (value !== '') catalog.load([value]);
  }, [catalog, value]);

  const trimmed = query.trim();
  useEffect(() => {
    if (trimmed === '') {
      setSearch({ state: 'idle' });
      return;
    }
    let current = true;
    setSearch({ state: 'searching', query: trimmed });
    const timer = setTimeout(async () => {
      try {
        const matches = await catalog.search(trimmed);
        if (current) {
          setSearch({ state: 'done', query: trimmed, matches: matches.slice(0, SHOWN_MATCHES) });
        }
      } catch {
        if (current) setSearch({ state: 'failed', query: trimmed });
      }
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [catalog, trimmed]);
  useEffect(() => setActive(0), [search]);

  // Suggestions follow the name while nothing is chosen; a failed search simply suggests nothing.
  const name = itemName.trim();
  useEffect(() => {
    if (value !== '' || name === '') {
      setSuggestions([]);
      return;
    }
    let current = true;
    const timer = setTimeout(async () => {
      try {
        const matches = await catalog.search(name.slice(0, MAX_INGREDIENT_QUERY_LENGTH));
        if (current) setSuggestions(matches.slice(0, SUGGESTIONS));
      } catch {
        if (current) setSuggestions([]);
      }
    }, SEARCH_DELAY_MS);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [catalog, value, name]);

  const matches = search.state === 'done' ? search.matches : [];
  const isOpen = matches.length > 0;

  function choose(match: IngredientMatch): void {
    catalog.remember(match);
    onChange(match);
    setQuery('');
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'ArrowDown' && isOpen) {
      event.preventDefault();
      setActive((index) => (index + 1) % matches.length);
    } else if (event.key === 'ArrowUp' && isOpen) {
      event.preventDefault();
      setActive((index) => (index - 1 + matches.length) % matches.length);
    } else if (event.key === 'Enter' && trimmed !== '') {
      // Never submits the form: Enter here picks, or waits for the matches.
      event.preventDefault();
      const match = matches[active];
      if (match !== undefined) choose(match);
    } else if (event.key === 'Escape' && query !== '') {
      // Clears the search rather than closing the dialog around it.
      event.preventDefault();
      event.stopPropagation();
      setQuery('');
    }
  }

  return (
    <div className="flex flex-col gap-2">
      {value !== '' && (
        <div className="flex items-center gap-1">
          <span className="inline-flex min-w-0 items-center gap-1.5 rounded-full bg-accent-soft py-1 ps-3 pe-3 text-sm">
            <Carrot aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
            <span className="truncate">{catalog.nameOf(value)}</span>
          </span>
          <IconButton
            icon={X}
            label={messages.itemForm.clearIngredient}
            onClick={() => onChange(null)}
            className="text-ink-muted hover:bg-sunken hover:text-ink"
          />
        </div>
      )}

      <input
        {...controlProps}
        type="search"
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={isOpen}
        aria-controls={listId}
        aria-activedescendant={isOpen ? `${listId}-${active}` : undefined}
        autoComplete="off"
        maxLength={MAX_INGREDIENT_QUERY_LENGTH}
        placeholder={
          value === ''
            ? messages.itemForm.ingredientPlaceholder
            : messages.itemForm.ingredientChangePlaceholder
        }
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        onKeyDown={onKeyDown}
        className={FIELD_CONTROL}
      />

      {/*
        The combobox pattern: options a native <select> or <datalist> cannot
        show — two names each — so the roles are ARIA's. Focus stays in the
        input, which moves the active option.
      */}
      <div
        id={listId}
        // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
        role="listbox"
        aria-label={messages.itemForm.ingredient}
        className={cn(
          'flex flex-col overflow-hidden rounded-lg border border-line',
          !isOpen && 'hidden',
        )}
      >
        {matches.map((match, index) => (
          // Keyboard users choose from the input (arrows, Enter), as a combobox works.
          // oxlint-disable-next-line jsx-a11y/click-events-have-key-events
          <div
            key={match.id}
            id={`${listId}-${index}`}
            // oxlint-disable-next-line jsx-a11y/prefer-tag-over-role
            role="option"
            // Focusable for the role's sake, never tabbed to: focus stays in the input.
            tabIndex={-1}
            aria-selected={index === active}
            onClick={() => choose(match)}
            onPointerMove={() => setActive(index)}
            className={cn(
              'flex cursor-pointer flex-wrap items-baseline gap-x-2 px-3 py-2 text-sm',
              index === active && 'bg-sunken',
            )}
          >
            <span className="min-w-0 break-words">{match.name}</span>
            {match.matchedName !== null && (
              <span className="min-w-0 break-words text-xs text-ink-muted">
                {match.matchedName}
              </span>
            )}
          </div>
        ))}
      </div>

      <SearchStatus search={search} />

      {value === '' && trimmed === '' && suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-ink-muted">{messages.itemForm.ingredientSuggested}</span>
          {suggestions.map((suggestion) => (
            <button
              key={suggestion.id}
              type="button"
              onClick={() => choose(suggestion)}
              className="focus-ring inline-flex h-8 cursor-pointer items-center rounded-full border border-line px-3 text-sm transition-colors hover:bg-sunken"
            >
              {suggestion.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
});

/** Searching, nothing found, or no server: said politely, below the input. */
function SearchStatus({ search }: { search: Search }): ReactElement {
  const text =
    search.state === 'searching'
      ? messages.itemForm.ingredientSearching
      : search.state === 'failed'
        ? messages.itemForm.ingredientOffline
        : search.state === 'done' && search.matches.length === 0
          ? messages.itemForm.ingredientNoMatches(search.query)
          : '';

  return (
    <p aria-live="polite" className={cn('text-xs text-ink-muted', text === '' && 'sr-only')}>
      {text}
    </p>
  );
}
