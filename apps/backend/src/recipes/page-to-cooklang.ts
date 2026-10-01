import {
  cooklangIngredient,
  cooklangMetadata,
  cooklangSection,
  cooklangText,
  type CooklangIngredient,
} from './cooklang';
import type { PageRecipe } from './page-recipe';

/**
 * A page's recipe as Cooklang text.
 *
 * Sites list ingredients apart from the steps, while Cooklang writes them into
 * the steps. Moving each into the sentence that uses it would mean matching
 * `картофель` in the list against `картофеля` in a step, which words in other
 * cases and languages defeat. So the ingredients become a first step of their
 * own, holding nothing else, and the steps follow as written. A reader shows
 * such a step as the ingredient list it is; editing the recipe can move them
 * into the steps later.
 */
export function pageRecipeToCooklang(
  recipe: PageRecipe,
  sourceUrl: string,
  locale: string,
): string {
  const blocks = [
    cooklangMetadata({
      title: recipe.title,
      description: recipe.description,
      servings: recipe.servings,
      time: recipe.time,
      source: sourceUrl,
      image: recipe.imageUrl,
      locale,
    }),
  ];

  if (recipe.ingredients.length > 0) {
    blocks.push(
      recipe.ingredients.map((line) => cooklangIngredient(parseIngredientLine(line))).join(', '),
    );
  }

  for (const section of recipe.sections) {
    if (section.name !== null) blocks.push(cooklangSection(section.name));
    for (const step of section.steps) blocks.push(cooklangText(step));
  }

  return `${blocks.join('\n\n')}\n`;
}

const MAX_NAME_LENGTH = 100;

/** Units sites write, longest first within a language so `ст. л.` wins over `ст`. */
const UNITS = [
  // Russian and Ukrainian
  'ст\\.\\s?л\\.?',
  'ч\\.\\s?л\\.?',
  'ст\\.\\s?ложк[аиу]',
  'ч\\.\\s?ложк[аиу]',
  'столов(?:ая|ые|ых) ложк(?:а|и|у)',
  'столовых ложек',
  'чайн(?:ая|ые|ых) ложк(?:а|и|у)',
  'чайных ложек',
  'стакан(?:а|ов)?',
  'склянк(?:а|и)',
  'грамм(?:а|ов)?',
  'гр\\.?',
  'г\\.?',
  'кг',
  'мг',
  'мл',
  'л\\.?',
  'литр(?:а|ов)?',
  'шт\\.?',
  'штук(?:и|а)?',
  'зубчик(?:а|ов)?',
  'зубч(?:ик|ика)',
  'пуч(?:ок|ка|ков)',
  'щепотк(?:а|и|у)',
  'дрібк(?:а|и)',
  'банк(?:а|и)',
  'упаковк(?:а|и)',
  'пачк(?:а|и)',
  'головк(?:а|и)',
  'ломтик(?:а|ов)?',
  'кусоч(?:ек|ка|ков)',
  'веточ(?:ка|ки|ек)',
  // English
  'tablespoons?',
  'teaspoons?',
  'tbsp\\.?',
  'tbs\\.?',
  'tsp\\.?',
  'cups?',
  'grams?',
  'kilograms?',
  'g',
  'kg',
  'mg',
  'ml',
  'millilit(?:er|re)s?',
  'lit(?:er|re)s?',
  'l',
  'oz\\.?',
  'ounces?',
  'lbs?\\.?',
  'pounds?',
  'pinch(?:es)?',
  'cloves?',
  'cans?',
  'slices?',
  'pcs\\.?',
  'pieces?',
  'bunch(?:es)?',
  'sticks?',
  'pints?',
  'quarts?',
  'dash(?:es)?',
  // German, French, Spanish
  'EL',
  'TL',
  'Prisen?',
  'Stück',
  'Bund',
  'Dosen?',
  'Becher',
  'Zehen?',
  'Pck\\.?',
  'c\\.\\s?à\\s?(?:soupe|café|s\\.|c\\.)',
  'cuill(?:ères?|\\.)\\s?à\\s?(?:soupe|café)',
  'pincées?',
  'gousses?',
  'sachets?',
  'cucharadas?',
  'cucharaditas?',
  'tazas?',
  'pizcas?',
  'dientes?',
];

const UNIT = `(?:${UNITS.join('|')})(?=[\\s,.)]|$)`;
const UNICODE_FRACTIONS: Readonly<Record<string, string>> = {
  '½': '1/2',
  '⅓': '1/3',
  '⅔': '2/3',
  '¼': '1/4',
  '¾': '3/4',
  '⅛': '1/8',
  '⅜': '3/8',
  '⅝': '5/8',
  '⅞': '7/8',
};
const NUMBER =
  '(?:\\d+\\s+\\d+\\/\\d+|\\d+\\s*[½⅓⅔¼¾⅛⅜⅝⅞]|\\d+(?:[.,]\\d+)?(?:\\s*\\/\\s*\\d+)?|[½⅓⅔¼¾⅛⅜⅝⅞])';
