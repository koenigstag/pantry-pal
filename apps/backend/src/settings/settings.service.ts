import { Injectable, Logger, ValidationPipe } from '@nestjs/common';
import { AppSettingsRepository, type AppSettingRow } from '@pantry-pal/db';
import {
  APP_SETTING_DEFAULTS,
  APP_SETTING_KEYS,
  type AppSetting,
  type AppSettingKey,
  type AppSettingValues,
} from '@pantry-pal/shared';

import { SETTINGS_REGISTRY } from './settings.registry';

/**
 * Typed access to the untyped `app_settings` table.
 *
 * A key without a row is at its default, which lives in code. Values are
 * validated on the way in and again on the way out, so a row edited by hand
 * into a bad shape degrades to the default with a warning rather than breaking
 * every household creation.
 */
@Injectable()
export class SettingsService {
  private readonly logger = new Logger(SettingsService.name);

  /**
   * The global pipe's options, so a setting is validated exactly like a request
   * body — same rules, same 400 response shape.
   */
  private readonly validation = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });

  constructor(private readonly repository: AppSettingsRepository) {}

  isKnownKey(key: string): key is AppSettingKey {
    return (APP_SETTING_KEYS as readonly string[]).includes(key);
  }

  /** The value in force: the stored override, or the default. */
  async get<K extends AppSettingKey>(key: K): Promise<AppSettingValues[K]> {
    return (await this.describe(key)).value;
  }

  async describe<K extends AppSettingKey>(key: K): Promise<AppSetting<K>> {
    return this.fromRow(key, await this.repository.find(key));
  }

  async list(): Promise<AppSetting[]> {
    const rows = new Map((await this.repository.list()).map((row) => [row.key, row]));
    return Promise.all(APP_SETTING_KEYS.map((key) => this.fromRow(key, rows.get(key))));
  }

  /** Validates and stores an override. Throws `BadRequestException` like any invalid body. */
  async set<K extends AppSettingKey>(key: K, value: unknown): Promise<AppSetting<K>> {
    const normalized = await this.validate(key, value);
    const row = await this.repository.upsert(key, normalized);

    return { key, value: normalized, isDefault: false, updatedAt: row.updatedAt.toISOString() };
  }

  /** Drops the override, returning the default now in force. */
  async reset<K extends AppSettingKey>(key: K): Promise<AppSetting<K>> {
    await this.repository.delete(key);
    return this.defaultOf(key);
  }

  private async fromRow<K extends AppSettingKey>(
    key: K,
    row: AppSettingRow | undefined,
  ): Promise<AppSetting<K>> {
    if (row === undefined) return this.defaultOf(key);

    try {
      const value = await this.validate(key, row.value);
      return { key, value, isDefault: false, updatedAt: row.updatedAt.toISOString() };
    } catch (error) {
      this.logger.warn(
        `Stored value of setting "${key}" is invalid, using the default instead: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return this.defaultOf(key);
    }
  }

  private async validate<K extends AppSettingKey>(
    key: K,
    value: unknown,
  ): Promise<AppSettingValues[K]> {
    const definition = SETTINGS_REGISTRY[key];
    const validated = (await this.validation.transform(value, {
      type: 'body',
      metatype: definition.dto,
    })) as object;

    return definition.normalize(validated);
  }

  private defaultOf<K extends AppSettingKey>(key: K): AppSetting<K> {
    // A copy: the defaults are module-level constants and must survive a caller mutating the result.
    const value = structuredClone(APP_SETTING_DEFAULTS[key]);
    return { key, value, isDefault: true, updatedAt: null };
  }
}
