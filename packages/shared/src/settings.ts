import { DEFAULT_LOCATIONS, FALLBACK_LOCATION_NAME } from './constants';

/**
 * Global, admin-managed settings.
 *
 * Stored as key -> jsonb rows in `app_settings`. A key with no row falls back to
 * its entry in `APP_SETTING_DEFAULTS`, so a fresh database needs no seed and
 * "reset to default" is a DELETE.
 *
 * Adding a setting means: a key here, its value type in `AppSettingValues`, a
 * default, and a validation DTO registered in the backend's settings registry.
 * Values are always objects rather than bare arrays or scalars, so a DTO class
 * can validate them and a field can be added later without a new key.
 */
export const APP_SETTING = {
  DefaultLocations: 'default-locations',
} as const;
export type AppSettingKey = (typeof APP_SETTING)[keyof typeof APP_SETTING];
export const APP_SETTING_KEYS = Object.values(APP_SETTING);

export interface DefaultLocationEntry {
  name: string;
  icon: string | null;
}

/** Copied into every new household, in this order. Existing households are unaffected. */
export interface DefaultLocationsSetting {
  locations: DefaultLocationEntry[];
}

/** A location a new household starts with. */
export interface NewHouseholdLocation extends DefaultLocationEntry {
  isFallback: boolean;
}

/**
 * The locations a new household starts with: the defaults, in order, one of
 * them the fallback. A default named `FALLBACK_LOCATION_NAME`, ignoring case,
 * becomes it; without one, the fallback is appended — which is why the setting
 * holds one location fewer than a household may.
 */
export function withFallbackLocation(
  defaults: readonly DefaultLocationEntry[],
): NewHouseholdLocation[] {
  const fallbackName = FALLBACK_LOCATION_NAME.toLowerCase();
  const locations = defaults.map((entry) => ({
    ...entry,
    isFallback: entry.name.toLowerCase() === fallbackName,
  }));

  return locations.some((location) => location.isFallback)
    ? locations
    : [...locations, { name: FALLBACK_LOCATION_NAME, icon: null, isFallback: true }];
}

export interface AppSettingValues {
  [APP_SETTING.DefaultLocations]: DefaultLocationsSetting;
}

export const APP_SETTING_DEFAULTS: { readonly [K in AppSettingKey]: AppSettingValues[K] } = {
  [APP_SETTING.DefaultLocations]: {
    locations: DEFAULT_LOCATIONS.map((name) => ({ name, icon: null })),
  },
};

/** A setting as the admin API reports it. */
export interface AppSetting<K extends AppSettingKey = AppSettingKey> {
  key: K;
  value: AppSettingValues[K];
  /** True when no override is stored and `value` is the code default. */
  isDefault: boolean;
  /** ISO-8601; `null` while the default is in force. */
  updatedAt: string | null;
}
