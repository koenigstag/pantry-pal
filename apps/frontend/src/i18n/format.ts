/**
 * The locale every formatter uses until the app is localized.
 *
 * One constant, so switching to the user's locale later is a single change —
 * and so that, meanwhile, numbers are formatted to match the English copy in
 * `messages.ts` rather than the browser's language.
 */
export const LOCALE = 'en';

const numberFormat = new Intl.NumberFormat(LOCALE, { maximumFractionDigits: 3 });
const pluralRules = new Intl.PluralRules(LOCALE);

/** Orders user-entered names: "Item 2" before "Item 10", case and accents ignored. */
export const nameCollator = new Intl.Collator(LOCALE, { numeric: true, sensitivity: 'base' });

export function formatNumber(value: number): string {
  return numberFormat.format(value);
}

const calendarDateFormat = new Intl.DateTimeFormat(LOCALE, {
  dateStyle: 'medium',
  timeZone: 'UTC',
});
const instantFormat = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });

/**
 * A `YYYY-MM-DD` calendar date (expiry, opened). It parses as UTC midnight, so it
 * is formatted in UTC too: in the user's own zone it could land on the day before.
 */
export function formatCalendarDate(isoDate: string): string {
  const date = new Date(isoDate);
  return Number.isNaN(date.getTime()) ? isoDate : calendarDateFormat.format(date);
}

/** An ISO-8601 instant (created, updated), in the user's own time zone. */
export function formatInstant(isoInstant: string): string {
  const date = new Date(isoInstant);
  return Number.isNaN(date.getTime()) ? isoInstant : instantFormat.format(date);
}

type PluralForms = { other: string } & Partial<Record<Intl.LDMLPluralRule, string>>;

/**
 * Picks the plural form `Intl.PluralRules` selects for `count`, and replaces
 * `#` in it with the formatted count. Languages with more forms than English
 * (`few`, `many`) add them without changing any call site.
 */
export function plural(count: number, forms: PluralForms): string {
  const form = forms[pluralRules.select(count)] ?? forms.other;
  return form.replaceAll('#', formatNumber(count));
}

const DIACRITICS = /\p{Diacritic}/gu;

/** Case- and accent-insensitive form of `text`, for matching what people type. */
export function normalizeForSearch(text: string): string {
  return text.normalize('NFD').replace(DIACRITICS, '').toLocaleLowerCase(LOCALE).trim();
}
