import { daysUntil, getExpiryStatus, type PantryItem } from '@pantry-pal/shared';
import { Clock, Package } from 'lucide-react';
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
 * One item: expiry and selection on top, a photo placeholder, the name, its
 * amount, and a quantity stepper. Anywhere else on the card opens its details.
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

  const amount = amountText(item, quantities.quantityOf(item), pantry.unitLabel);

  return (
    <article
      aria-labelledby={nameId}
      className={cn(
        'relative flex h-full flex-col rounded-xl border bg-surface p-2 transition-shadow',
        selected ? 'border-accent ring-2 ring-accent' : 'border-line shadow-xs hover:shadow-sm',
      )}
    >
      <div className="flex min-h-7 items-center gap-1">
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

      <div
        aria-hidden="true"
        className="mt-1 flex aspect-square items-center justify-center rounded-lg bg-sunken text-ink-muted"
      >
        <Package className="size-1/3" strokeWidth={1.25} />
      </div>

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
      <p className="mt-auto truncate pt-0.5 text-xs text-ink-muted">{amount}</p>

      <QuantityStepper item={item} onRemove={onRemove} className="relative z-10 pt-2" />
    </article>
  );
});

/** Days left until `effectiveExpiresAt`, which beats the printed date once an item is opened. */
function ExpiryBadge({ item }: { item: PantryItem }): ReactElement | null {
  if (item.effectiveExpiresAt === null) return null;

  const days = daysUntil(item.effectiveExpiresAt);
  if (Number.isNaN(days)) return null;

  const description = messages.item.expiryDescription(days);

  return (
    <span
      title={description}
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
        EXPIRY_TONES[getExpiryStatus(item)],
      )}
    >
      <Clock aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true">{messages.item.expiryBadge(days)}</span>
      <span className="sr-only">{description}</span>
    </span>
  );
}
