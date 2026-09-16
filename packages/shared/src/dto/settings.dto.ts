import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';

import {
  MAX_LOCATION_ICON_LENGTH,
  MAX_LOCATION_NAME_LENGTH,
  MAX_LOCATIONS_PER_HOUSEHOLD,
} from '../constants';
import type { DefaultLocationEntry, DefaultLocationsSetting } from '../settings';
import { Trim } from './decorators';

/*
 * Validation classes for `app_settings` values, one per key. The backend's
 * settings registry maps each key to its class.
 */

export class DefaultLocationEntryDto implements DefaultLocationEntry {
  @Trim()
  @IsString()
  @Length(1, MAX_LOCATION_NAME_LENGTH)
  name!: string;

  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_ICON_LENGTH)
  icon!: string | null;
}

/** The value of the `default-locations` setting. Order is the new household's order. */
export class DefaultLocationsSettingDto implements DefaultLocationsSetting {
  /**
   * At least one, because an item cannot exist without a location. Names are
   * unique ignoring case, as they are within a household — a duplicate would
   * otherwise be dropped silently when a household is created.
   */
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOCATIONS_PER_HOUSEHOLD)
  @ArrayUnique((entry: { name?: unknown }) =>
    typeof entry.name === 'string' ? entry.name.toLowerCase() : entry.name,
  )
  @ValidateNested({ each: true })
  @Type(() => DefaultLocationEntryDto)
  locations!: DefaultLocationEntryDto[];
}
