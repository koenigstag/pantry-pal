import { EXPIRY_WARNING_DAYS } from '../constants';
import type { ExpiryStatus, PantryItem } from '../types';

const MS_PER_DAY = 86_400_000;

/**
 * Whole days from `now` until `isoDate`, compared date-to-date in UTC so that a
 * item expiring "later today" reads as 0 rather than a fraction.
 *
 * Returns `NaN` for an unparseable date.
 */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const target = new Date(isoDate);
  if (Number.isNaN(target.getTime())) return Number.NaN;

  const targetDay = Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());
  const nowDay = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());

  return Math.round((targetDay - nowDay) / MS_PER_DAY);
}

/** `'unknown'` means no expiry date was recorded, not that the item is fine. */
export function getExpiryStatus(item: PantryItem, now: Date = new Date()): ExpiryStatus {
  if (item.expiresAt === null) return 'unknown';

  const days = daysUntil(item.expiresAt, now);
  if (Number.isNaN(days)) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARNING_DAYS) return 'expiring-soon';
  return 'fresh';
}

export function isExpired(item: PantryItem, now: Date = new Date()): boolean {
  return getExpiryStatus(item, now) === 'expired';
}

export function isExpiringSoon(item: PantryItem, now: Date = new Date()): boolean {
  return getExpiryStatus(item, now) === 'expiring-soon';
}

const STATUS_ORDER: Record<ExpiryStatus, number> = {
  expired: 0,
  'expiring-soon': 1,
  fresh: 2,
  unknown: 3,
};

/** Most urgent first, then alphabetically. Returns a new array. */
export function sortByUrgency(items: readonly PantryItem[], now: Date = new Date()): PantryItem[] {
  return items.toSorted((a, b) => {
    const delta = STATUS_ORDER[getExpiryStatus(a, now)] - STATUS_ORDER[getExpiryStatus(b, now)];
    return delta === 0 ? a.name.localeCompare(b.name) : delta;
  });
}
