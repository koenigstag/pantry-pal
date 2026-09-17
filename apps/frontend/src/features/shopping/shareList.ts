import type { PantryItem, ShoppingList, ShoppingListEntry } from '@pantry-pal/shared';

import { messages } from '../../i18n/messages';
import { amountText } from '../storage/itemDisplay';

/** `PantryStore.unitName`: a unit as it reads after a count. */
type UnitName = (code: string, count: number) => string;

/**
 * The text a list is shared as: its name, then a line per thing still to buy,
 * `• Whole milk — 2 bottles × 1 l`. Ticked-off entries are in the cart already,
 * so they are left out. `null` when nothing is left to buy.
 */
export function shoppingListText(
  list: ShoppingList,
  entries: readonly ShoppingListEntry[],
  itemsById: ReadonlyMap<string, PantryItem>,
  unitName: UnitName,
): string | null {
  const lines = entries.flatMap((entry) => {
    const item = itemsById.get(entry.itemId);
    if (entry.checkedAt !== null || item === undefined) return [];
    return [messages.shopping.shareLine(item.name, amountText(item, entry.quantity, unitName))];
  });

  return lines.length === 0 ? null : [list.name, ...lines].join('\n');
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'failed';

/**
 * Hands text to the device's share sheet, which lists the messengers installed;
 * where the browser has none (Firefox on a desktop), copies it instead. Call it
 * straight from a click: browsers open the sheet only in response to one.
 *
 * Only `text` is shared, not a `title` too: some apps paste both, and the text
 * already starts with the list's name.
 */
export async function shareText(text: string): Promise<ShareOutcome> {
  const data: ShareData = { text };

  if (typeof navigator.share === 'function' && navigator.canShare?.(data) !== false) {
    try {
      await navigator.share(data);
      return 'shared';
    } catch (error) {
      // Dismissing the sheet is a choice, not a failure. Anything else copies instead.
      if (error instanceof DOMException && error.name === 'AbortError') return 'cancelled';
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}
