import type { PantryItem } from '@pantry-pal/shared';

import { nameCollator, normalizeForSearch } from '../../i18n/format';

export const SORT_FIELDS = ['name', 'expiry', 'quantity', 'size'] as const;
export type SortField = (typeof SORT_FIELDS)[number];

export const SORT_DIRECTIONS = ['asc', 'desc'] as const;
export type SortDirection = (typeof SORT_DIRECTIONS)[number];

export const DEFAULT_SORT_FIELD: SortField = 'name';
export const DEFAULT_SORT_DIRECTION: SortDirection = 'asc';

export function parseSortField(value: string | null): SortField {
  return SORT_FIELDS.find((field) => field === value) ?? DEFAULT_SORT_FIELD;
}

export function parseSortDirection(value: string | null): SortDirection {
  return SORT_DIRECTIONS.find((direction) => direction === value) ?? DEFAULT_SORT_DIRECTION;
}

/** A value and a unit code: the `400 g` of `2 cans × 400 g`. */
export interface Size {
  value: number;
  unit: string;
}

/**
 * What is inside each one, which "sort by size" orders by. A bare count
 * (`6 cans`) has no size.
 */
export function sizeOf(item: PantryItem): Size | null {
  return item.sizeValue === null || item.sizeUnit === null
    ? null
    : { value: item.sizeValue, unit: item.sizeUnit };
}

/**
 * Sorts a copy.
 *
 * Items with nothing to sort by (no expiry date, no size) go last in both
 * directions: reversing the order should reverse the list, not float the blanks
 * to the top. Ties fall back to name and then id, so the order is stable
 * across refetches.
 *
 * `quantity` sorts by the server's value, not a pending tap, so a card does not
 * jump away from under the finger while its quantity is being stepped.
 */
export function sortItems(
  items: readonly PantryItem[],
  field: SortField,
  direction: SortDirection,
  unitLabel: (code: string) => string,
): PantryItem[] {
  const sign = direction === 'asc' ? 1 : -1;

  const primary = (a: PantryItem, b: PantryItem): number => {
    switch (field) {
      case 'name':
        return sign * nameCollator.compare(a.name, b.name);
      case 'expiry':
        return blanksLast(a.effectiveExpiresAt, b.effectiveExpiresAt, sign, compareStrings);
      case 'quantity':
        return sign * (a.quantity - b.quantity);
      case 'size':
        // Unit first, then the number within it, as the size line reads.
        return blanksLast(
          sizeOf(a),
          sizeOf(b),
          sign,
          (x, y) => nameCollator.compare(unitLabel(x.unit), unitLabel(y.unit)) || x.value - y.value,
        );
    }
  };

  return items.toSorted(
    (a, b) => primary(a, b) || nameCollator.compare(a.name, b.name) || compareStrings(a.id, b.id),
  );
}

function blanksLast<T>(
  a: T | null,
  b: T | null,
  sign: number,
  compare: (x: T, y: T) => number,
): number {
  if (a === null || b === null) {
    if (a === b) return 0;
    return a === null ? 1 : -1;
  }
  return sign * compare(a, b);
}

/** ISO dates and UUIDs compare correctly as plain strings; no collation wanted. */
function compareStrings(a: string, b: string): number {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

/** Items whose name contains `query`, ignoring case and accents. */
export function filterItems(items: readonly PantryItem[], query: string): readonly PantryItem[] {
  const needle = normalizeForSearch(query);
  if (needle === '') return items;
  return items.filter((item) => normalizeForSearch(item.name).includes(needle));
}
