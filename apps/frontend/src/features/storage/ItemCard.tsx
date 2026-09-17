import { daysUntil, getExpiryStatus, type PantryItem } from '@pantry-pal/shared';
import { Clock, Package, Plus, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useId, type ReactElement } from 'react';
import { Link, type To } from 'react-router';

import { messages } from '../../i18n/messages';
import { usePantryStore, useQuantities } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { OPENED_FROM_LIST } from './itemDetailsNavigation';
import { amountText, EXPIRY_TONES } from './itemDisplay';
import { QuantityStepper } from './QuantityStepper';

interface ItemCardProps {
  item: PantryItem;
  selected: boolean;
  /**
   * These three must be stable: the card is memoised and re-renders only when
   * its props change.
   */
  detailsLink: (itemId: string) => To;
  onToggleSelected: (itemId: string) => void;
  onRemove: (item: PantryItem) => void;
}

/**
 * One item: a photo placeholder reaching the border, with expiry and selection
 * over its top corners, then the name, its amount, and a quantity stepper, padded.
 * Anywhere else on the card opens its details.
 *
 * The whole-card target is the name's link stretched over the card by an
 * `::after` overlay, so the checkbox and the stepper are not nested inside a
 * link (invalid, and confusing to screen readers); they sit above the overlay
 * with `relative z-10`.
 */
export const ItemCard = observer(function ItemCard({
  item,
  selected,
  detailsLink,
  onToggleSelected,
  onRemove,
}: ItemCardProps): ReactElement {
  const pantry = usePantryStore();
  const quantities = useQuantities();
  const nameId = useId();

  const amount = amountText(item, quantities.quantityOf(item), pantry.unitName);

  return (
    <article
      aria-labelledby={nameId}
      className={cn(
        'relative flex h-full flex-col rounded-xl border bg-surface transition-shadow',
        selected ? 'border-accent ring-2 ring-accent' : 'border-line shadow-xs hover:shadow-sm',
      )}
    >
      {/* The photo reaches the border; its top corners follow the card's, inside the border. */}
      <div
        aria-hidden="true"
        className="flex aspect-square items-center justify-center rounded-t-[calc(var(--radius-xl)-1px)] bg-sunken text-ink-muted"
      >
        <Package className="size-1/3" strokeWidth={1.25} />
      </div>

      {/* Over the photo's top corners, where the card's padding used to put them. */}
      <div className="absolute inset-x-0 top-0 flex min-h-7 items-center gap-1 p-2">
        <ExpiryBadge item={item} />
        <label className="relative z-10 -me-1 ms-auto flex size-7 shrink-0 cursor-pointer items-center justify-center">
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelected(item.id)}
            aria-label={messages.item.select(item.name)}
            className="focus-ring size-4.5 cursor-pointer accent-accent"
          />
        </label>
      </div>

      <div className="flex flex-1 flex-col px-2 pb-2">
        <h3 id={nameId} className="mt-2 line-clamp-2 text-sm leading-snug font-medium break-words">
          <Link
            to={detailsLink(item.id)}
            state={OPENED_FROM_LIST}
            className="after:absolute after:inset-0 after:rounded-xl focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-2 focus-visible:after:outline-accent"
          >
            {item.name}
          </Link>
        </h3>

        {/* mt-auto: the amount and the stepper sit at the bottom, level across a row however long the names. */}
        {/* Two lines rather than an ellipsis, which would hide the size: `2 blisters` / `× 10 pills`. */}
        <p className="mt-auto line-clamp-2 pt-0.5 text-xs break-words text-ink-muted">{amount}</p>

        <QuantityStepper item={item} onRemove={onRemove} className="relative z-10 pt-2" />
      </div>
    </article>
  );
});

/**
 * The card after a storage space's items, filled like an item's photo, with a
 * plus: opens Add item, which starts in that space.
 *
 * It has `ItemCard`'s border and holds its rows, empty: the photo, then the padded
 * text block with one line of name, an amount line and a stepper. So it is as
 * tall as an item even on a row of its own. Change the two together.
 */
export function AddItemCard({ onAdd }: { onAdd: () => void }): ReactElement {
  return (
    <button
      type="button"
      onClick={onAdd}
      aria-label={messages.storage.addItem}
      title={messages.storage.addItem}
      className="focus-ring relative flex h-full w-full cursor-pointer flex-col rounded-xl border border-line bg-sunken text-ink-muted transition-colors hover:bg-accent-soft hover:text-accent"
    >
      <span className="aspect-square" />
      <span className="flex flex-1 flex-col px-2 pb-2">
        <span className="mt-2 h-[1lh] text-sm leading-snug" />
        {/* An amount line (pt-0.5 and 1rem) and a stepper (pt-2 and a size-8 button). */}
        <span className="mt-auto h-14.5 shrink-0" />
      </span>
      <span className="absolute inset-0 flex items-center justify-center">
        <Plus aria-hidden="true" className="h-auto w-1/3" strokeWidth={1.25} />
      </span>
    </button>
  );
}

/** Days left until `effectiveExpiresAt`, which beats the printed date once an item is opened. */
function ExpiryBadge({ item }: { item: PantryItem }): ReactElement | null {
  if (item.effectiveExpiresAt === null) return null;

  const days = daysUntil(item.effectiveExpiresAt);
  if (Number.isNaN(days)) return null;

  const description = messages.item.expiryDescription(days);
  // Past its date: a warning, not a countdown. The colour says so too, but not to everyone.
  const Icon = days < 0 ? TriangleAlert : Clock;

  return (
    <span
      title={description}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
        EXPIRY_TONES[getExpiryStatus(item)],
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true">{messages.item.expiryBadge(days)}</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
