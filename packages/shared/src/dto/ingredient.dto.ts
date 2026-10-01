import { Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsString, Length } from 'class-validator';

import {
  MAX_INGREDIENT_ID_LENGTH,
  MAX_INGREDIENT_LOOKUP_IDS,
  MAX_INGREDIENT_QUERY_LENGTH,
} from '../constants';
import { SUPPORTED_LANGUAGES } from '../utils/locale';
import { IsOmittable, Trim } from './decorators';

/**
 * `GET /ingredients` query: a search (`q`) or a lookup (`ids`), exactly one of
 * them, answered in `lang`. The language is in the URL rather than read from
 * the account, so a cached answer is never one in another language.
 */
export class IngredientsQueryDto {
  /** What the user typed: any name, in any language the app speaks. */
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, MAX_INGREDIENT_QUERY_LENGTH)
  q?: string;

  /**
   * Ids to name, repeated (`?ids=en:milk&ids=en:egg`) or comma-separated. Ids
   * hold no commas.
   */
  @IsOmittable()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter((id) => id !== '') : value,
  )
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_INGREDIENT_LOOKUP_IDS)
  @IsString({ each: true })
  @Length(1, MAX_INGREDIENT_ID_LENGTH, { each: true })
  ids?: string[];

  /** A language of `SUPPORTED_LOCALES`, without its region: `uk`, `fr`. */
  @IsIn([...SUPPORTED_LANGUAGES])
  lang!: string;
}
