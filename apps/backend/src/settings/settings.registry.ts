import { APP_SETTING, type AppSettingKey, type AppSettingValues } from '@pantry-pal/shared';
import { DefaultLocationsSettingDto } from '@pantry-pal/shared/dto';
import type { ClassConstructor } from 'class-transformer';

interface SettingDefinition<K extends AppSettingKey> {
  /** Validates both what an admin submits and what is read back from the database. */
  readonly dto: ClassConstructor<object>;
  /** Maps a validated DTO instance to the exact shape stored and returned. */
  readonly normalize: (validated: object) => AppSettingValues[K];
}

/**
 * One entry per `APP_SETTING` key. The mapped type makes a missing entry a
 * compile error, so a key cannot be added to `@pantry-pal/shared` without
 * deciding how it is validated.
 */
export const SETTINGS_REGISTRY: { readonly [K in AppSettingKey]: SettingDefinition<K> } = {
  [APP_SETTING.DefaultLocations]: {
    dto: DefaultLocationsSettingDto,
    normalize: (validated) => ({
      locations: (validated as DefaultLocationsSettingDto).locations.map(({ name, icon }) => ({
        name,
        // Omitted and null both mean "no icon"; store one of them.
        icon: icon ?? null,
      })),
    }),
  },
};
