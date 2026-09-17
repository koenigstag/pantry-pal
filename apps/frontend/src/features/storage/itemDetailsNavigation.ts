import type { PantryItem } from '@pantry-pal/shared';

import type { ListPick } from '../shopping/AddToListSheet';

/**
 * Router state on a card's link. It means the list is one history entry back,
 * so closing the details pops that entry and the back button does not reopen
 * them. A details URL opened directly (a bookmark, a reload of a new tab)
 * arrives without it.
 */
export const OPENED_FROM_LIST = { openedFromList: true } as const;

export function wasOpenedFromList(state: unknown): boolean {
  return (
    typeof state === 'object' &&
    state !== null &&
    'openedFromList' in state &&
    state.openedFromList === true
  );
}

/** What `StoragePage` hands the item-details route through `<Outlet context>`. */
export interface StorageOutletContext {
  openRemoveSheet: (item: PantryItem) => void;
  openListPicker: (pick: ListPick) => void;
}
