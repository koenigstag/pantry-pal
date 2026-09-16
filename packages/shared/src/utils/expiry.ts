import { EXPIRY_WARNING_DAYS } from '../constants';
import type { ExpiryStatus, PantryItem } from '../types';

const MS_PER_DAY = 86_400_000;

/** The one field expiry maths reads. Anything item-shaped qualifies. */
export type Expirable = Pick<PantryItem, 'effectiveExpiresAt'>;

/**
 * Whole days from today until the calendar date `isoDate` (`YYYY-MM-DD`): 0 for
 * today, 1 for tomorrow, negative once it has passed.
 *
 * Today is `now`'s date **in the local time zone**, the user's own calendar —
 * the one "opened today" is written in. Taking UTC's date instead put tomorrow
 * two days away east of UTC between local midnight and UTC's.
 *
 * Returns `NaN` for a string that is not a date.
 */
export function daysUntil(isoDate: string, now: Date = new Date()): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(isoDate);
  if (match === null) return Number.NaN;

  const [year, month, day] = [Number(match[1]), Number(match[2]) - 1, Number(match[3])];
  // Both days as UTC timestamps, so a daylight-saving change between them
  // cannot make a day 23 hours long.
  const targetDay = Date.UTC(year, month, day);
  const target = new Date(targetDay);
  if (target.getUTCMonth() !== month || target.getUTCDate() !== day) return Number.NaN;

  const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((targetDay - today) / MS_PER_DAY);
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
