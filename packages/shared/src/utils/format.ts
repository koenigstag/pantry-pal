import type { PantryUnit } from '../types';

const PLURALISABLE = new Set<PantryUnit>(['pack', 'can', 'bottle']);

/** `2, 'can'` -> `"2 cans"`; `1, 'kg'` -> `"1 kg"`. */
export function formatQuantity(quantity: number, unit: PantryUnit): string {
  const suffix = quantity === 1 || !PLURALISABLE.has(unit) ? unit : `${unit}s`;
  return `${quantity} ${suffix}`;
}

export function titleCase(value: string): string {
  return value.length === 0 ? value : value[0]!.toUpperCase() + value.slice(1);
}

/** `"2026-09-16"` -> `"16 Sep 2026"`; unparseable input is returned unchanged. */
export function formatDate(isoDate: string, locale = 'en-GB'): string {
  const date = new Date(isoDate);
  if (Number.isNaN(date.getTime())) return isoDate;

  return new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(date);
}
