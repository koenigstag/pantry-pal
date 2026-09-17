import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  Length,
  Matches,
  ValidateBy,
  ValidateNested,
} from 'class-validator';

import {
  MAX_DEFAULT_LOCATION_CODE_LENGTH,
  MAX_LOCATION_ICON_LENGTH,
  MAX_LOCATION_NAME_LENGTH,
  MAX_LOCATIONS_PER_HOUSEHOLD,
  SUPPORTED_LOCALES,
} from '../constants';
import { pickTranslation, TRANSLATION_LOCALES } from '../utils/locale';
import { IsOmittable, Trim } from './decorators';

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Trims every name in a translations object, so `"  "` fails the length rule. */
function TrimTranslations(): PropertyDecorator {
  return Transform(({ value }: { value: unknown }) =>
    isRecord(value)
      ? Object.fromEntries(
          Object.entries(value).map(([locale, name]) => [
            locale,
            typeof name === 'string' ? name.trim() : name,
          ]),
        )
      : value,
  );
}

/** An object from `TRANSLATION_LOCALES` tags to names of a location name's length. */
function IsTranslations(): PropertyDecorator {
  return ValidateBy({
    name: 'isTranslations',
    validator: {
      validate: (value: unknown) =>
        isRecord(value) &&
        Object.entries(value).every(
          ([locale, name]) =>
            TRANSLATION_LOCALES.includes(locale) &&
            typeof name === 'string' &&
            name.length >= 1 &&
            name.length <= MAX_LOCATION_NAME_LENGTH,
        ),
      defaultMessage: (args) =>
        `${args?.property ?? 'translations'} must map tags among ${TRANSLATION_LOCALES.join(', ')} to names of 1 to ${MAX_LOCATION_NAME_LENGTH} characters`,
    },
  });
}

/** One default storage space in `PUT /admin/default-locations`. */
export class DefaultLocationDto {
  /** Lowercase words joined by hyphens, like category codes: `spices`. */
  @Trim()
  @Length(1, MAX_DEFAULT_LOCATION_CODE_LENGTH)
  @Matches(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/, {
    message: 'code must be lowercase words of a-z and 0-9 joined by single hyphens',
  })
  code!: string;

  /** English: what a household gets where no translation applies. */
  @Trim()
  @IsString()
  @Length(1, MAX_LOCATION_NAME_LENGTH)
  name!: string;

  /** Free text: an emoji or an icon name. */
  @IsOptional()
  @IsString()
  @Length(1, MAX_LOCATION_ICON_LENGTH)
  icon?: string | null;

  /** Omitted: false. Exactly one default of the list is the fallback. */
  @IsOmittable()
  @IsBoolean()
  isFallback?: boolean;

  /** Names by tag, a language (`fr`) or a supported regional tag (`fr-CA`). Omitted: none. */
  @IsOmittable()
  @TrimTranslations()
  @IsTranslations()
  translations?: Record<string, string>;
}

interface NamedEntry {
  name: string;
  translations?: Record<string, string>;
}

const isNamedEntry = (entry: unknown): entry is NamedEntry =>
  isRecord(entry) &&
  typeof entry['name'] === 'string' &&
  (entry['translations'] === undefined || isRecord(entry['translations']));

/**
 * The first name two entries share in some supported locale, ignoring case, or
 * `null`. Malformed entries are left to their own rules.
 */
function findSharedName(entries: unknown): { locale: string; name: string } | null {
  if (!Array.isArray(entries) || !entries.every(isNamedEntry)) return null;

  for (const locale of SUPPORTED_LOCALES) {
    const seen = new Set<string>();
    for (const entry of entries) {
      const name = pickTranslation(entry.translations ?? {}, locale, entry.name);
      const key = name.toLowerCase();
      if (seen.has(key)) return { locale, name };
      seen.add(key);
    }
  }
  return null;
}

/**
 * Every entry's code once, English names once ignoring case, and exactly one
 * fallback. A household created in any supported locale gets names that do not
 * collide, since its names are unique ignoring case too.
 */
function IsConsistentDefaultList(): PropertyDecorator {
  return ValidateBy({
    name: 'isConsistentDefaultList',
    validator: {
      validate: (value: unknown) => {
        if (!Array.isArray(value) || !value.every(isRecord)) return true;
        const codes = value.map((entry) => entry['code']);
        const names = value.map((entry) =>
          typeof entry['name'] === 'string' ? entry['name'].toLowerCase() : entry['name'],
        );
        return (
          new Set(codes).size === codes.length &&
          new Set(names).size === names.length &&
          value.filter((entry) => entry['isFallback'] === true).length === 1 &&
          findSharedName(value) === null
        );
      },
      defaultMessage: (args) => {
        const shared = findSharedName(args?.value);
        return shared === null
          ? 'locations must repeat no code or name, ignoring case, and have exactly one fallback'
          : `locations must not name two spaces "${shared.name}" in ${shared.locale}`;
      },
    },
  });
}

/**
 * `PUT /admin/default-locations`: the whole list, in the order a new household
 * gets it. Households that already exist keep the spaces they were given.
 */
export class ReplaceDefaultLocationsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(MAX_LOCATIONS_PER_HOUSEHOLD)
  @IsConsistentDefaultList()
  @ValidateNested({ each: true })
  @Type(() => DefaultLocationDto)
  locations!: DefaultLocationDto[];
}
