import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  Length,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import {
  ITEM_STATUSES,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_NOTES_LENGTH,
  MAX_ITEM_QUANTITY,
  MAX_PERIOD_AFTER_OPENING_DAYS,
  MAX_UNIT_CODE_LENGTH,
  PANTRY_CATEGORIES,
  QUANTITY_DECIMAL_PLACES,
} from '../constants';
import type { ItemStatus, PantryCategory } from '../types';
import { IsIsoDate, IsOmittable, Trim } from './decorators';

/**
 * Request payloads shared by both apps.
 *
 * The backend runs these through Nest's `ValidationPipe`; the frontend validates
 * with the same classes via `validateDto`, so the shapes and rules are identical
 * on both sides.
 *
 * Every rule is declared explicitly (no `emitDecoratorMetadata`) because the
 * shared package is bundled with esbuild, which does not emit design-time types.
 *
 * What a DTO cannot express is checked by the server: that `locationId` belongs
 * to the household, that unit codes exist, and that `sizeValue`/`sizeUnit` come
 * as a pair and only with `unit: 'pcs'`.
 */
export class CreatePantryItemDto {
  @Trim()
  @IsString()
  @Length(1, MAX_ITEM_NAME_LENGTH)
  name!: string;

  @IsUUID()
  locationId!: string;

  @IsIn([...PANTRY_CATEGORIES])
  category!: PantryCategory;

  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: QUANTITY_DECIMAL_PLACES })
  @IsPositive()
  @Max(MAX_ITEM_QUANTITY)
  quantity!: number;

  /** A unit code from `GET /units`. */
  @IsString()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  unit!: string;

  /** What is inside one `pcs`: `300` for a 300 ml can. */
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: QUANTITY_DECIMAL_PLACES })
  @IsPositive()
  @Max(MAX_ITEM_QUANTITY)
  sizeValue?: number | null;

  @IsOptional()
  @IsString()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  sizeUnit?: string | null;

  /** The printed date. Omit or `null` for non-perishables. */
  @IsOptional()
  @IsIsoDate()
  expiresAt?: string | null;

  @IsOptional()
  @IsIsoDate()
  openedAt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PERIOD_AFTER_OPENING_DAYS)
  periodAfterOpeningDays?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ITEM_NOTES_LENGTH)
  notes?: string | null;
}

/**
 * A partial update. An absent field is left alone; `null` clears a nullable one.
 *
 * Changing `status` is how an item is consumed, discarded or restored, and each
 * is recorded as its own event in the item's history.
 */
export class UpdatePantryItemDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, MAX_ITEM_NAME_LENGTH)
  name?: string;

  @IsOmittable()
  @IsUUID()
  locationId?: string;

  @IsOmittable()
  @IsIn([...PANTRY_CATEGORIES])
  category?: PantryCategory;

  /** Zero is allowed here, unlike on create: a used-up item that has not been cleared yet. */
  @IsOmittable()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: QUANTITY_DECIMAL_PLACES })
  @Min(0)
  @Max(MAX_ITEM_QUANTITY)
  quantity?: number;

  @IsOmittable()
  @IsString()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  unit?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: QUANTITY_DECIMAL_PLACES })
  @IsPositive()
  @Max(MAX_ITEM_QUANTITY)
  sizeValue?: number | null;

  @IsOptional()
  @IsString()
  @Length(1, MAX_UNIT_CODE_LENGTH)
  sizeUnit?: string | null;

  @IsOptional()
  @IsIsoDate()
  expiresAt?: string | null;

  @IsOptional()
  @IsIsoDate()
  openedAt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PERIOD_AFTER_OPENING_DAYS)
  periodAfterOpeningDays?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(MAX_ITEM_NOTES_LENGTH)
  notes?: string | null;

  @IsOmittable()
  @IsIn([...ITEM_STATUSES])
  status?: ItemStatus;
}

export const ITEM_STATUS_FILTER_ALL = 'all';
export type ItemStatusFilter = ItemStatus | typeof ITEM_STATUS_FILTER_ALL;

/** `GET .../items` query. Without `status`, only active items are listed. */
export class ListPantryItemsQueryDto {
  @IsOptional()
  @IsIn([...ITEM_STATUSES, ITEM_STATUS_FILTER_ALL])
  status?: ItemStatusFilter;

  @IsOptional()
  @IsUUID()
  locationId?: string;
}

/* Socket commands: the REST payloads plus the household they act on. */

export class SyncPantryDto {
  @IsUUID()
  householdId!: string;
}

export class CreatePantryItemCommandDto extends CreatePantryItemDto {
  @IsUUID()
  householdId!: string;
}

export class DeletePantryItemCommandDto {
  @IsUUID()
  householdId!: string;

  @IsUUID()
  id!: string;
}
