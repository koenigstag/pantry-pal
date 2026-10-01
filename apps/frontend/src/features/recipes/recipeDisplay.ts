import type { RecipeQuantity, RecipeSectionContent } from '@pantry-pal/shared';

import { LOCALE } from '../../i18n/locale';

/** `500 г`, `1/2 cup`, `по вкусу`: an amount and its unit as the recipe wrote them. */
export function quantityText(quantity: RecipeQuantity | null): string {
  if (quantity === null) return '';
  return quantity.unit === null ? quantity.text : `${quantity.text} ${quantity.unit}`;
}

/**
 * A step that only names ingredients, separated by commas: how an imported
 * recipe lists them, since sites keep the list apart from the steps (see the
 * backend's `page-to-cooklang.ts`). The ingredient list shows them already.
 */
export function isIngredientListStep(content: RecipeSectionContent): boolean {
  return (
    content.type === 'step' &&
    content.items.some((item) => item.type === 'ingredient') &&
    content.items.every(
      (item) =>
        item.type === 'ingredient' || (item.type === 'text' && /^[\s,;.]*$/.test(item.value)),
    )
  );
}

let languageNames: Intl.DisplayNames | null | undefined;

/** A language's name in the page's language, `ru` → `русский`; the tag itself where the browser has no name. */
export function languageName(tag: string): string {
  if (languageNames === undefined) {
    try {
      languageNames = new Intl.DisplayNames([LOCALE], { type: 'language' });
    } catch {
      languageNames = null;
    }
  }
  try {
    return languageNames?.of(tag) ?? tag;
  } catch {
    return tag;
  }
}

/** Whether two tags are one language: `ru` and `ru-RU` are. */
export function sameLanguage(a: string, b: string): boolean {
  return a.split('-')[0]?.toLowerCase() === b.split('-')[0]?.toLowerCase();
}
