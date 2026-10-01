import type { AnyNode, Element } from 'domhandler';
import { DomUtils, parseDocument } from 'htmlparser2';

/**
 * Finding a recipe in a web page: the schema.org `Recipe` most recipe sites
 * mark their pages up with, so that search engines show them — as JSON-LD, or
 * as microdata (`itemprop` attributes) on older sites such as Povarenok. It
 * names the title, ingredients, steps, yield and times, which is all the
 * importer needs, with no model guessing at the page's prose.
 */

/** A page's recipe, as text: nothing here is parsed further. */
export interface PageRecipe {
  title: string;
  description: string | null;
  /** One line each, as the site wrote them: `500 g potatoes`. */
  ingredients: string[];
  /** Steps in order, grouped where the site grouped them (`HowToSection`). */
  sections: Array<{ name: string | null; steps: string[] }>;
  servings: string | null;
  /** Total time, or preparation plus cooking, as `1 h 30 min` in the recipe's language. */
  time: string | null;
  imageUrl: string | null;
  /** `inLanguage`, else the page's `<html lang>`. */
  language: string | null;
}

/** Recipe pages rarely hold more than a few hundred steps; this bounds hostile ones. */
const MAX_LIST_LENGTH = 300;

/** The page's schema.org `Recipe`: from its JSON-LD, else from its microdata, else `null`. */
export function findPageRecipe(html: string): PageRecipe | null {
  const language = pageLanguage(html);
  for (const node of jsonLdNodes(html)) {
    const recipe = findRecipeNode(node, 0);
    if (recipe !== null) return toPageRecipe(recipe, language);
  }
  const microdata = microdataRecipe(html);
  return microdata === null ? null : toPageRecipe(microdata, language);
}

type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
type JsonObject = { [key: string]: Json };

const isObject = (value: Json | undefined): value is JsonObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function* jsonLdNodes(html: string): Generator<Json> {
  const scripts = html.matchAll(
    /<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script\s*>/gi,
  );
  for (const [, body] of scripts) {
    const json = (body ?? '').trim().replace(/^<!--|-->$/g, '');
    try {
      yield JSON.parse(json) as Json;
    } catch {
      // Sites do ship broken JSON-LD; another block may still hold the recipe.
    }
  }
}

/** Depth-first through arrays, `@graph` and nested objects: sites wrap the recipe in all of them. */
function findRecipeNode(node: Json | undefined, depth: number): JsonObject | null {
  if (depth > 8 || node === undefined || node === null) return null;
  if (Array.isArray(node)) {
    for (const entry of node) {
      const found = findRecipeNode(entry, depth + 1);
      if (found !== null) return found;
    }
    return null;
  }
  if (!isObject(node)) return null;
  if (hasType(node, 'Recipe')) return node;
  for (const key of ['@graph', 'mainEntity', 'mainEntityOfPage', 'itemListElement', 'item']) {
    const found = findRecipeNode(node[key], depth + 1);
    if (found !== null) return found;
  }
  return null;
}

function hasType(node: JsonObject, type: string): boolean {
  const value = node['@type'];
  const types = Array.isArray(value) ? value : [value];
  return types.some((entry) => typeof entry === 'string' && entry.replace(/^.*[/:]/, '') === type);
}

function toPageRecipe(node: JsonObject, htmlLanguage: string | null): PageRecipe | null {
  const title = text(node['name']) ?? text(node['headline']);
  if (title === null) return null;

  const ingredients = list(node['recipeIngredient'] ?? node['ingredients'])
    .map(text)
    .filter((line): line is string => line !== null)
    .slice(0, MAX_LIST_LENGTH);
  const language = languageTag(text(node['inLanguage'])) ?? htmlLanguage;

  return {
    title,
    description: text(node['description']),
    ingredients,
    sections: instructions(node['recipeInstructions']),
    servings: servings(node['recipeYield']),
    time:
      duration(node['totalTime'], language) ??
      sumDurations(language, node['prepTime'], node['cookTime']),
    imageUrl: image(node['image']),
    language,
  };
}

/** `HowToStep`s, `HowToSection`s of them, plain strings, or one block of text. */
function instructions(value: Json | undefined): PageRecipe['sections'] {
  const sections: PageRecipe['sections'] = [];
  let loose: string[] = [];
  let total = 0;

  const add = (target: string[], step: string | null): void => {
    if (step === null || total >= MAX_LIST_LENGTH) return;
    target.push(step);
    total += 1;
  };

  for (const entry of list(value)) {
    if (typeof entry === 'string') {
      // One block of text: a step per line.
      for (const line of htmlText(entry).split(/\n+/)) add(loose, cleanStep(line));
    } else if (isObject(entry) && hasType(entry, 'HowToSection')) {
      if (loose.length > 0) sections.push({ name: null, steps: loose });
      loose = [];
      const steps: string[] = [];
      for (const step of list(entry['itemListElement'])) add(steps, stepText(step));
      if (steps.length > 0) sections.push({ name: text(entry['name']), steps });
    } else {
      add(loose, stepText(entry));
    }
  }
  if (loose.length > 0) sections.push({ name: null, steps: loose });
  return sections;
}

