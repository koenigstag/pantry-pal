import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsInt,
  IsISO8601,
  IsObject,
  IsOptional,
  IsUUID,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';

import { MAX_SYNC_PULL_LIMIT, MAX_SYNC_PUSH_BATCH } from '../constants';

/**
 * `GET .../sync/:collection`: where to continue, and how many documents to take.
 *
 * The checkpoint is the one a previous pull returned, passed back as it came:
 * `updatedAt` carries the database's microseconds, so it must not be parsed and
 * re-serialised on the way. Its two halves come together or not at all, a rule
 * the service states, since a DTO cannot.
 */
export class SyncPullQueryDto {
  @IsOptional()
  @IsISO8601({ strict: true })
  updatedAt?: string;

  @IsOptional()
  @IsUUID()
  id?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_SYNC_PULL_LIMIT)
  limit?: number;

  /**
   * `true` to have each item's units (`PantryItem.subItems`). A mirror made
   * before units existed leaves it out, and gets items as they were: its
   * conflict handler compares fields by identity, and would take an array for a
   * change every time.
   */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  subItems?: boolean;
}

/** One row of a push. Its documents are checked against the item or entry rules by the service. */
export class SyncPushRowDto {
  @IsOptional()
  @IsObject()
  assumedMasterState?: Record<string, unknown>;

  @IsObject()
  newDocumentState!: Record<string, unknown>;
}

/** `POST .../sync/:collection/push`: local changes, oldest first. */
export class SyncPushDto {
  @IsArray()
  @ArrayMaxSize(MAX_SYNC_PUSH_BATCH)
  @ValidateNested({ each: true })
  @Type(() => SyncPushRowDto)
  rows!: SyncPushRowDto[];
}
