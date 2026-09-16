import { daysUntil, getExpiryStatus, type PantryItem } from '@pantry-pal/shared';
import { Clock, MapPin, PackageOpen, Tag, Trash, type LucideIcon } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import type { ReactElement, ReactNode } from 'react';

import { formatCalendarDate, formatInstant } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { usePantryStore, useQuantities } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { DETAILS_GRID, DetailsSection, ItemPhoto } from './detailsLayout';
import { amountText, EXPIRY_TONES } from './itemDisplay';
import { locationName } from './locationName';
import { QuantityStepper } from './QuantityStepper';

interface ItemDetailsViewProps {
  item: PantryItem;
  /** A save or quick action is in flight. */
  isBusy: boolean;
  onMarkOpened: () => void;
  onRemove: (item: PantryItem) => void;
}

/** The read-only side of the item modal, with the edits that need no form. */
export const ItemDetailsView = observer(function ItemDetailsView({
  item,
  isBusy,
  onMarkOpened,
  onRemove,
}: ItemDetailsViewProps): ReactElement {
  const pantry = usePantryStore();
  const quantities = useQuantities();
  const location = pantry.locations.find((candidate) => candidate.id === item.locationId);

  return (
    <div className={DETAILS_GRID}>
      <ItemPhoto className="flex" />

      <div className="flex min-w-0 flex-col gap-4">
        <div className="flex flex-wrap gap-2">
          {location !== undefined && <Chip icon={MapPin}>{locationName(location)}</Chip>}
          <Chip icon={Tag}>{pantry.categoryName(item.category)}</Chip>
        </div>

        <DetailsSection title={messages.itemDetails.quantity}>
          <div className="flex items-center justify-between gap-4">
            <p className="min-w-0 break-words text-ink-muted">
              {amountText(item, quantities.quantityOf(item), pantry.unitName)}
            </p>
            <QuantityStepper item={item} onRemove={onRemove} size="md" className="w-36 shrink-0" />
          </div>
        </DetailsSection>

        <DetailsSection title={messages.itemDetails.expiry}>
          <ExpirySummary item={item} />
          <dl className="mt-3 grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
            <DetailRow
              term={messages.itemDetails.printedDate}
              value={
                item.expiresAt === null
                  ? messages.itemDetails.notSet
                  : formatCalendarDate(item.expiresAt)
              }
            />
            <DetailRow
              term={messages.itemDetails.opened}
              value={
                item.openedAt === null
                  ? messages.itemDetails.notOpened
                  : formatCalendarDate(item.openedAt)
              }
            />
            <DetailRow
              term={messages.itemDetails.useWithin}
              value={
                item.periodAfterOpeningDays === null
                  ? messages.itemDetails.notSet
                  : messages.itemDetails.useWithinDays(item.periodAfterOpeningDays)
              }
            />
          </dl>
          {openingBroughtExpiryForward(item) && (
            <p className="mt-3 text-sm text-ink-muted">{messages.itemDetails.openedSooner}</p>
          )}
          {item.openedAt === null && (
            <button
              type="button"
              onClick={onMarkOpened}
              disabled={isBusy}
              className="focus-ring mt-4 inline-flex h-9 cursor-pointer items-center gap-2 rounded-full border border-line px-4 text-sm font-medium transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60"
            >
              <PackageOpen aria-hidden="true" className="size-4" />
              {messages.itemDetails.markOpened}
            </button>
          )}
        </DetailsSection>

        {item.notes !== null && (
          <DetailsSection title={messages.itemDetails.notes}>
            <p className="text-sm break-words whitespace-pre-wrap">{item.notes}</p>
          </DetailsSection>
        )}

        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-1 text-xs text-ink-muted">
          <DetailRow term={messages.itemDetails.added} value={formatInstant(item.createdAt)} />
          <DetailRow term={messages.itemDetails.updated} value={formatInstant(item.updatedAt)} />
        </dl>

        <button
          type="button"
          onClick={() => onRemove(item)}
          className="focus-ring inline-flex h-10 cursor-pointer items-center gap-2 self-start rounded-full px-4 text-sm font-semibold text-danger transition-colors hover:bg-danger-soft"
        >
          <Trash aria-hidden="true" className="size-4" />
          {messages.itemDetails.remove}
        </button>
      </div>
    </div>
  );
});

/** The effective expiry, which beats the printed date once an item is opened. */
function ExpirySummary({ item }: { item: PantryItem }): ReactElement {
  if (item.effectiveExpiresAt === null) {
    return <p className="text-sm text-ink-muted">{messages.itemDetails.noExpiry}</p>;
  }

  const days = daysUntil(item.effectiveExpiresAt);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {!Number.isNaN(days) && (
        <span
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-sm font-medium',
            EXPIRY_TONES[getExpiryStatus(item)],
          )}
        >
          <Clock aria-hidden="true" className="size-4" />
          {messages.item.expiryDescription(days)}
        </span>
      )}
      <span className="text-sm text-ink-muted">{formatCalendarDate(item.effectiveExpiresAt)}</span>
    </div>
  );
}

/** True when an opened item's use-within period ends before its printed date. */
function openingBroughtExpiryForward(item: PantryItem): boolean {
  return (
    item.expiresAt !== null &&
    item.effectiveExpiresAt !== null &&
    item.effectiveExpiresAt < item.expiresAt
  );
}

function DetailRow({ term, value }: { term: string; value: string }): ReactElement {
  return (
    <>
      <dt className="text-ink-muted">{term}</dt>
      <dd className="break-words">{value}</dd>
    </>
  );
}

function Chip({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }): ReactElement {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-sunken px-3 py-1 text-sm">
      <Icon aria-hidden="true" className="size-4 text-ink-muted" />
      {children}
    </span>
  );
}
