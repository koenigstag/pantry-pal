import { ITEM_STATUS, MAX_ITEM_QUANTITY, type ShoppingListEntry } from '@pantry-pal/shared';
import { Minus, Plus, Trash } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactElement } from 'react';

import { formatNumber } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { useNotices, usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { IconButton } from '../../ui/IconButton';
import { amountText } from '../storage/itemDisplay';
import { locationName } from '../storage/locationName';

/**
 * An item on a shopping list: tick it off, change how many to buy, or take it
 * off the list — the minus turns into a bin at one, like a card's stepper.
 *
 * Nothing here is optimistic. Each change waits for the server, and while it
 * does, the controls ignore presses: `aria-disabled`, not `disabled`, so a
 * keyboard user's focus stays on the button just pressed.
 */
export const ShoppingEntryRow = observer(function ShoppingEntryRow({
  entry,
}: {
  entry: ShoppingListEntry;
}): ReactElement | null {
  const pantry = usePantryStore();
  const notices = useNotices();
  const [isBusy, setBusy] = useState(false);

  // Only until the item arrives, which it does with the entry from the server.
  const item = pantry.itemsById.get(entry.itemId);
  if (item === undefined) return null;

  const isTicked = entry.checkedAt !== null;
  const location = pantry.locations.find((candidate) => candidate.id === item.locationId);
  const isInStock = item.status === ITEM_STATUS.Active && item.quantity > 0;
  const details = [
    amountText(item, entry.quantity, pantry.unitName),
    location === undefined ? null : locationName(location),
    isInStock ? messages.shopping.left(item.quantity) : messages.shopping.noneLeft,
  ]
    .filter((part) => part !== null)
    .join(' · ');

  async function run(change: () => Promise<string | null>): Promise<void> {
    if (isBusy) return;
    setBusy(true);
    const failure = await change();
    setBusy(false);
    if (failure !== null) notices.error(failure);
  }

  const busyProps = isBusy ? { 'aria-disabled': true } : {};

  return (
    <li
      className={cn(
        'flex items-center gap-2 rounded-xl border border-line py-1.5 ps-3 pe-1.5',
        isTicked ? 'bg-sunken' : 'bg-surface',
      )}
    >
      <label className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 py-1">
        <input
          type="checkbox"
          checked={isTicked}
          {...busyProps}
          onChange={(event) => {
            const checked = event.target.checked;
            void run(() => pantry.updateShoppingEntry(entry, { checked }));
          }}
          className="focus-ring size-5 shrink-0 cursor-pointer accent-accent"
        />
        <span className="flex min-w-0 flex-col">
          <span className={cn('truncate font-medium', isTicked && 'text-ink-muted line-through')}>
            {item.name}
          </span>
          <span className="truncate text-xs text-ink-muted">{details}</span>
        </span>
      </label>

      <div className="flex shrink-0 items-center gap-0.5">
        {entry.quantity <= 1 ? (
          <IconButton
            icon={Trash}
            label={messages.shopping.remove(item.name)}
            size="sm"
            {...busyProps}
            onClick={() => void run(() => pantry.removeShoppingEntry(entry))}
            className="text-ink-muted hover:bg-danger-soft hover:text-danger"
          />
        ) : (
          <IconButton
            icon={Minus}
            label={messages.shopping.decrease(item.name)}
            size="sm"
            {...busyProps}
            onClick={() =>
              void run(() => pantry.updateShoppingEntry(entry, { quantity: entry.quantity - 1 }))
            }
            className="text-ink-muted hover:bg-sunken hover:text-ink"
          />
        )}
        <output
          aria-label={messages.shopping.quantity(item.name)}
          className="min-w-6 text-center text-sm font-semibold tabular-nums"
        >
          {formatNumber(entry.quantity)}
        </output>
        <IconButton
          icon={Plus}
          label={messages.shopping.increase(item.name)}
          size="sm"
          disabled={entry.quantity >= MAX_ITEM_QUANTITY}
          {...busyProps}
          onClick={() =>
            void run(() => pantry.updateShoppingEntry(entry, { quantity: entry.quantity + 1 }))
          }
          className="text-accent hover:bg-accent-soft"
        />
      </div>
    </li>
  );
});