const AMOUNT = `${NUMBER}(?:\\s*[-–—]\\s*${NUMBER})?`;

const LEADING = new RegExp(`^(${AMOUNT})\\s*(${UNIT})?\\s*(.+)$`, 'iu');
const TRAILING = new RegExp(`^(.+?)\\s*(?:[—–:]|\\s-)?\\s+(${AMOUNT})\\s*(${UNIT})?\\.?$`, 'iu');
/** `Соль — по вкусу`: words after a dash or colon, for an amount without a number. */
const WORDS_AFTER = /^(.+?)\s*(?:\s[—–-]|[:—–])\s*([^\d,]{1,30})$/u;

/**
 * `500 г картофеля`, `Картофель — 500 г`, `2 cups of flour, sifted` or `Salt to
 * taste` as a name, an amount, a unit and a note. What does not fit a pattern
 * stays whole, as the name.
 */
export function parseIngredientLine(line: string): CooklangIngredient {
  let rest = line.replace(/\s+/g, ' ').trim();
  let note: string | null = null;

  // `Молоко (цельное) — 250 мл`: words in brackets anywhere are a note.
  const notes: string[] = [];
  const unbracketed = rest.replace(/\s*\(([^()]*)\)/g, (_, inner: string) => {
    if (inner.trim() !== '') notes.push(inner.trim());
    return '';
  });
  if (unbracketed.trim() !== '') {
    rest = unbracketed.replace(/\s+/g, ' ').trim();
    note = notes.length === 0 ? null : notes.join(', ');
  }

  const leading = LEADING.exec(rest);
  if (leading !== null) {
    const [, amount = '', unit, name = ''] = leading;
    const [ingredientName, comma] = splitNote(name.replace(/^of\s+/i, ''));
    return {
      name: limit(ingredientName),
      amount: normalizeAmount(amount),
      unit: unit?.trim() ?? null,
      note: joinNotes(comma, note),
    };
  }

  const trailing = TRAILING.exec(rest);
  if (trailing !== null) {
    const [, name = '', amount = '', unit] = trailing;
    const [ingredientName, comma] = splitNote(name);
    return {
      name: limit(ingredientName),
      amount: normalizeAmount(amount),
      unit: unit?.trim() ?? null,
      note: joinNotes(comma, note),
    };
  }

  const words = WORDS_AFTER.exec(rest);
  if (words !== null) {
    const [, name = '', amount = ''] = words;
    return { name: limit(name), amount: amount.trim(), unit: null, note };
  }

  const [name, comma] = splitNote(rest);
  // `Мука (6 столовых ложек)`: the amount was in the brackets.
  const amountInNote =
    note === null ? null : new RegExp(`^(${AMOUNT})\\s*(${UNIT})?$`, 'iu').exec(note);
  if (amountInNote !== null) {
    const [, amount = '', unit] = amountInNote;
    return {
      name: limit(name),
      amount: normalizeAmount(amount),
      unit: unit?.trim() ?? null,
      note: comma,
    };
  }
  return { name: limit(name), amount: null, unit: null, note: joinNotes(comma, note) };
}

/** `flour, sifted` → `flour` and `sifted`. A decimal comma (`3,2%`) is not a split. */
function splitNote(text: string): [string, string | null] {
  const comma = text.search(/,(?!\d)/);
  if (comma <= 0) return [text.trim(), null];
  return [text.slice(0, comma).trim(), text.slice(comma + 1).trim() || null];
}

function joinNotes(...notes: Array<string | null>): string | null {
  const present = notes.filter((note): note is string => note !== null && note !== '');
  return present.length === 0 ? null : present.join(', ');
}

/** What Cooklang reads as a number: `1.5` not `1,5`, `1/2` not `½`, `2-3` not `2–3`. */
function normalizeAmount(amount: string): string {
  return amount
    .replace(
      /(\d)\s*([½⅓⅔¼¾⅛⅜⅝⅞])/gu,
      (_, whole: string, fraction: string) => `${whole} ${UNICODE_FRACTIONS[fraction] ?? ''}`,
    )
    .replace(/[½⅓⅔¼¾⅛⅜⅝⅞]/gu, (fraction) => UNICODE_FRACTIONS[fraction] ?? fraction)
    .replace(/(\d),(\d)/g, '$1.$2')
    .replace(/\s*\/\s*/g, '/')
    .replace(/\s*[–—-]\s*/g, '-')
    .trim();
}

function limit(name: string): string {
  return name.length <= MAX_NAME_LENGTH ? name : name.slice(0, MAX_NAME_LENGTH).trim();
}
