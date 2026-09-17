import type { ShoppingList } from '@pantry-pal/shared';
import { Plus } from 'lucide-react';
import { useEffect, useRef, type ReactElement } from 'react';
import { NavLink } from 'react-router';

import { formatNumber } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { cn } from '../../ui/cn';
import { ROUTES } from '../shell/navigation';

/** Where a list's tab leads. */
export const shoppingListLink = (listId: string): string =>
  `${ROUTES.shopping}/${encodeURIComponent(listId)}`;

interface ShoppingListTabsProps {
  lists: readonly ShoppingList[];
  activeListId: string | undefined;
  /** How many entries of each list are still to buy. */
  toBuyCounts: ReadonlyMap<string, number>;
  /** Opens the shopping lists editor, where lists are added too. */
  onEdit: () => void;
}

/**
 * The household's lists in use as links, like the storage spaces' tabs: each
 * list is its own URL, so the back button walks through the lists visited.
 */
export function ShoppingListTabs({
  lists,
  activeListId,
  toBuyCounts,
  onEdit,
}: ShoppingListTabsProps): ReactElement {
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (activeListId === undefined) return;
    listRef.current
      ?.querySelector(`[data-list-id="${CSS.escape(activeListId)}"]`)
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeListId]);

  return (
    <nav aria-label={messages.shopping.lists} className="px-4 pb-3 md:px-8">
      <div className="scrollbar-none flex items-center gap-2 overflow-x-auto p-1">
        <ul ref={listRef} className="flex shrink-0 gap-2">
          {lists.map((list) => {
            const count = toBuyCounts.get(list.id) ?? 0;

            return (
              <li key={list.id} data-list-id={list.id} className="shrink-0">
                <NavLink
                  to={shoppingListLink(list.id)}
                  className={({ isActive }) =>
                    cn(
                      'focus-ring flex h-9 items-center gap-2 rounded-full px-4 text-sm whitespace-nowrap transition-colors',
                      isActive
                        ? 'font-semibold ring-2 ring-on-accent ring-inset md:bg-accent md:text-on-accent md:ring-0'
                        : 'text-on-accent/85 hover:bg-on-accent/10 md:text-ink-muted md:hover:bg-sunken md:hover:text-ink',
                    )
                  }
                >
                  {list.name}
                  {count > 0 && (
                    <>
                      <span
                        aria-hidden="true"
                        className="rounded-full bg-current/15 px-1.5 text-xs tabular-nums"
                      >
                        {formatNumber(count)}
                      </span>
                      <span className="sr-only">{messages.shopping.toBuy(count)}</span>
                    </>
                  )}
                </NavLink>
              </li>
            );
          })}
        </ul>

        {/* As tall as a tab, so the row keeps its height. */}
        <button
          type="button"
          aria-label={messages.shopping.editLists}
          title={messages.shopping.editLists}
          onClick={onEdit}
          className="focus-ring flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-full border border-on-accent/40 transition-colors hover:bg-on-accent/10 md:border-line md:text-ink-muted md:hover:bg-sunken md:hover:text-ink"
        >
          <Plus aria-hidden="true" className="size-5" />
        </button>
      </div>
    </nav>
  );
}
