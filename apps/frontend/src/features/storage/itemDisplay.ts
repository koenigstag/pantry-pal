import type { ExpiryStatus, PantryItem } from '@pantry-pal/shared';

import { messages } from '../../i18n/messages';
import { sizeOf } from './itemOrder';

export const EXPIRY_TONES: Record<ExpiryStatus, string> = {
  expired: 'bg-danger-soft text-danger',
  'expiring-soon': 'bg-warn-soft text-warn',
  fresh: 'bg-sunken text-ink-muted',
  unknown: 'bg-sunken text-ink-muted',
};

type UnitLabel = (code: string) => string;

/**
 * An item's size: `2 × 400 g` for counted things with a size, `1.5 kg` for loose
 * goods, or `null` for a bare count.
 *
 * Takes the quantity to show rather than reading `item.quantity`, so a step not
 * yet saved updates the line too.
 */
export function sizeText(item: PantryItem, quantity: number, unitLabel: UnitLabel): string | null {
  const size = sizeOf(item);
  if (size === null) return null;

  return item.sizeValue === null
    ? messages.item.amount(quantity, unitLabel(size.unit))
    : messages.item.sizeWithCount(quantity, size.value, unitLabel(size.unit));
}

/**
 * The amount line of cards and the details: like `sizeText`, but a bare count
 * reads `5 pcs` instead of nothing, so every card shows the line.
 */
export function amountText(item: PantryItem, quantity: number, unitLabel: UnitLabel): string {
  return (
    sizeText(item, quantity, unitLabel) ?? messages.item.amount(quantity, unitLabel(item.unit))
  );
}
