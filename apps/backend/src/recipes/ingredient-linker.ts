import { Injectable } from '@nestjs/common';
import { IngredientsRepository, type IngredientNameQuery } from '@pantry-pal/db';
import { searchText, type RecipeDocument } from '@pantry-pal/shared';

/**
 * Endings Russian and Ukrainian nouns and adjectives take, longest first, so
 * that `сливочным маслом` and `сливочное масло` share the stems `сливочн` and
 * `масл`. Crude by design: the stems only narrow a search that a full name,
 * then trigram similarity, also run, and a stem is never shorter than three
 * letters.
 */
const SLAVIC_ENDINGS = [
  'ями',
  'ами',
  'ого',
  'его',
  'ому',
  'ему',
  'ыми',
  'ими',
  'ой',
  'ей',
  'ий',
  'ый',
  'ая',
  'яя',
  'ое',
  'ее',
  'ые',
  'ие',
  'ых',
  'их',
  'ым',
  'им',
  'ую',
  'юю',
  'ом',
  'ем',
  'ам',
  'ям',
  'ах',
  'ях',
  'ов',
  'ев',
  'а',
  'я',
  'о',
  'е',
  'ы',
  'и',
  'у',
  'ю',
  'ь',
  'й',
  'і',
  'ї',
  'є',
];
/** Plurals in the Latin-script languages: `eggs`, `tomatoes`, `oignons`. */
const LATIN_ENDINGS = ['es', 's'];
const MIN_STEM_LENGTH = 3;

function stem(word: string, language: string): string {
  const endings = language === 'ru' || language === 'uk' ? SLAVIC_ENDINGS : LATIN_ENDINGS;
  for (const ending of endings) {
    if (word.endsWith(ending) && word.length - ending.length >= MIN_STEM_LENGTH) {
      return word.slice(0, -ending.length);
    }
  }
  return word;
}

/**
 * A recipe's way of naming an ingredient, ready to resolve: folded as the
 * ingredient names are, without what describes an amount rather than a thing
 * (`3,2%`, `№1`), each word cut to its stem.
 */
export function ingredientNameQuery(name: string, language: string): IngredientNameQuery {
  return queryOfWords(nameWords(name), language);
}

function nameWords(name: string): string[] {
  return searchText(name)
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter((word) => word !== '' && !/\d/.test(word));
}

function queryOfWords(words: readonly string[], language: string): IngredientNameQuery {
  const stems = words.map((word) => stem(word, language));
  return {
    folded: words.join(' '),
    stems: stems.every((value) => value.length >= MIN_STEM_LENGTH) ? stems : [],
  };
}

/**
 * Matches a recipe's ingredients to the ingredients table (`ingredientId`), so
 * a household's stock can be compared with them. Run whenever a text is
 * parsed — imported, written by the admin API, or relinked — never on read.
 */
@Injectable()
export class IngredientLinker {
  constructor(private readonly ingredients: IngredientsRepository) {}

  /** The document with every ingredient's `ingredientId` set, matched in `locale`'s language. */
  async link(document: RecipeDocument, locale: string): Promise<RecipeDocument> {
    const language = (locale.split('-')[0] ?? locale).toLowerCase();
    const names = [...new Set(document.ingredients.map((ingredient) => ingredient.name))];
    const ids = await Promise.all(names.map((name) => this.resolve(name, language)));
    const byName = new Map(names.map((name, index) => [name, ids[index] ?? null]));

    return {
      ...document,
      ingredients: document.ingredients.map((ingredient) => ({
        ...ingredient,
        ingredientId: byName.get(ingredient.name) ?? null,
      })),
    };
  }

  /**
   * The whole name first; failing that, the name without its first word, and
   * so on, since recipes qualify what the taxonomy names plainly: `свежая
   * спаржа` is asparagus, `сухой вермут` vermouth. Never a single word shorter
   * than four letters on its own, which would match too much.
   */
  private async resolve(name: string, language: string): Promise<string | null> {
    const words = nameWords(name);
    for (let start = 0; start < words.length; start += 1) {
      const rest = words.slice(start);
      if (start > 0 && rest.length === 1 && (rest[0]?.length ?? 0) < 4) break;
      // Each try only if the one before found nothing.
      // oxlint-disable-next-line no-await-in-loop
      const id = await this.ingredients.resolveName(queryOfWords(rest, language), language);
      if (id !== null) return id;
    }
    return null;
  }
}
