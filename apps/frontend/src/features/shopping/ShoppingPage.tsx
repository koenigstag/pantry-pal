import {
  MAX_SHOPPING_LISTS_PER_HOUSEHOLD,
  type ShoppingList,
  type ShoppingListEntry,
} from '@pantry-pal/shared';
import {
  EllipsisVertical,
  PackageCheck,
  RefreshCw,
  Share2,
  ShoppingCart,
  SquarePen,
  WifiOff,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactElement } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router';

import { messages } from '../../i18n/messages';
import { useNotices, usePantryStore } from '../../stores/StoreContext';
import { IconButton } from '../../ui/IconButton';
import { Menu, type MenuItem } from '../../ui/Menu';
import { SwipePager } from '../../ui/SwipePager';
import { PageStatus } from '../shell/PageStatus';
import { shareText, shoppingListText } from './shareList';
import { ShoppingEntryRow } from './ShoppingEntryRow';
import { ShoppingListEditorDialog } from './ShoppingListEditorDialog';
import { shoppingListLink, ShoppingListTabs } from './ShoppingListTabs';

/** On the accent band on a phone, like the Storage header; plain on wider screens. */
const HEADER_BUTTON =
  'hover:bg-on-accent/15 md:text-ink-muted md:hover:bg-sunken md:hover:text-ink';

/** Into the cart first, first in the list. Instants compare as strings. */
function byCheckedAt(a: ShoppingListEntry, b: ShoppingListEntry): number {
  const x = a.checkedAt ?? '';
  const y = b.checkedAt ?? '';
  if (x === y) return 0;
  return x < y ? -1 : 1;
}

/** How a list is shown: what is still to buy, in the order it was added, then the cart. */
function toBuyAndCart(entries: readonly ShoppingListEntry[]): {
  toBuy: readonly ShoppingListEntry[];
  inCart: readonly ShoppingListEntry[];
} {
  return {
    toBuy: entries.filter((entry) => entry.checkedAt === null),
    inCart: entries.filter((entry) => entry.checkedAt !== null).toSorted(byCheckedAt),
  };
}

/** Whether the editor is open, and with which new row, if any (see `ShoppingListEditorDialog`). */
type EditorState = { open: false } | { open: true; newListName: string | null };

const EDITOR_CLOSED: EditorState = { open: false };

/**
 * `/shopping/:listId` — one shopping list: what is still to buy in the order it
 * was added, then what is in the cart. Putting the cart away restocks storage.
 *
 * The tabs switch between the lists in use; archived ones appear only in the
 * editor, which the + beside the tabs and the ⋮ menu open. The header also
 * shares the list as text.
 */
