import {
  EXPIRY_WARNING_DAYS,
  daysUntil,
  formatDate,
  formatQuantity,
  titleCase,
  type ExpiryStatus,
  type PantryItem,
} from '@pantry-pal/shared';
import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { usePantryStore } from '../stores/StoreContext';

function expiryLabel(item: PantryItem, status: ExpiryStatus): string {
  if (item.expiresAt === null) return 'No expiry date';

  const days = daysUntil(item.expiresAt);
  const formatted = formatDate(item.expiresAt);

  switch (status) {
    case 'expired':
      return `Expired ${formatted}`;
    case 'expiring-soon':
      return days === 0 ? `Expires today` : `Expires in ${days}d — ${formatted}`;
    default:
      return `Expires ${formatted}`;
  }
}

const PantryRow = observer(function PantryRow({ item }: { item: PantryItem }): ReactElement {
  const pantry = usePantryStore();
  const status = pantry.statusOf(item);

  return (
    <li className={`item item--${status}`}>
      <div className="item__main">
        <span className="item__name">{item.name}</span>
        <span className="item__meta">
          {formatQuantity(item.quantity, item.unit)} · {titleCase(item.category)}
        </span>
      </div>

      <span className={`pill pill--${status}`}>{expiryLabel(item, status)}</span>

      <button
        className="button button--ghost"
        type="button"
        aria-label={`Remove ${item.name}`}
        onClick={() => pantry.removeItem(item.id)}
      >
        ✕
      </button>
    </li>
  );
});

export const PantryList = observer(function PantryList(): ReactElement {
  const pantry = usePantryStore();

  if (pantry.isLoading && pantry.all.length === 0) {
    return <p className="empty">Loading pantry…</p>;
  }

  if (pantry.all.length === 0) {
    return <p className="empty">Your pantry is empty. Add something above.</p>;
  }

  return (
    <>
      <p className="hint">
        Sorted by urgency — anything within {EXPIRY_WARNING_DAYS} days is flagged.
      </p>
      <ul className="items">
        {pantry.all.map((item) => (
          <PantryRow key={item.id} item={item} />
        ))}
      </ul>
    </>
  );
});
