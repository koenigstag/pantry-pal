import { COUNT_UNIT, type ExpiryStatus, type PantryItem } from '@pantry-pal/shared';

import { messages } from '../../i18n/messages';
import { sizeOf } from './itemOrder';

export const EXPIRY_TONES: Record<ExpiryStatus, string> = {
  expired: 'bg-danger-soft text-danger',
  'expiring-soon': 'bg-warn-soft text-warn',
  fresh: 'bg-sunken text-ink-muted',
  unknown: 'bg-sunken text-ink-muted',
};

/** `PantryStore.unitName`: a unit as it reads after a count. */
type UnitName = (code: string, count: number) => string;

/**
 * The amount line of cards and the details: how many, and what is in each when
 * that is known — `6 cans`, `2 cans × 400 g`. Plain pieces keep their unit only
 * when there is no size: `5 pcs`, but `2 × 150 g`.
 *
 * Takes the quantity to show rather than reading `item.quantity`, so a step not
 * yet saved updates the line too.
 */
export function amountText(item: PantryItem, quantity: number, unitName: UnitName): string {
  const size = sizeOf(item);
  if (size === null) return messages.item.amount(quantity, unitName(item.unit, quantity));

  const sizeUnit = unitName(size.unit, size.value);
  return item.unit === COUNT_UNIT
    ? messages.item.sizeWithCount(quantity, size.value, sizeUnit)
    : messages.item.amountWithSize(quantity, unitName(item.unit, quantity), size.value, sizeUnit);
}
