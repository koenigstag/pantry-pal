import { IsIn, IsOptional, IsString, IsUrl, Length, MaxLength, ValidateBy } from 'class-validator';

import { MAX_RECIPE_SOURCE_LENGTH, MAX_RECIPE_URL_LENGTH } from '../constants';
import { TRANSLATION_LOCALES } from '../utils/locale';
import { IsOmittable, Trim } from './decorators';

const URL_OPTIONS: Parameters<typeof IsUrl>[0] = {
  protocols: ['http', 'https'],
  require_protocol: true,
};

/** `POST /households/:householdId/recipes/import`: a page holding a recipe. */
export class ImportRecipeDto {
  @Trim()
  @IsString()
  @MaxLength(MAX_RECIPE_URL_LENGTH)
  @IsUrl(URL_OPTIONS)
  url!: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** An object from `TRANSLATION_LOCALES` tags to Cooklang texts. */
function IsRecipeTranslations(): PropertyDecorator {
  return ValidateBy({
    name: 'isRecipeTranslations',
    validator: {
      validate: (value: unknown) =>
        isRecord(value) &&
        Object.entries(value).every(
          ([locale, source]) =>
            TRANSLATION_LOCALES.includes(locale) &&
            typeof source === 'string' &&
            source.trim().length >= 1 &&
            source.length <= MAX_RECIPE_SOURCE_LENGTH,
        ),
      defaultMessage: (args) =>
        `${args?.property ?? 'translations'} must map tags among ${TRANSLATION_LOCALES.join(', ')} to Cooklang texts of 1 to ${MAX_RECIPE_SOURCE_LENGTH} characters`,
    },
  });
}

/**
 * A recommendation, through `POST` and `PUT /admin/recipes`: its Cooklang text
 * as written, and translations of it. The title comes from each text's
 * `title` metadata, which is therefore required.
 */
export class AdminRecipeDto {
  /** The language `source` is written in. */
  @IsIn(TRANSLATION_LOCALES)
  locale!: string;

  @IsString()
  @Length(1, MAX_RECIPE_SOURCE_LENGTH)
  source!: string;

  /** Where it came from. `null` or omitted: nowhere. */
  @IsOptional()
  @IsString()
  @MaxLength(MAX_RECIPE_URL_LENGTH)
  @IsUrl(URL_OPTIONS)
  sourceUrl?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_RECIPE_URL_LENGTH)
  @IsUrl(URL_OPTIONS)
  imageUrl?: string | null;

  /** Cooklang texts by tag. Omitted: none. A key equal to `locale` is refused by the server. */
  @IsOmittable()
  @IsRecipeTranslations()
  translations?: Record<string, string>;
}
