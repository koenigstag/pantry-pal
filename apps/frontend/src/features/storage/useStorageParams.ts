import { useCallback } from 'react';
import { useParams, useSearchParams, type Path } from 'react-router';

import {
  DEFAULT_SORT_DIRECTION,
  DEFAULT_SORT_FIELD,
  parseSortDirection,
  parseSortField,
  type SortDirection,
  type SortField,
} from './itemOrder';

const SORT_PARAM = 'sort';
const DIRECTION_PARAM = 'dir';

export interface StorageParams {
  locationId: string | undefined;
  itemId: string | undefined;
  sort: SortField;
  direction: SortDirection;
  setSort: (field: SortField) => void;
  toggleDirection: () => void;
  /** Where a location's tab leads, keeping the current sort. */
  locationLink: (locationId: string) => Partial<Path>;
  /**
   * Where an item card leads: its details over the current location, keeping the
   * sort. Stable until the location or the sort changes, so memoised cards can
   * take it as a prop.
   */
  itemLink: (itemId: string) => Partial<Path>;
  /** The same, for a location that is not the open one — a space a swipe is showing. */
  itemLinkIn: (locationId: string, itemId: string) => Partial<Path>;
}

/**
 * The Storage page's URL state:
 * `/storage/:locationId/items/:itemId?sort=expiry&dir=desc`.
 *
 * The location is a path segment, so each tab is a real link that the back
 * button walks through; so are an item's details, which the back button closes.
 * The sort is a query parameter changed in place: flipping the order is not a
 * place to go back to. Defaults stay out of the URL, so a bare
 * `/storage/:locationId` means "by name, ascending".
 */
export function useStorageParams(): StorageParams {
  const { locationId, itemId } = useParams<{ locationId: string; itemId: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const sort = parseSortField(searchParams.get(SORT_PARAM));
  const direction = parseSortDirection(searchParams.get(DIRECTION_PARAM));
  const search = searchParams.toString();

  function update(nextSort: SortField, nextDirection: SortDirection): void {
    setSearchParams(
      (current) => {
        const next = new URLSearchParams(current);
        setOrDelete(next, SORT_PARAM, nextSort, DEFAULT_SORT_FIELD);
        setOrDelete(next, DIRECTION_PARAM, nextDirection, DEFAULT_SORT_DIRECTION);
        return next;
      },
      { replace: true },
    );
  }

  const locationLink = useCallback(
    (id: string): Partial<Path> => ({
      pathname: `/storage/${encodeURIComponent(id)}`,
      search: search === '' ? '' : `?${search}`,
    }),
    [search],
  );

  const itemLinkIn = useCallback(
    (inLocationId: string, id: string): Partial<Path> => ({
      pathname: `/storage/${encodeURIComponent(inLocationId)}/items/${encodeURIComponent(id)}`,
      search: search === '' ? '' : `?${search}`,
    }),
    [search],
  );

  const itemLink = useCallback(
    (id: string): Partial<Path> => itemLinkIn(locationId ?? '', id),
    [itemLinkIn, locationId],
  );

  return {
    locationId,
    itemId,
    sort,
    direction,
    setSort: (field) => update(field, direction),
    toggleDirection: () => update(sort, direction === 'asc' ? 'desc' : 'asc'),
    locationLink,
    itemLink,
    itemLinkIn,
  };
}

function setOrDelete(params: URLSearchParams, key: string, value: string, fallback: string): void {
  if (value === fallback) params.delete(key);
  else params.set(key, value);
}
