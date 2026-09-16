import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';

import {
  MAX_LOCATION_ICON_LENGTH,
  MAX_LOCATION_NAME_LENGTH,
  MAX_LOCATIONS_PER_HOUSEHOLD,
} from '../constants';
import { IsOmittable, Trim } from './decorators';

/** Appended after the household's last location; order changes go through `ReorderLocationsDto`. */
export class CreateLocationDto {
  @Trim()
  @IsString()
  @Length(1, MAX_LOCATION_NAME_LENGTH)
  name!: string;

  /** Free text: an emoji or an icon name. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_ICON_LENGTH)
  icon?: string | null;
}

/** `sortOrder` is deliberately absent: a single-row edit could only create ties. */
export class UpdateLocationDto {
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, MAX_LOCATION_NAME_LENGTH)
  name?: string;

  /** `null` removes the icon. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_ICON_LENGTH)
  icon?: string | null;
}

/**
 * The complete new order: every active location of the household, each exactly
 * once. A partial list is rejected rather than guessed at, so two clients
 * reordering at once cannot interleave into an order neither of them chose.
 */
export class ReorderLocationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOCATIONS_PER_HOUSEHOLD)
  @ArrayUnique()
  @IsUUID(undefined, { each: true })
  locationIds!: string[];
}

/** One row of the locations editor. */
export class UpsertLocationEntryDto {
  /** Present: that existing location. Omitted: a new one. `null` is rejected. */
  @IsOmittable()
  @IsUUID()
  id?: string;

  @Trim()
  @IsString()
  @Length(1, MAX_LOCATION_NAME_LENGTH)
  name!: string;

  /** Omitted: unchanged, or none for a new location. `null` removes the icon. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_ICON_LENGTH)
  icon?: string | null;
}

/** A location the editor deletes. */
export class RemoveLocationEntryDto {
  @IsUUID()
  id!: string;

  /**
   * Where its active items go: a location that stays, listed by id in
   * `locations`. Omitted: the household's fallback location.
   */
  @IsOmittable()
  @IsUUID()
  moveItemsTo?: string;
}

/** Case-insensitive name for `ArrayUnique`; a malformed entry is left to its own rules. */
function lowerCaseName(entry: unknown): unknown {
  return typeof entry === 'object' &&
    entry !== null &&
    'name' in entry &&
    typeof entry.name === 'string'
    ? entry.name.toLowerCase()
    : entry;
}

/**
 * Everything the locations editor changed, saved in one transaction.
 *
 * `locations` is the new display order: existing locations by id, new ones
 * without. Together with `removed` it must name every active location of the
 * household exactly once, so a client that edited a stale list is refused
 * rather than silently undoing another member's change.
 *
 * Names are unique ignoring case, as within a household. Checking the whole
 * list rather than row by row is what lets two locations swap names in one save.
 */
export class UpsertLocationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOCATIONS_PER_HOUSEHOLD)
  @ArrayUnique(lowerCaseName, { message: 'locations must not repeat a name, ignoring case' })
  @ValidateNested({ each: true })
  @Type(() => UpsertLocationEntryDto)
  locations!: UpsertLocationEntryDto[];

  /** Omitted: nothing is deleted. */
  @IsOmittable()
  @IsArray()
  @ArrayMaxSize(MAX_LOCATIONS_PER_HOUSEHOLD)
  @ValidateNested({ each: true })
  @Type(() => RemoveLocationEntryDto)
  removed?: RemoveLocationEntryDto[];
}

export class DeleteLocationQueryDto {
  /**
   * Where the location's active items go; omitted, the household's fallback
   * location. Consumed and discarded history keeps pointing at the deleted one.
   */
  @IsOptional()
  @IsUUID()
  moveItemsTo?: string;
}
