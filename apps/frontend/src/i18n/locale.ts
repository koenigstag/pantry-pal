import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@pantry-pal/shared';

/**
 * The browser's copy of the account's language. The account (`users.locale`)
 * is the truth; the copy lets a reload start in the right language before
 * `GET /me` has answered.
 */
const STORAGE_KEY = 'pantry-pal:locale';

/** Each language by its own name, so a user can find theirs whatever is showing. */
export const LANGUAGE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  'en-GB': 'English',
  'uk-UA': 'Українська',
  'ru-RU': 'Русский',
};

/**
 * The supported locale for a BCP 47 tag: the tag itself, else the first with the
 * same language (`uk` → `uk-UA`), else `null`.
 */
export function supportedLocale(tag: string | null | undefined): SupportedLocale | null {
  if (tag === null || tag === undefined || tag === '') return null;

  const wanted = tag.toLowerCase();
  const language = wanted.split('-')[0];
  return (
    SUPPORTED_LOCALES.find((locale) => locale.toLowerCase() === wanted) ??
    SUPPORTED_LOCALES.find((locale) => locale.toLowerCase().split('-')[0] === language) ??
    null
  );
}

function readCopy(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

/** Whether the copy stuck: storage can be blocked, and a reload would then not change a thing. */
function writeCopy(locale: SupportedLocale): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
    return localStorage.getItem(STORAGE_KEY) === locale;
  } catch {
    return false;
  }
}

/**
 * The language of this page load. The message catalog and every formatter read
 * it once, at start-up, so a different language means a reload.
 */
export const LOCALE: SupportedLocale = supportedLocale(readCopy()) ?? DEFAULT_LOCALE;

/**
 * Makes `tag` the page's language: remembers it and reloads, unless it already
 * is. An unsupported tag means the default language.
 *
 * Nothing reloads while the choice cannot be remembered, since the reload would
 * start in the old language and ask for another one, forever.
 */
export function switchLocale(tag: string): void {
  const locale = supportedLocale(tag) ?? DEFAULT_LOCALE;
  if (locale === LOCALE) return;
  if (writeCopy(locale)) window.location.reload();
}
