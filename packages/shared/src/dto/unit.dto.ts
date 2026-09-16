import { Type } from 'class-transformer';
import { IsIn, IsNumber, IsPositive, IsString, Length, Matches, Max } from 'class-validator';

import {
  MAX_UNIT_CODE_LENGTH,
  MAX_UNIT_LABEL_LENGTH,
  UNIT_KINDS,
  UNIT_SYSTEMS,
} from '../constants';
import type { UnitKind, UnitSystem } from '../types';
import { IsOmittable, Trim } from './decorators';

/** `numeric(20, 10)`. */
const FACTOR_DECIMAL_PLACES = 10;
const MAX_FACTOR = 1_000_000_000;

export class CreateUnitDto {
  /**
   * Immutable once created — items reference it. Lowercase snake case, and
   * unambiguous: `fl_oz_us`, never a bare `fl_oz`.
   */
  @Trim()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  @Matches(/^[a-z][a-z0-9_]*$/, {
    message: 'code must start with a letter and use only a-z, 0-9 and _',
  })
  code!: string;

  @Trim()
  @IsString()
  @Length(1, MAX_UNIT_LABEL_LENGTH)
  label!: string;

  @IsIn([...UNIT_KINDS])
  kind!: UnitKind;

  @IsIn([...UNIT_SYSTEMS])
  system!: UnitSystem;

  /** To the base unit of its kind: grams, millilitres, pieces. Exact, never rounded. */
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: FACTOR_DECIMAL_PLACES })
  @IsPositive()
  @Max(MAX_FACTOR)
  factor!: number;
}

/** Everything but `code`, which items reference. */
export class UpdateUnitDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, MAX_UNIT_LABEL_LENGTH)
  label?: string;

  @IsOmittable()
  @IsIn([...UNIT_KINDS])
  kind?: UnitKind;

  @IsOmittable()
  @IsIn([...UNIT_SYSTEMS])
  system?: UnitSystem;

  @IsOmittable()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: FACTOR_DECIMAL_PLACES })
  @IsPositive()
  @Max(MAX_FACTOR)
  factor?: number;
}
