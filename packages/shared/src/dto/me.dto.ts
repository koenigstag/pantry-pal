import { IsIn, IsOptional, IsString, Length, ValidateBy } from 'class-validator';

import {
  MAX_DISPLAY_NAME_LENGTH,
  MIN_BIRTH_DATE,
  SUPPORTED_LOCALES,
  UNIT_SYSTEM_PREFERENCES,
} from '../constants';
import type { SupportedLocale, UnitSystemPreference } from '../types';
import { IsIsoDate, IsOmittable, Trim } from './decorators';

/** The furthest any time zone runs ahead of UTC. */
const MAX_UTC_OFFSET_MS = 14 * 60 * 60 * 1000;

/**
 * A `YYYY-MM-DD` date from `MIN_BIRTH_DATE` up to today. Today is the latest
 * date anywhere, up to a day ahead of UTC, so a date the user's own calendar has
 * reached is never refused. The format itself is `@IsIsoDate()`'s to check.
 */
function IsPlausibleBirthDate(): PropertyDecorator {
  return ValidateBy({
    name: 'isPlausibleBirthDate',
    validator: {
      validate: (value: unknown) => {
        const latestToday = new Date(Date.now() + MAX_UTC_OFFSET_MS).toISOString().slice(0, 10);
        return typeof value === 'string' && value >= MIN_BIRTH_DATE && value <= latestToday;
      },
      defaultMessage: (args) =>
        `${args?.property ?? 'birthDate'} must be a date from ${MIN_BIRTH_DATE} to today`,
    },
  });
}

/** `PATCH /me`: the caller's own settings. An absent field is left alone. */
export class UpdateMeDto {
  /** What household members see the caller as. */
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, MAX_DISPLAY_NAME_LENGTH)
  displayName?: string;

  /** Which units the item form offers. */
  @IsOmittable()
  @IsIn([...UNIT_SYSTEM_PREFERENCES])
  unitSystem?: UnitSystemPreference;

  /** `null` removes it. */
  @IsOptional()
  @IsIsoDate()
  @IsPlausibleBirthDate()
  birthDate?: string | null;

  /** The UI language: one of `SUPPORTED_LOCALES`. */
  @IsOmittable()
  @IsIn([...SUPPORTED_LOCALES])
  locale?: SupportedLocale;
}
