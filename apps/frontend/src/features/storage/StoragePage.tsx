import type { PantryItem } from '@pantry-pal/shared';
import { CheckCheck, PackagePlus, RefreshCw, SquarePen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useCallback, useMemo, useState, type ReactElement } from 'react';
import { Navigate, Outlet } from 'react-router';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import type { MenuItem } from '../../ui/Menu';
import { PageStatus } from '../shell/PageStatus';
import { AddToListSheet, type ListPick } from '../shopping/AddToListSheet';
import { AddItemDialog } from './AddItemDialog';
import type { StorageOutletContext } from './itemDetailsNavigation';
import { ItemGrid } from './ItemGrid';
import { filterItems, sortItems } from './itemOrder';
import { DeleteItemsSheet, MoveItemsSheet, RemoveItemSheet } from './ItemSheets';
import { LocationEditorDialog } from './LocationEditorDialog';
import { locationName } from './locationName';
import { LocationPager } from './LocationPager';
import { LocationTabs } from './LocationTabs';
import { StorageHeader } from './StorageHeader';
import { SelectionBar, SortControl } from './StorageToolbar';
import { useStorageParams } from './useStorageParams';

type OpenSheet =
  | { kind: 'none' }
  | { kind: 'remove'; item: PantryItem }
  | { kind: 'delete'; itemIds: readonly string[] }
  | { kind: 'move'; itemIds: readonly string[] }
  | { kind: 'pick-list'; pick: ListPick }
  | { kind: 'add' }
  | { kind: 'locations' };

/** A selection belongs to the location it was made in; switching tabs leaves it behind. */
interface Selection {
  locationId: string;
  ids: ReadonlySet<string>;
}

const NO_SHEET: OpenSheet = { kind: 'none' };
const NOTHING_SELECTED: ReadonlySet<string> = new Set();

/**
 * `/storage/:locationId` — one location's items. The item-details route renders
 * into its `<Outlet>`, over the list, and reaches the page's sheets through the
 * outlet context.
 */