export const ShoppingPage = observer(function ShoppingPage(): ReactElement {
  const pantry = usePantryStore();
  const notices = useNotices();
  const { listId } = useParams<{ listId: string }>();
  const navigate = useNavigate();

  const [editor, setEditor] = useState<EditorState>(EDITOR_CLOSED);
  const [isMarkingBought, setMarkingBought] = useState(false);

  if (pantry.household === null) {
    return pantry.loadState === 'failed' ? (
      <PageStatus
        tone="error"
        title={messages.errors.loadFailed}
        detail={pantry.error}
        action={{ label: messages.common.retry, onClick: () => void pantry.load() }}
      />
    ) : (
      <PageStatus title={messages.common.loading} />
    );
  }

  const lists = pantry.activeShoppingLists;
  const list = lists.find((candidate) => candidate.id === listId);
  const first = lists[0];
  if (list === undefined && first !== undefined) {
    // No list in the URL, or one deleted or archived meanwhile: show the first.
    return <Navigate replace to={shoppingListLink(first.id)} />;
  }

  const canCreate = pantry.shoppingLists.length < MAX_SHOPPING_LISTS_PER_HOUSEHOLD;
  const openEditor = (newListName: string | null): void => setEditor({ open: true, newListName });

  // An entry whose item has not arrived yet is not shown, nor counted.
  const shown = (candidate: ShoppingList): readonly ShoppingListEntry[] =>
    pantry.entriesOn(candidate.id).filter((entry) => pantry.itemsById.has(entry.itemId));
  const toBuyCounts = new Map(
    lists.map((candidate) => [
      candidate.id,
      shown(candidate).filter((entry) => entry.checkedAt === null).length,
    ]),
  );

  const entries = list === undefined ? [] : shown(list);
  const { toBuy, inCart } = toBuyAndCart(entries);
  const text =
    list === undefined ? null : shoppingListText(list, entries, pantry.itemsById, pantry.unitName);

  async function share(): Promise<void> {
    if (text === null) {
      notices.info(messages.shopping.nothingToShare);
      return;
    }
    const outcome = await shareText(text);
    if (outcome === 'copied') notices.info(messages.shopping.copied);
    if (outcome === 'failed') notices.error(messages.shopping.shareFailed);
  }

  async function markBought(): Promise<void> {
    if (list === undefined || inCart.length === 0 || isMarkingBought) return;

    const count = inCart.length;
    setMarkingBought(true);
    const failure = await pantry.putAwayShopping(
      list.id,
      inCart.map((entry) => entry.id),
    );
    setMarkingBought(false);
    if (failure === null) notices.info(messages.shopping.markedBought(count));
    else notices.error(failure);
  }

  const menuItems: MenuItem[] = [
    {
      key: 'edit-lists',
      label: messages.shopping.editLists,
      icon: SquarePen,
      onSelect: () => openEditor(null),
    },
    {
      key: 'refresh',
      label: messages.shopping.refresh,
      icon: RefreshCw,
      onSelect: () => void pantry.refresh(),
    },
  ];

  return (
    // At least a screen tall (above the phone's tab bar), so the mark-as-bought bar sits at the
    // bottom of a short list rather than right under it.
    <div className="flex min-h-[calc(100dvh-var(--spacing-tab-bar))] flex-col md:min-h-dvh">
      <header className="bg-accent text-on-accent md:bg-transparent md:text-ink">
        <div className="flex items-center gap-2 px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-2 md:px-8 md:pt-8">
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
            {messages.shopping.title}
          </h1>

          {pantry.connection === 'offline' && (
            <span className="flex items-center gap-1 rounded-full bg-current/15 px-2 py-0.5 text-xs font-medium">
              <WifiOff aria-hidden="true" className="size-3.5" />
              {messages.connection.offline}
            </span>
          )}

          <div className="ms-auto flex items-center gap-1">
            {list !== undefined && (
              <IconButton
                icon={Share2}
                label={messages.shopping.share}
                title={text === null ? messages.shopping.nothingToShare : messages.shopping.share}
                aria-disabled={text === null || undefined}
                onClick={() => void share()}
                className={HEADER_BUTTON}
              />
            )}
            <Menu
              label={messages.shopping.moreActions}
              items={menuItems}
              renderTrigger={(trigger) => (
                <IconButton
                  {...trigger}
                  icon={EllipsisVertical}
                  label={messages.shopping.moreActions}
                  className={HEADER_BUTTON}
                />
              )}
            />
          </div>
        </div>

        {lists.length > 0 && (
          <ShoppingListTabs
            lists={lists}
            activeListId={list?.id}
            toBuyCounts={toBuyCounts}
            // The + opens the editor on a new, blank row; at the limit, on the lists as they are.
            onEdit={() => openEditor(canCreate ? '' : null)}
          />
        )}
      </header>

      <section className="mx-auto flex w-full max-w-3xl flex-1 flex-col pt-3">
        {list === undefined ? (
          <div className="flex flex-col items-center gap-3 px-4 py-16 text-center text-ink-muted md:px-8">
            <ShoppingCart aria-hidden="true" className="size-10" strokeWidth={1.5} />
            <p>{messages.shopping.noLists}</p>
            <button
              type="button"
              // A household's first list starts from a suggested name.
              onClick={() =>
                openEditor(
                  pantry.shoppingLists.length === 0 ? messages.shopping.defaultListName : '',
                )
              }
              className="focus-ring mt-2 h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover"
            >
              {messages.shopping.createFirst}
            </button>
          </div>
        ) : (
          /*
            Swiping sideways over the entries moves to the next list, whose own
            entries follow the finger, like the storage spaces. Each pane carries
            the page's padding, so they slide in from the edge of the screen, and
            the pager fills the page: every part of it takes a swipe, not only
            the rows.
          */
          <SwipePager
            pages={lists}
            active={list}
            // Where that list's tab leads, so a swipe and a tap end up the same.
            onSwipe={(id) => void navigate(shoppingListLink(id))}
          >
            {(candidate) => {
              const rows =
                candidate.id === list.id ? { toBuy, inCart } : toBuyAndCart(shown(candidate));

              return (
                <div className="px-4 pb-6 md:px-8">
                  {rows.toBuy.length === 0 && rows.inCart.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 py-16 text-center text-ink-muted">
                      <p className="font-medium text-ink">
                        {messages.shopping.emptyList(candidate.name)}
                      </p>
                      <p className="max-w-sm text-sm">{messages.shopping.emptyHint}</p>
                    </div>
                  ) : (
                    <>
                      <h2 className="sr-only">{candidate.name}</h2>
                      <p
                        aria-live="polite"
                        className="mb-3 flex min-h-11 items-center text-sm text-ink-muted"
                      >
                        {messages.shopping.toBuy(rows.toBuy.length)}
                      </p>
                      {rows.toBuy.length > 0 && (
                        <ul className="flex flex-col gap-2">
                          {rows.toBuy.map((entry) => (
                            <ShoppingEntryRow key={entry.id} entry={entry} />
                          ))}
                        </ul>
                      )}
                      {rows.inCart.length > 0 && (
                        <>
                          <h3 className="mt-6 mb-2 text-xs font-semibold tracking-wide text-ink-muted uppercase">
                            {messages.shopping.inCart}
                          </h3>
                          <ul className="flex flex-col gap-2">
                            {rows.inCart.map((entry) => (
                              <ShoppingEntryRow key={entry.id} entry={entry} />
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  )}
                </div>
              );
            }}
          </SwipePager>
        )}
      </section>

      {list !== undefined && inCart.length > 0 && (
        // Above the phone's bottom tab bar, and at the foot of the page from `md` up.
        <div className="sticky bottom-tab-bar border-t border-line bg-surface/95 px-4 py-3 backdrop-blur md:bottom-0 md:px-8">
          <div className="mx-auto flex w-full max-w-3xl items-center gap-3">
            <p className="hidden flex-1 text-sm text-ink-muted sm:block">
              {messages.shopping.markBoughtHint}
            </p>
            <button
              type="button"
              aria-disabled={isMarkingBought || undefined}
              onClick={() => void markBought()}
              className="focus-ring inline-flex h-11 flex-1 cursor-pointer items-center justify-center gap-2 rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover aria-disabled:opacity-60 sm:flex-none"
            >
              <PackageCheck aria-hidden="true" className="size-5" />
              {isMarkingBought
                ? messages.shopping.markingBought
                : messages.shopping.markBought(inCart.length)}
            </button>
          </div>
        </div>
      )}

      <ShoppingListEditorDialog
        open={editor.open}
        newListName={editor.open ? editor.newListName : null}
        onClose={() => setEditor(EDITOR_CLOSED)}
      />
    </div>
  );
});
