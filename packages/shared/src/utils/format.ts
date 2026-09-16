/**
 * `0.5, 'kg'` -> `"0.5 kg"`; `3, 'pcs'` -> `"3 pcs"`.
 *
 * Takes the unit's display label, not its code: `fl_oz_us` renders as `fl oz`.
 * Container nouns ("3 cans") belong to `products.package_label`, not to a unit,
 * so nothing is pluralised here.
 */
export function formatQuantity(quantity: number, unitLabel: string): string {
  return `${quantity} ${unitLabel}`;
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