export const StoragePage = observer(function StoragePage(): ReactElement {
  const pantry = usePantryStore();
  const params = useStorageParams();

  const [query, setQuery] = useState('');
  const [isSearchOpen, setSearchOpen] = useState(false);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [sheet, setSheet] = useState<OpenSheet>(NO_SHEET);

  // Stable callbacks: every card is memoised on its props.
  const locationId = params.locationId;
  const toggleSelected = useCallback(
    (itemId: string) => {
      if (locationId === undefined) return;

      setSelection((current) => {
        const ids = new Set(current?.locationId === locationId ? current.ids : []);
        if (ids.has(itemId)) ids.delete(itemId);
        else ids.add(itemId);
        return { locationId, ids };
      });
    },
    [locationId],
  );
  const openRemoveSheet = useCallback((item: PantryItem) => setSheet({ kind: 'remove', item }), []);
  const openListPicker = useCallback((pick: ListPick) => setSheet({ kind: 'pick-list', pick }), []);
  const closeSheet = useCallback(() => setSheet(NO_SHEET), []);
  const clearSelection = useCallback(() => setSelection(null), []);
  const outletContext = useMemo<StorageOutletContext>(
    () => ({ openRemoveSheet, openListPicker }),
    [openRemoveSheet, openListPicker],
  );

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

  const location = pantry.locations.find((candidate) => candidate.id === locationId);
  if (location === undefined) {
    // No location in the URL, or one deleted meanwhile: show the first.
    const first = pantry.locations[0];
    return first === undefined ? (
      <PageStatus title={messages.storage.noLocations} />
    ) : (
      <Navigate replace to={params.locationLink(first.id)} />
    );
  }

  const isSearching = query.trim() !== '';
  /** What a space shows now: its items, searched and sorted as the page asks. */
  const visibleItemsIn = (id: string): readonly PantryItem[] =>
    sortItems(
      filterItems(pantry.itemsIn(id), query),
      params.sort,
      params.direction,
      pantry.unitLabel,
    );
  const visibleItems = visibleItemsIn(location.id);

  // Only what is on screen counts as selected: never act on items a search hides.
  const selectedIds =
    selection?.locationId === location.id
      ? new Set(visibleItems.filter((item) => selection.ids.has(item.id)).map((item) => item.id))
      : NOTHING_SELECTED;

  const matchCounts = isSearching
    ? new Map(
        pantry.locations.map((candidate) => [
          candidate.id,
          filterItems(pantry.itemsIn(candidate.id), query).length,
        ]),
      )
    : null;

  const menuItems: MenuItem[] = [
    {
      key: 'add',
      label: messages.storage.addItem,
      icon: PackagePlus,
      onSelect: () => setSheet({ kind: 'add' }),
    },
    {
      key: 'select-all',
      label: messages.storage.selectAll,
      icon: CheckCheck,
      onSelect: () =>
        setSelection({
          locationId: location.id,
          ids: new Set(visibleItems.map((item) => item.id)),
        }),
    },
    {
      key: 'edit-locations',
      label: messages.storage.editLocations,
      icon: SquarePen,
      onSelect: () => setSheet({ kind: 'locations' }),
    },
    {
      key: 'refresh',
      label: messages.storage.refresh,
      icon: RefreshCw,
      onSelect: () => void pantry.refresh(),
    },
  ];

  return (
    // At least a screen tall (above the phone's tab bar), like the Shopping page, so the
    // pager below fills what the header leaves and a swipe between spaces takes the whole
    // page area rather than only the rows of cards.
    <div className="flex min-h-[calc(100dvh-4rem-env(safe-area-inset-bottom))] flex-col md:min-h-dvh">
      <StorageHeader
        query={query}
        onQueryChange={setQuery}
        isSearchOpen={isSearchOpen}
        onSearchOpenChange={setSearchOpen}
        menuItems={menuItems}
      >
        <LocationTabs
          locations={pantry.locations}
          activeLocationId={location.id}
          link={params.locationLink}
          matchCounts={matchCounts}
          onEditLocations={() => setSheet({ kind: 'locations' })}
        />
      </StorageHeader>

      <section className="mx-auto flex w-full max-w-7xl flex-1 flex-col pt-3">
        <h2 className="sr-only">{locationName(location)}</h2>

        <div className="mb-3 flex min-h-11 items-center gap-2 px-4 md:px-8">
          {selectedIds.size > 0 ? (
            <SelectionBar
              count={selectedIds.size}
              canMove={pantry.locations.length > 1}
              onClear={clearSelection}
              onDelete={() => setSheet({ kind: 'delete', itemIds: [...selectedIds] })}
              onAddToShoppingList={() => openListPicker({ kind: 'add', itemIds: [...selectedIds] })}
              onMove={() => setSheet({ kind: 'move', itemIds: [...selectedIds] })}
            />
          ) : (
            <>
              <p aria-live="polite" className="text-sm text-ink-muted">
                {isSearching
                  ? messages.storage.matchCount(visibleItems.length)
                  : messages.storage.itemCount(visibleItems.length)}
              </p>
              <SortControl
                sort={params.sort}
                direction={params.direction}
                onSortChange={params.setSort}
                onToggleDirection={params.toggleDirection}
              />
            </>
          )}
        </div>

        {/*
          Swiping sideways over the items moves to the next space, whose own
          items follow the finger. Each pane carries the page's padding, so they
          slide in from the edge of the screen rather than from a margin, and the
          pager itself fills the page — every part of it takes a swipe, not only
          the rows of cards.
        */}
        <LocationPager locations={pantry.locations} active={location} link={params.locationLink}>
          {(space) => {
            const isOpen = space.id === location.id;
            const spaceItems = isOpen ? visibleItems : visibleItemsIn(space.id);

            return (
              <div className="px-4 pb-6 md:px-8">
                {isSearching && spaceItems.length === 0 ? (
                  <p className="py-16 text-center text-ink-muted">
                    {messages.storage.noMatches(query.trim(), locationName(space))}
                  </p>
                ) : (
                  <ItemGrid
                    items={spaceItems}
                    selectedIds={isOpen ? selectedIds : NOTHING_SELECTED}
                    detailsLink={
                      isOpen ? params.itemLink : (itemId) => params.itemLinkIn(space.id, itemId)
                    }
                    onToggleSelected={toggleSelected}
                    onRemove={openRemoveSheet}
                    // An empty space shows only the plus card. Search results don't: a new item
                    // would not be among them.
                    onAdd={isSearching ? undefined : () => setSheet({ kind: 'add' })}
                  />
                )}
              </div>
            );
          }}
        </LocationPager>
      </section>

      <Outlet context={outletContext} />

      <RemoveItemSheet
        item={sheet.kind === 'remove' ? sheet.item : null}
        onClose={closeSheet}
        onPickList={openListPicker}
      />
      <AddToListSheet
        pick={sheet.kind === 'pick-list' ? sheet.pick : null}
        onClose={closeSheet}
        // A selection's items are on a list now; an item's details have nothing to clear.
        onDone={
          sheet.kind === 'pick-list' && sheet.pick.kind === 'add' ? clearSelection : undefined
        }
      />
      <DeleteItemsSheet
        itemIds={sheet.kind === 'delete' ? sheet.itemIds : null}
        onClose={closeSheet}
        onDone={clearSelection}
      />
      <MoveItemsSheet
        itemIds={sheet.kind === 'move' ? sheet.itemIds : null}
        fromLocationId={location.id}
        onClose={closeSheet}
        onDone={clearSelection}
      />
      <AddItemDialog
        open={sheet.kind === 'add'}
        onClose={closeSheet}
        defaultLocationId={location.id}
      />
      <LocationEditorDialog open={sheet.kind === 'locations'} onClose={closeSheet} />
    </div>
  );
});
