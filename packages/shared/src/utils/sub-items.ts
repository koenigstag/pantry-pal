import { FULL_FILL_PERCENT, ITEM_STATUS } from '../constants';
import type { PantryItem, SubItem } from '../types';

/**
 * What a unit's state is made of: what a new one starts with, and what editing
 * one changes. Its status and identity are kept apart.
 */
export type SubItemState = Pick<
  SubItem,
  'expiresAt' | 'openedAt' | 'periodAfterOpeningDays' | 'fillPercent'
>;

export const isActiveSubItem = (unit: SubItem): boolean => unit.status === ITEM_STATUS.Active;

/** Ascending, with `null` last. `YYYY-MM-DD` strings and ISO instants compare as what they name. */
function compareNullsLast(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The unit an item shows its dates from: the active one that expires first,
 * undated ones last; with none active, the one changed last. Ties go to the one
 * changed last, then to the lower id.
 *
 * The order of `LEAD_UNIT_ORDER` in `@pantry-pal/db`, over the units given: the
 * server also holds the units used up long ago, which a client does not, so
 * with no active unit here the two can differ. `withSubItems` keeps the item's
 * dates then.
 */
export function leadSubItem(units: readonly SubItem[]): SubItem | undefined {
  return units.toSorted((a, b) => {
    const activeFirst = Number(isActiveSubItem(b)) - Number(isActiveSubItem(a));
    if (activeFirst !== 0) return activeFirst;
    if (isActiveSubItem(a)) {
      const expiry = compareNullsLast(a.effectiveExpiresAt, b.effectiveExpiresAt);
      if (expiry !== 0) return expiry;
    }
    return compareText(b.updatedAt, a.updatedAt) || compareText(a.id, b.id);
  })[0];
}

/**
 * The active units in the order a lower quantity uses them up: opened ones
 * first, then the soonest to expire (undated last), then the oldest. The order
 * of `CONSUME_ORDER` in `@pantry-pal/db`. Returns a new array.
 */
export function consumeOrder(units: readonly SubItem[]): SubItem[] {
  return units
    .filter(isActiveSubItem)
    .toSorted(
      (a, b) =>
        Number(a.openedAt === null) - Number(b.openedAt === null) ||
        compareNullsLast(a.effectiveExpiresAt, b.effectiveExpiresAt) ||
        compareText(a.createdAt, b.createdAt) ||
        compareText(a.id, b.id),
    );
}

/**
 * What a unit added by a higher quantity starts as — stepping up, or putting
 * the shopping away: unopened and full, with the printed date and period after
 * opening of the newest active unit, or with none, of the item as it shows.
 * The server's rule (`ItemsRepository`), for a change made offline.
 */
export function freshSubItemState(
  item: Pick<PantryItem, 'expiresAt' | 'periodAfterOpeningDays' | 'subItems'>,
): SubItemState {
  const newest = item.subItems
    .filter(isActiveSubItem)
    .toSorted(
      (a, b) =>
        compareText(b.createdAt, a.createdAt) ||
        compareText(b.updatedAt, a.updatedAt) ||
        compareText(a.id, b.id),
    )[0];
  const source = newest ?? item;

  return {
    expiresAt: source.expiresAt,
    openedAt: null,
    periodAfterOpeningDays: source.periodAfterOpeningDays,
    fillPercent: FULL_FILL_PERCENT,
  };
}

/**
 * `item` holding `subItems`, with what the server works out from them: the
 * quantity is how many are active, and the dates are the lead unit's. With no
 * unit to read them from, the item keeps the dates it had, as the server keeps
 * showing a used-up unit's.
 */
export function withSubItems<T extends PantryItem>(item: T, subItems: SubItem[]): T {
  const lead = leadSubItem(subItems);

  return {
    ...item,
    subItems,
    quantity: subItems.filter(isActiveSubItem).length,
    ...(lead !== undefined && {
      expiresAt: lead.expiresAt,
      openedAt: lead.openedAt,
      periodAfterOpeningDays: lead.periodAfterOpeningDays,
      effectiveExpiresAt: lead.effectiveExpiresAt,
    }),
  };
}
