import { consumeOrder, type SubItem, type SubItemState } from '@pantry-pal/shared';

/**
 * An item's units in one state — the same dates, and as much left — shown as
 * one row: ten unopened eggs are one row of ten, not ten rows.
 */
export interface SubItemGroup {
  /** The state they share, which names the group across renders. */
  key: string;
  /** In the order they go; an action on one of them takes the first. */
  units: readonly SubItem[];
}

/** What makes two units the same row. */
export function stateKey(unit: SubItemState): string {
  return [unit.expiresAt, unit.openedAt, unit.periodAfterOpeningDays, unit.fillPercent].join('|');
}

/**
 * The units on the shelf, grouped by state, in the order they go: opened ones
 * first, then the soonest to expire. The stepper's minus takes from the top.
 */
export function groupSubItems(units: readonly SubItem[]): SubItemGroup[] {
  const groups = new Map<string, SubItem[]>();
  for (const unit of consumeOrder(units)) {
    const key = stateKey(unit);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [unit]);
    else group.push(unit);
  }
  return [...groups].map(([key, members]) => ({ key, units: members }));
}