function stepText(value: Json): string | null {
  if (typeof value === 'string') return cleanStep(htmlText(value));
  if (!isObject(value)) return null;
  return cleanStep(text(value['text']) ?? text(value['name']) ?? text(value['description']));
}

/** Without a leading `1.` or `Step 1:`: steps are numbered by their order. */
function cleanStep(step: string | null): string | null {
  if (step === null) return null;
  const cleaned = step
    .replace(/^\s*(?:(?:step|шаг|крок|schritt|étape|paso)\s*)?\d+\s*[.):-]?\s+/i, '')
    .trim();
  return cleaned === '' ? null : cleaned;
}

function servings(value: Json | undefined): string | null {
  const values = list(value)
    .map(text)
    .filter((entry): entry is string => entry !== null);
  // Sites often give `["4", "4 servings"]`: the wordier one says more.
  return values.toSorted((a, b) => b.length - a.length)[0] ?? null;
}

function image(value: Json | undefined): string | null {
  for (const entry of list(value)) {
    const url = typeof entry === 'string' ? entry : isObject(entry) ? text(entry['url']) : null;
    if (url !== null && /^https?:\/\//i.test(url)) return url;
  }
  return null;
}

/** ISO 8601 `PT1H30M` as `1 h 30 min`; anything else as written. */
function duration(value: Json | undefined, language: string | null): string | null {
  const minutes = durationMinutes(value);
  if (minutes === null) {
    const written = text(value);
    return written !== null && !/^P/i.test(written) ? written : null;
  }
  return minutesText(minutes, language);
}

function sumDurations(language: string | null, ...values: Array<Json | undefined>): string | null {
  const minutes = values.map(durationMinutes).filter((value): value is number => value !== null);
  return minutes.length === 0
    ? null
    : minutesText(
        minutes.reduce((a, b) => a + b, 0),
        language,
      );
}

function durationMinutes(value: Json | undefined): number | null {
  const written = text(value);
  if (written === null) return null;
  const match =
    /^P(?:(\d+(?:\.\d+)?)D)?(?:T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?)?$/i.exec(
      written,
    );
  if (match === null) return null;
  const [, days, hours, minutes, seconds] = match.map((part) => Number(part ?? 0));
  const total = (days ?? 0) * 1440 + (hours ?? 0) * 60 + (minutes ?? 0) + (seconds ?? 0) / 60;
  return total > 0 ? Math.round(total) : null;
}

/** Hours and minutes as each language abbreviates them; English for any other. */
const TIME_UNITS: Readonly<Record<string, { hours: string; minutes: string }>> = {
  ru: { hours: 'ч', minutes: 'мин' },
  uk: { hours: 'год', minutes: 'хв' },
  de: { hours: 'Std.', minutes: 'Min.' },
  fr: { hours: 'h', minutes: 'min' },
  es: { hours: 'h', minutes: 'min' },
};

/** `1 h 30 min`, in the recipe's language: the text is shown as written, never parsed again. */
function minutesText(minutes: number, language: string | null): string {
  const units = TIME_UNITS[language?.split('-')[0] ?? ''] ?? { hours: 'h', minutes: 'min' };
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} ${units.minutes}`;
  return rest === 0
    ? `${hours} ${units.hours}`
    : `${hours} ${units.hours} ${rest} ${units.minutes}`;
}

// ── Microdata ───────────────────────────────────────────────────────────────

/**
 * The first `itemtype=".../Recipe"` element's properties, in the shape JSON-LD
 * gives them, so one reader serves both. A property's value is what microdata
 * says it is — `content` on `<meta>`, `src` on `<img>`, `datetime` on `<time>`
 * — else the element's text. Properties of an item nested inside the recipe
 * (a `HowToStep`, the author) are its own, not the recipe's.
 */
function microdataRecipe(html: string): JsonObject | null {
  const document = parseDocument(html);
  const root = DomUtils.findOne(
    (element) =>
      element.attribs['itemscope'] !== undefined &&
      /(?:^|\/)Recipe$/.test((element.attribs['itemtype'] ?? '').trim()),
    document.children,
  );
  if (root === null) return null;

  const props = new Map<string, Element[]>();
  const collect = (nodes: readonly AnyNode[]): void => {
    for (const node of nodes) {
      if (node.type !== 'tag' && node.type !== 'script' && node.type !== 'style') continue;
      const element = node as Element;
      for (const name of (element.attribs['itemprop'] ?? '').split(/\s+/).filter(Boolean)) {
        props.set(name, [...(props.get(name) ?? []), element]);
      }
      if (element.attribs['itemscope'] === undefined) collect(element.children);
    }
  };
  collect(root.children);

  const values = (name: string): string[] =>
    (props.get(name) ?? []).map(microdataValue).filter((value) => value !== '');

  const recipe: JsonObject = { '@type': 'Recipe' };
  for (const name of [
    'name',
    'description',
    'recipeYield',
    'totalTime',
    'prepTime',
    'cookTime',
    'inLanguage',
  ]) {
    const [value] = values(name);
    if (value !== undefined) recipe[name] = value;
  }
  recipe['recipeIngredient'] = [...values('recipeIngredient'), ...values('ingredients')];
  recipe['image'] = values('image');
  recipe['recipeInstructions'] = (props.get('recipeInstructions') ?? []).flatMap(instructionTexts);
  return recipe;
}

function microdataValue(element: Element): string {
  const { attribs, name } = element;
  if (attribs['content'] !== undefined) return attribs['content'];
  if (['img', 'audio', 'video', 'source', 'embed', 'iframe'].includes(name))
    return attribs['src'] ?? '';
  if (['a', 'area', 'link'].includes(name)) return attribs['href'] ?? '';
  if (name === 'time' && attribs['datetime'] !== undefined) return attribs['datetime'];
  if (['data', 'meter'].includes(name) && attribs['value'] !== undefined) return attribs['value'];
  return elementText(element);
}

/**
 * A `recipeInstructions` element as steps: a step per list item or paragraph
 * when it holds several — sites put the whole method in one `<ol>` — else its
 * text, a step per line.
 */
function instructionTexts(element: Element): string[] {
  if (element.attribs['itemscope'] !== undefined) {
    const textProp = DomUtils.findOne(
      (child) => child.attribs['itemprop'] === 'text',
      element.children,
    );
    return [elementText(textProp ?? element)];
  }
  const blocks = DomUtils.findAll((child) => child.name === 'li', element.children);
  const items =
    blocks.length > 1 ? blocks : DomUtils.findAll((child) => child.name === 'p', element.children);
  if (items.length > 1) return items.map(elementText).filter((step) => step !== '');
  return [elementText(element)];
}

/** Visible text, with a line break wherever a block or `<br>` ends a line. Scripts and styles are left out. */
function elementText(node: AnyNode): string {
  const parts: string[] = [];
  const walk = (current: AnyNode): void => {
    if (current.type === 'text') {
      parts.push((current as unknown as { data: string }).data);
      return;
    }
    if (current.type !== 'tag') return;
    const element = current as Element;
    if (element.name === 'br') parts.push('\n');
    for (const child of element.children) walk(child);
    if (/^(?:p|div|li|h[1-6]|tr|ul|ol)$/.test(element.name)) parts.push('\n');
  };
  walk(node);
  return parts
    .join('')
    .replace(/[ \t\r\u00A0]+/g, ' ')
    .replace(/ *\n[\n ]*/g, '\n')
    .trim();
}

function pageLanguage(html: string): string | null {
  return languageTag(/<html\b[^>]*\blang\s*=\s*["']?([\w-]+)/i.exec(html)?.[1] ?? null);
}

/** `ru`, `ru-RU`, `RU_ru` → a tag of the form the database accepts, or `null`. */
export function languageTag(value: string | null): string | null {
  if (value === null) return null;
  const match = /^([a-z]{2,3})(?:[-_]([a-z]{2}))?$/i.exec(value.trim());
  if (match === null) return null;
  const language = (match[1] ?? '').toLowerCase();
  return match[2] === undefined ? language : `${language}-${match[2].toUpperCase()}`;
}

function list(value: Json | undefined): Json[] {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/** A value as plain text: entities decoded, tags dropped, spaces collapsed. */
function text(value: Json | undefined): string | null {
  if (typeof value === 'number') return String(value);
  if (typeof value !== 'string') return null;
  const cleaned = htmlText(value).replace(/\s+/g, ' ').trim();
  return cleaned === '' ? null : cleaned;
}

/** Tags become line breaks where they break lines, and vanish elsewhere. */
function htmlText(value: string): string {
  return decodeEntities(
    value.replace(/<\s*(?:br|\/p|\/li|\/div)\b[^>]*>/gi, '\n').replace(/<[^>]*>/g, ''),
  )
    .replace(/[ \t ]+/g, ' ')
    .trim();
}

const NAMED_ENTITIES: Readonly<Record<string, string>> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  ndash: '–',
  mdash: '—',
  laquo: '«',
  raquo: '»',
  bdquo: '„',
  ldquo: '“',
  rdquo: '”',
  lsquo: '‘',
  rsquo: '’',
  hellip: '…',
  deg: '°',
  frac12: '½',
  frac14: '¼',
  frac34: '¾',
  times: '×',
};

function decodeEntities(value: string): string {
  return value.replace(/&(#x[\da-f]+|#\d+|[a-z]\w*);/gi, (entity, body: string) => {
    if (body.startsWith('#')) {
      const code =
        body[1] === 'x' || body[1] === 'X'
          ? parseInt(body.slice(2), 16)
          : parseInt(body.slice(1), 10);
      return Number.isInteger(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}
