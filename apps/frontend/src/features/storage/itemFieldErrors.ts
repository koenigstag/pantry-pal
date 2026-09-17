import {
  MAX_ITEM_NOTES_LENGTH,
  MAX_ITEM_QUANTITY,
  MAX_PERIOD_AFTER_OPENING_DAYS,
  SIZE_DECIMAL_PLACES,
} from '@pantry-pal/shared';
import type { FieldError } from '@pantry-pal/shared/dto';

import { messages } from '../../i18n/messages';

/**
 * The messages shown under the add and edit forms' fields.
 *
 * The shared DTOs report class-validator's English ("quantity must be an integer
 * number"), which is neither friendly nor translatable. Each field gets one
 * catalog message instead, saying what the field accepts, whichever of its rules
 * the value broke. A property this does not know keeps the DTO's text.
 *
 * `minQuantity` differs by form: creating needs at least one, while an update
 * may record a used-up item as zero.
 */
export function itemFieldErrors(
  errors: readonly FieldError[],
  minQuantity: 0 | 1,
): Record<string, string> {
  const t = messages.fieldErrors;
  const byField: Record<string, string> = {
    name: t.name,
    locationId: t.locationId,
    category: t.category,
    quantity: t.quantity(minQuantity, MAX_ITEM_QUANTITY),
    unit: t.unit,
    sizeValue: t.sizeValue(MAX_ITEM_QUANTITY, SIZE_DECIMAL_PLACES),
    sizeUnit: t.sizeUnit,
    expiresAt: t.date,
    openedAt: t.date,
    periodAfterOpeningDays: t.periodAfterOpeningDays(MAX_PERIOD_AFTER_OPENING_DAYS),
    notes: t.notes(MAX_ITEM_NOTES_LENGTH),
    defaultShoppingListId: t.defaultShoppingListId,
  };

  return Object.fromEntries(
    errors.map((error) => [
      error.property,
      byField[error.property] ?? error.messages[0] ?? t.generic,
    ]),
  );
}
