import { Body, Controller, Delete, Get, NotFoundException, Param, Put } from '@nestjs/common';
import type { AppSetting, AppSettingKey } from '@pantry-pal/shared';

import { AdminOnly } from '../auth/access.decorators';
import { SettingsService } from '../settings/settings.service';

/**
 * `/api/v1/admin/settings`, authenticated with the `x-admin-api-key` header.
 *
 * Generic over every key in `APP_SETTING`. The body of a PUT is the value
 * itself, validated against that key's DTO — so `@Body()` is typed `unknown`,
 * which the global `ValidationPipe` passes through untouched.
 */
@AdminOnly()
@Controller('admin/settings')
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  /** Every known setting, overridden or not. */
  @Get()
  list(): Promise<AppSetting[]> {
    return this.settings.list();
  }

  @Get(':key')
  get(@Param('key') key: string): Promise<AppSetting> {
    return this.settings.describe(this.knownKey(key));
  }

  /** Stores an override. Affects households created from now on, not existing ones. */
  @Put(':key')
  set(@Param('key') key: string, @Body() value: unknown): Promise<AppSetting> {
    return this.settings.set(this.knownKey(key), value);
  }

  /** Drops the override and returns the default now in force. */
  @Delete(':key')
  reset(@Param('key') key: string): Promise<AppSetting> {
    return this.settings.reset(this.knownKey(key));
  }

  private knownKey(key: string): AppSettingKey {
    if (!this.settings.isKnownKey(key)) throw new NotFoundException(`Unknown setting "${key}"`);
    return key;
  }
}
