import { Type } from 'class-transformer';
import {
  IsIn,
  IsISO8601,
  IsInt,
  IsOptional,
  IsString,
  Length,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

import {
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_QUANTITY,
  PANTRY_CATEGORIES,
  PANTRY_UNITS,
} from '../constants';
import type { PantryCategory, PantryUnit } from '../types';

/**
 * Request payloads shared by both apps.
 *
 * The backend runs these through Nest's `ValidationPipe`; the frontend imports
 * them with `import type` so the validation runtime is tree-shaken out of the
 * browser bundle while the shapes stay identical on both sides.
 *
 * Every rule is declared explicitly (no `emitDecoratorMetadata`) because the
 * shared package is bundled with esbuild, which does not emit design-time types.
 */
export class CreatePantryItemDto {
  @IsString()
  @Length(1, MAX_ITEM_NAME_LENGTH)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  quantity!: number;

  @IsIn([...PANTRY_UNITS])
  unit!: PantryUnit;

  @IsIn([...PANTRY_CATEGORIES])
  category!: PantryCategory;

  /** ISO-8601 date, or `null` for non-perishables. */
  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;
}

export class UpdatePantryItemDto {
  @IsOptional()
  @IsString()
  @Length(1, MAX_ITEM_NAME_LENGTH)
  name?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ITEM_QUANTITY)
  quantity?: number;

  @IsOptional()
  @IsIn([...PANTRY_UNITS])
  unit?: PantryUnit;

  @IsOptional()
  @IsIn([...PANTRY_CATEGORIES])
  category?: PantryCategory;

  @IsOptional()
  @ValidateIf((_object, value) => value !== null)
  @IsISO8601()
  expiresAt?: string | null;
}

export class DeletePantryItemDto {
  @IsString()
  @Length(1, 64)
  id!: string;
}
