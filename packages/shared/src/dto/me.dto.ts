import { IsIn } from 'class-validator';

import { SUPPORTED_LOCALES } from '../constants';
import type { SupportedLocale } from '../types';
import { IsOmittable } from './decorators';

/** `PATCH /me`: the caller's own settings. An absent field is left alone. */
export class UpdateMeDto {
  /** The UI language: one of `SUPPORTED_LOCALES`. */
  @IsOmittable()
  @IsIn([...SUPPORTED_LOCALES])
  locale?: SupportedLocale;
}
