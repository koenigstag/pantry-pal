import { Type } from 'class-transformer';
import { IsInt, IsISO8601, IsOptional, IsUUID, Max, Min } from 'class-validator';

import { MAX_SYNC_PULL_LIMIT } from '../constants';

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
}
