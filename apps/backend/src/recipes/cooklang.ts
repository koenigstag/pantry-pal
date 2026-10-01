import {
  cookware_should_be_listed,
  ingredient_should_be_listed,
  Parser,
  quantity_display,
  type Quantity,
  type Value,
} from '@cooklang/cooklang';
import {
  RECIPE_DOCUMENT_VERSION,
  type RecipeDocument,
  type RecipeQuantity,
  type RecipeSection,
  type RecipeStepItem,
} from '@pantry-pal/shared';

/**
 * Cooklang (https://cooklang.org) in and out: the official parser, cooklang-rs
 * built to WASM, turns text into the `RecipeDocument` clients read; the
 * builders below write text it reads back as written.
 *
 * `load_units` is off: the parser's unit table is English, and would report
 * `500%г` as an unknown unit. Units stay as written, in any language.
 *
 * The document is ours, not the parser's output: a library upgrade that changes
 * its JSON changes this file, never the rows already stored.
 */

/** The parser is a WASM object; one serves every call, as parsing is synchronous. */
let parser: Parser | undefined;

function sharedParser(): Parser {
  if (parser === undefined) {
    parser = new Parser();
    parser.load_units = false;
  }
  return parser;
}

/** Why a text cannot be a recipe: it has no title. */
export class CooklangTitleMissingError extends Error {
  constructor() {
    super('A recipe needs a title: add `title:` to its metadata');
  }
}

/** Parses Cooklang text into the document clients show. Never throws for odd text: the parser recovers. */
export function parseCooklang(source: string): RecipeDocument {
  const parsed = sharedParser().parse(source);
  const raw = rawMetadata(parsed.recipe.raw_metadata);
  const { recipe } = parsed;

  const title = metadataText(raw['title']);
  if (title === null) throw new CooklangTitleMissingError();

  return {
    version: RECIPE_DOCUMENT_VERSION,
    title,
    description: metadataText(raw['description']),
    servings: metadataText(raw['servings']),
    time: metadataText(raw['time'] ?? raw['duration']),
    tags: metadataTags(raw['tags']),
    ingredients: recipe.ingredients.map((ingredient) => ({
      name: ingredient.name,
      quantity: toQuantity(ingredient.quantity),
      note: ingredient.note,
      listed: ingredient_should_be_listed(ingredient),
    })),
    cookware: recipe.cookware.map((item) => ({
      name: item.name,
      quantity: toQuantity(item.quantity),
      note: item.note,
      listed: cookware_should_be_listed(item),
    })),
    timers: recipe.timers.map((timer) => ({
      name: timer.name,
      quantity: toQuantity(timer.quantity),
    })),
    sections: recipe.sections.map((section): RecipeSection => ({
      name: section.name,
      content: section.content.map((content) =>
        content.type === 'text'
          ? { type: 'note', text: content.value }
          : {
              type: 'step',
              number: content.value.number,
              items: mergeText(
                content.value.items.map((item): RecipeStepItem =>
                  item.type === 'text'
                    ? { type: 'text', value: item.value }
                    : item.type === 'inlineQuantity'
                      ? {
                          type: 'text',
                          value: inlineQuantityText(recipe.inline_quantities, item.index),
                        }
                      : { type: item.type, index: item.index },
                ),
              ),
            },
      ),
    })),
  };
}

// ── Reading the parser's output ──────────────────────────────────────────────

function rawMetadata(value: unknown): Record<string, unknown> {
  // `raw_metadata` serialises as `{ map: {...} }`; the typings call it a plain record.
  if (typeof value !== 'object' || value === null) return {};
  const map = (value as { map?: unknown }).map;
  return typeof map === 'object' && map !== null ? (map as Record<string, unknown>) : {};
}

/** A metadata value as text: YAML may have read `4` as a number. */
function metadataText(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  if (typeof value !== 'string') return null;
  const text = value.trim();
  return text === '' ? null : text;
}

/** `tags: [a, b]` or `tags: a, b`. */
function metadataTags(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? value.split(',') : [];
  return values.map((tag) => metadataText(tag)).filter((tag): tag is string => tag !== null);
}

function toQuantity(quantity: Quantity | null): RecipeQuantity | null {
  if (quantity === null) return null;
  const unit = quantity.unit === null || quantity.unit.trim() === '' ? null : quantity.unit;
  const display = quantity_display(quantity);
  // `quantity_display` appends the unit; the document keeps the two apart.
  const text =
    unit !== null && display.endsWith(unit) ? display.slice(0, -unit.length).trim() : display;
  return { text, value: numericValue(quantity.value), unit };
}

