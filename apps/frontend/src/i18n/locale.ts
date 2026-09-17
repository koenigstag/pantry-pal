import { DEFAULT_LOCALE, SUPPORTED_LOCALES, type SupportedLocale } from '@pantry-pal/shared';

/**
 * The browser's copy of the language: the signed-in account's, or one picked on
 * the signed-out pages. Once someone signs in, the account (`users.locale`) is
 * the truth; the copy lets a reload start in the right language before `GET /me`
 * has answered.
 */
const STORAGE_KEY = 'pantry-pal:locale';

/** Each language by its own name, so a user can find theirs whatever is showing. */
export const LANGUAGE_NAMES: Readonly<Record<SupportedLocale, string>> = {
  'en-GB': 'English',
  'uk-UA': 'Українська',
  'ru-RU': 'Русский',
  'de-DE': 'Deutsch',
  'fr-FR': 'Français (France)',
  'fr-CA': 'Français (Canada)',
  'es-ES': 'Español',
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

/** The first of `tags`, in the browser's order of preference, that the UI speaks. */
export function preferredLocale(tags: readonly string[]): SupportedLocale | null {
  for (const tag of tags) {
    const locale = supportedLocale(tag);
    if (locale !== null) return locale;
  }
  return null;
}

/** What the browser asks for, most wanted first. */
function browserLanguages(): readonly string[] {
  if (typeof navigator === 'undefined') return [];
  return navigator.languages.length > 0 ? navigator.languages : [navigator.language];
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
 * The language of this page load: the stored copy, else the browser's preferred
 * languages (a first visit), else the default. The message catalog and every
 * formatter read it once, at start-up, so a different language means a reload.
 */
export const LOCALE: SupportedLocale =
  supportedLocale(readCopy()) ?? preferredLocale(browserLanguages()) ?? DEFAULT_LOCALE;

/**
 * Makes `tag` the page's language: remembers it, and reloads unless the page
 * already shows it. An unsupported tag means the default language.
 *
 * It is remembered even when the page shows it already: without a copy, that
 * language was only the browser's preference, which can change before the next
 * load.
 *
 * Nothing reloads while the choice cannot be remembered, since the reload would
 * start in the old language and ask for another one, forever.
 */
export function switchLocale(tag: string): void {
  const locale = supportedLocale(tag) ?? DEFAULT_LOCALE;
  if (writeCopy(locale) && locale !== LOCALE) window.location.reload();
}
