import {
  daysUntil,
  FULL_FILL_PERCENT,
  getExpiryStatus,
  MAX_ITEM_QUANTITY,
  type PantryItem,
  type SubItem,
} from '@pantry-pal/shared';
import { ChevronRight, Clock, Plus, TriangleAlert } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type ReactElement } from 'react';

import { formatCalendarDate, formatPercent } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { EXPIRY_TONES } from './itemDisplay';
import { groupSubItems, type SubItemGroup } from './subItemGroups';
import { FillSheet, GroupSheet, UnitsFormSheet, type UnitsForm } from './SubItemSheets';

/** Which sheet is open, and for which row: rows are named by their state. */
type OpenSheet = { kind: 'row' | 'fill' | 'dates'; key: string } | { kind: 'add' } | null;

interface SubItemsSectionProps {
  item: PantryItem;
  /** Opens the remove sheet, for the item's last unit: it leaves with the item. */
  onRemove: (item: PantryItem) => void;
}

/**
 * An item's units on the shelf, a row for each state they are in — ten
 * unopened eggs are one row of ten — the row to use first at the top. A row
 * opens what can be done to one of its units, and Add more puts units on the
 * shelf with dates of their own.
 */
export const SubItemsSection = observer(function SubItemsSection({
  item,
  onRemove,
}: SubItemsSectionProps): ReactElement {
  const pantry = usePantryStore();
  const [sheet, setSheet] = useState<OpenSheet>(null);

  const groups = groupSubItems(item.subItems);
  // Gone when its units changed meanwhile — here or by someone else: its sheet closes.
  const open =
    sheet !== null && sheet.kind !== 'add' ? groups.find((g) => g.key === sheet.key) : undefined;
  const canAdd = item.quantity < MAX_ITEM_QUANTITY;
  const close = (): void => setSheet(null);

  let form: UnitsForm | undefined;
  if (sheet?.kind === 'add') form = { mode: 'add' };
  else if (sheet?.kind === 'dates' && open !== undefined) form = { mode: 'change', group: open };

  return (
    <>
      {groups.length > 0 && (
        <ul className="mt-3 divide-y divide-line overflow-hidden rounded-lg border border-line">
          {groups.map((group) => (
            <li key={group.key}>
              <SubItemRow
                title={rowTitle(item, group, pantry.unitName)}
                unit={group.units[0]}
                onOpen={() => setSheet({ kind: 'row', key: group.key })}
              />
            </li>
          ))}
        </ul>
      )}

      <button
        type="button"
        aria-disabled={!canAdd || undefined}
        onClick={canAdd ? () => setSheet({ kind: 'add' }) : undefined}
        className={cn(
          'focus-ring mt-3 inline-flex h-9 items-center gap-2 rounded-full border border-line px-4 text-sm font-medium transition-colors',
          canAdd ? 'cursor-pointer hover:bg-sunken' : 'cursor-not-allowed opacity-60',
        )}
      >
        <Plus aria-hidden="true" className="size-4" />
        {messages.subItems.addMore}
      </button>

      <GroupSheet
        item={item}
        group={sheet?.kind === 'row' ? open : undefined}
        title={open === undefined ? '' : rowTitle(item, open, pantry.unitName)}
        onClose={close}
        onFill={() => open !== undefined && setSheet({ kind: 'fill', key: open.key })}
        onChangeDates={() => open !== undefined && setSheet({ kind: 'dates', key: open.key })}
        onRemoveItem={() => {
          close();
          onRemove(item);
        }}
      />
      <FillSheet item={item} group={sheet?.kind === 'fill' ? open : undefined} onClose={close} />
      <UnitsFormSheet item={item} form={form} onClose={close} />
    </>
  );
});

/** `2 cartons · Unopened`, `1 carton · Opened 20 Sep 2026`: how many, and the state they share. */
function rowTitle(
  item: PantryItem,
  group: SubItemGroup,
  unitName: (code: string, count: number) => string,
): string {
  const count = group.units.length;
  const first = group.units[0];
  const state =
    first === undefined || first.openedAt === null
      ? messages.subItems.unopened
      : messages.subItems.opened(formatCalendarDate(first.openedAt));
  return messages.subItems.group(messages.item.amount(count, unitName(item.unit, count)), state);
}

function SubItemRow({
  title,
  unit,
  onOpen,
}: {
  title: string;
  /** The row's first unit: every unit of a row is in the same state. */
  unit: SubItem | undefined;
  onOpen: () => void;
}): ReactElement {
  const facts =
    unit === undefined
      ? ''
      : [
          unit.fillPercent < FULL_FILL_PERCENT
            ? messages.subItems.left(formatPercent(unit.fillPercent))
            : null,
          unit.effectiveExpiresAt === null
            ? messages.itemDetails.noExpiry
            : messages.subItems.goodUntil(formatCalendarDate(unit.effectiveExpiresAt)),
        ]
          .filter((fact) => fact !== null)
          .join(' · ');

  return (
    <button
      type="button"
      onClick={onOpen}
      className="focus-ring flex w-full cursor-pointer items-center gap-3 px-3 py-2.5 text-start transition-colors hover:bg-sunken"
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-sm font-medium break-words">{title}</span>
        <span className="text-xs text-ink-muted">{facts}</span>
      </span>
      {unit !== undefined && <ExpiryBadge unit={unit} />}
      <ChevronRight
        aria-hidden="true"
        className="size-4 shrink-0 text-ink-muted rtl:-scale-x-100"
      />
    </button>
  );
}

/** Days left until the unit's effective expiry, toned as on the cards. */
function ExpiryBadge({ unit }: { unit: SubItem }): ReactElement | null {
  if (unit.effectiveExpiresAt === null) return null;

  const days = daysUntil(unit.effectiveExpiresAt);
  if (Number.isNaN(days)) return null;

  const Icon = days < 0 ? TriangleAlert : Clock;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-medium tabular-nums',
        EXPIRY_TONES[getExpiryStatus(unit)],
      )}
    >
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span aria-hidden="true">{messages.item.expiryBadge(days)}</span>
      <span className="sr-only">{messages.item.expiryDescription(days)}</span>
    </span>
  );
}
