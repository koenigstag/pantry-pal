import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsString, Length, Matches, Max, Min } from 'class-validator';

import { MAX_CATEGORY_CODE_LENGTH, MAX_CATEGORY_LABEL_LENGTH } from '../constants';
import { IsOmittable, Trim } from './decorators';

/** `integer`, with room to spare for gaps between positions. */
const MAX_SORT_ORDER = 1_000_000;

export class CreateCategoryDto {
  /**
   * Immutable once created — items reference it. Lowercase words joined by
   * hyphens, like the codes already in use: `personal-care`.
   */
  @Trim()
  @Length(1, MAX_CATEGORY_CODE_LENGTH)
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, {
    message: 'code must be lowercase words of a-z and 0-9 joined by single hyphens',
  })
  code!: string;

  /** English; the frontend shows its own catalog's name for a code it knows. */
  @Trim()
  @IsString()
  @Length(1, MAX_CATEGORY_LABEL_LENGTH)
  label!: string;

  /** Where pickers list it, ascending. Omitted: after the last. */
  @IsOmittable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SORT_ORDER)
  sortOrder?: number;

  /** Food or drink. Required: a wrong default would mislabel every item added to it. */
  @IsBoolean()
  isEdible!: boolean;
}

/** Everything but `code`, which items reference. */
export class UpdateCategoryDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, MAX_CATEGORY_LABEL_LENGTH)
  label?: string;

  @IsOmittable()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(MAX_SORT_ORDER)
  sortOrder?: number;

  /**
   * Changing it updates every item in the category too, except in the default
   * category, whose items keep their own.
   */
  @IsOmittable()
  @IsBoolean()
  isEdible?: boolean;
}