/** The number in a value — a range's start — or `null` for words. */
function numericValue(value: Value): number | null {
  switch (value.type) {
    case 'number':
      return numberOf(value.value);
    case 'range':
      return numberOf(value.value.start);
    default:
      return null;
  }
}

/** The typings leave numbers opaque; the JSON is `{ type: 'regular' | 'fraction', value }`. */
function numberOf(number: unknown): number | null {
  if (typeof number !== 'object' || number === null) return null;
  const { type, value } = number as { type?: unknown; value?: unknown };
  if (type === 'regular' && typeof value === 'number') return value;
  if (type === 'fraction' && typeof value === 'object' && value !== null) {
    const { whole, num, den } = value as { whole?: unknown; num?: unknown; den?: unknown };
    if (
      typeof whole === 'number' &&
      typeof num === 'number' &&
      typeof den === 'number' &&
      den !== 0
    ) {
      return whole + num / den;
    }
  }
  return null;
}

function inlineQuantityText(quantities: readonly Quantity[], index: number): string {
  const quantity = quantities[index];
  return quantity === undefined ? '' : quantity_display(quantity);
}

/** Joins neighbouring text items, which the parser splits where it skipped something. */
function mergeText(items: RecipeStepItem[]): RecipeStepItem[] {
  const merged: RecipeStepItem[] = [];
  for (const item of items) {
    const last = merged.at(-1);
    if (item.type === 'text' && last?.type === 'text') {
      merged[merged.length - 1] = { type: 'text', value: last.value + item.value };
    } else {
      merged.push(item);
    }
  }
  return merged;
}

// ── Writing Cooklang ────────────────────────────────────────────────────────

/** What a recipe's metadata block holds. Absent values are left out. */
export interface CooklangMetadata {
  title: string;
  description?: string | null;
  servings?: string | null;
  time?: string | null;
  source?: string | null;
  image?: string | null;
  locale?: string | null;
}

/**
 * The YAML front matter. Every value is written as a JSON string, which YAML
 * reads as a double-quoted scalar: no value can break out of its line.
 */
export function cooklangMetadata(metadata: CooklangMetadata): string {
  const lines = Object.entries(metadata)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string' && entry[1] !== '')
    .map(([key, value]) => `${key}: ${JSON.stringify(oneLine(value))}`);
  return `---\n${lines.join('\n')}\n---`;
}

/**
 * Text that reads back as itself. `@`, `#` and `~` would start a component,
 * `--` and `[-` a comment, and `=` or `>` first in a paragraph a section or a
 * note; each is escaped with a backslash, and so is the backslash.
 */
export function cooklangText(text: string): string {
  const escaped = oneLine(text)
    .replace(/[\\@#~]/g, '\\$&')
    .replace(/-(?=-)/g, '\\-')
    .replace(/\[(?=-)/g, '\\[');
  return /^[=>]/.test(escaped) ? `\\${escaped}` : escaped;
}

/** A section heading: `= Name`. */
export function cooklangSection(name: string): string {
  return `= ${cooklangText(name).replace(/^\\(?=[=>])/, '')}`;
}

export interface CooklangIngredient {
  name: string;
  /** `500`, `1/2`, `2-3`, or words: `a pinch`. */
  amount?: string | null;
  unit?: string | null;
  note?: string | null;
}

/** `@name{amount%unit}(note)`, with whatever would end a part early taken out. */
export function cooklangIngredient(ingredient: CooklangIngredient): string {
  const name = componentName(ingredient.name);
  const amount = braceText(ingredient.amount);
  const unit = amount === '' ? '' : braceText(ingredient.unit);
  const quantity = unit === '' ? amount : `${amount}%${unit}`;
  const note = oneLine(ingredient.note ?? '')
    .replace(/[()]/g, '')
    .trim();
  return `@${name}{${quantity}}${note === '' ? '' : `(${note})`}`;
}

/**
 * A component name: no character that ends one or marks it (`&` a reference,
 * `?` optional, `-` hidden, `|` an alias). Never empty.
 */
function componentName(name: string): string {
  const cleaned = oneLine(name)
    .replace(/[{}@#~\\[\]|%()]/g, ' ')
    .replace(/^[\s&?+-]+/, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned === '' ? '?' : cleaned;
}

function braceText(text: string | null | undefined): string {
  return oneLine(text ?? '')
    .replace(/[{}%\\]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
