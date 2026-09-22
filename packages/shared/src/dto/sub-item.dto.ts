import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsIn,
  IsInt,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import {
  FULL_FILL_PERCENT,
  ITEM_STATUSES,
  MAX_ITEM_QUANTITY,
  MAX_PERIOD_AFTER_OPENING_DAYS,
  MIN_FILL_PERCENT,
} from '../constants';
import type { ItemStatus } from '../types';
import { IsIsoDate, IsOmittable } from './decorators';

/*
 * One unit of an item at a time: its dates, how much is left, and whether it is
 * still on the shelf. What a DTO cannot state is checked by the server: a unit
 * below full must have been opened, an item holds at most `MAX_ITEM_QUANTITY`
 * units, and it keeps at least one.
 */

/** A unit as it starts: each of a new item's, or one put on an item's shelf. */
export class NewSubItemDto {
  /**
   * Chosen by the client, which needs the unit's identity before the server has
   * seen it: the offline mirror names units as it makes them. Omitted, the
   * database picks one.
   */
  @IsOptional()
  @IsUUID()
  id?: string;

  /** The printed date. Omit or `null` for none. */
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

  /** How much is left, in percent. Omitted, the unit is full; below full, it must have been opened. */
  @IsOmittable()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_FILL_PERCENT)
  @Max(FULL_FILL_PERCENT)
  fillPercent?: number;
}

/** `POST .../items/:itemId/sub-items`: units to put on the item's shelf, each in a state of its own. */
export class AddSubItemsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_ITEM_QUANTITY)
  @ValidateNested({ each: true })
  @Type(() => NewSubItemDto)
  subItems!: NewSubItemDto[];
}

/**
 * `PATCH .../items/:itemId/sub-items/:subItemId`: an absent field is left alone,
 * and `null` clears a date.
 *
 * Changing `status` uses one unit up (`consumed`) or throws it out
 * (`discarded`), each recorded as its own event; `active` puts it back.
 * Clearing `openedAt` fills the unit back up unless `fillPercent` says otherwise.
 */
export class UpdateSubItemDto {
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

  @IsOmittable()
  @Type(() => Number)
  @IsInt()
  @Min(MIN_FILL_PERCENT)
  @Max(FULL_FILL_PERCENT)
  fillPercent?: number;

  @IsOmittable()
  @IsIn([...ITEM_STATUSES])
  status?: ItemStatus;
}
