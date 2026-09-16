import { EXPIRY_WARNING_DAYS } from '../constants';
import type { ExpiryStatus, PantryItem } from '../types';

const MS_PER_DAY = 86_400_000;

/** The one field expiry maths reads. Anything item-shaped qualifies. */
export type Expirable = Pick<PantryItem, 'effectiveExpiresAt'>;

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

/**
 * `'unknown'` means no expiry date was recorded, not that the item is fine.
 *
 * Reads `effectiveExpiresAt`, never `expiresAt`: an opened jar marked "use
 * within 5 days" must not report fresh until its printed date.
 */
export function getExpiryStatus(item: Expirable, now: Date = new Date()): ExpiryStatus {
  if (item.effectiveExpiresAt === null) return 'unknown';

  const days = daysUntil(item.effectiveExpiresAt, now);
  if (Number.isNaN(days)) return 'unknown';
  if (days < 0) return 'expired';
  if (days <= EXPIRY_WARNING_DAYS) return 'expiring-soon';
  return 'fresh';
}

export function isExpired(item: Expirable, now: Date = new Date()): boolean {
  return getExpiryStatus(item, now) === 'expired';
}

export function isExpiringSoon(item: Expirable, now: Date = new Date()): boolean {
  return getExpiryStatus(item, now) === 'expiring-soon';
}

/**
 * Soonest effective expiry first, undated items last, then alphabetically.
 * Returns a new array.
 *
 * The same order as `ItemsRepository.list()` in `@pantry-pal/db`
 * (`effective_expires_at ASC NULLS LAST, name`), so a list the server sent and
 * a list the client re-sorted after a broadcast agree. ISO dates compare
 * correctly as strings.
 */
export function sortByUrgency<T extends Expirable & Pick<PantryItem, 'name'>>(
  items: readonly T[],
): T[] {
  return items.toSorted((a, b) => {
    if (a.effectiveExpiresAt !== b.effectiveExpiresAt) {
      if (a.effectiveExpiresAt === null) return 1;
      if (b.effectiveExpiresAt === null) return -1;
      return a.effectiveExpiresAt < b.effectiveExpiresAt ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}
