import { DEFAULT_SHOPPING_LIST_NAME, DEFAULT_SHOPPING_LIST_TRANSLATIONS } from '../constants';
import { pickTranslation } from './locale';

/** What a new household's first shopping list is called, for a creator speaking `locale`. */
export function defaultShoppingListName(locale: string): string {
  return pickTranslation(DEFAULT_SHOPPING_LIST_TRANSLATIONS, locale, DEFAULT_SHOPPING_LIST_NAME);
}
