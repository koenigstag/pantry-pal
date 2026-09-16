import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  IsUUID,
  Length,
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

export class DeleteLocationQueryDto {
  /**
   * Where the location's active items go. Required when it still holds any;
   * consumed and discarded history keeps pointing at the deleted location.
   */
  @IsOptional()
  @IsUUID()
  moveItemsTo?: string;
}
