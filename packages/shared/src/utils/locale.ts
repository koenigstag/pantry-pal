import { SUPPORTED_LOCALES } from '../constants';

/**
 * Where to look for text in `tag`'s language, most specific first: the tag
 * itself, then its language alone. `fr-CA` gives `['fr-CA', 'fr']`.
 */
export function localeLookupOrder(tag: string): string[] {
  const language = tag.split('-')[0] ?? tag;
  return language === tag ? [tag] : [tag, language];
}

/**
 * The tags a translation may be stored under: each supported locale and its
 * language. Most translations belong to a language (`fr`), serving every tag
 * of it; a regional one (`fr-CA`) exists only where its wording differs.
 */
export const TRANSLATION_LOCALES: readonly string[] = [
  ...new Set(SUPPORTED_LOCALES.flatMap((tag) => localeLookupOrder(tag).toReversed())),
];

/**
 * The languages of `SUPPORTED_LOCALES`, without regions: what reference data
 * named by language rather than locale, such as ingredients, is stored in.
 */
export const SUPPORTED_LANGUAGES: readonly string[] = [
  ...new Set(SUPPORTED_LOCALES.map((tag) => localeLookupOrder(tag).at(-1) ?? tag)),
];

/** The text for `tag`: its own translation, else its language's, else `base`. */
export function pickTranslation(
  translations: Readonly<Record<string, string>>,
  tag: string,
  base: string,
): string {
  for (const key of localeLookupOrder(tag)) {
    const text = translations[key];
    if (text !== undefined) return text;
  }
  return base;
}
