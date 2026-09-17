import { IsEmail, IsIn, IsString, Length, MaxLength } from 'class-validator';

import {
  MAX_DISPLAY_NAME_LENGTH,
  MAX_EMAIL_LENGTH,
  MAX_PASSWORD_LENGTH,
  MIN_PASSWORD_LENGTH,
  SUPPORTED_LOCALES,
} from '../constants';
import type { SupportedLocale } from '../types';
import { IsOmittable, NormalizeEmail, Trim } from './decorators';

/** A refresh token is a JWT of about 300 characters. The bound only turns away junk. */
const MAX_REFRESH_TOKEN_LENGTH = 1024;

/** `POST /auth/sign-up`. An email that already has an account is a 409. */
export class SignUpDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  /** Taken as typed: never trimmed. */
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  password!: string;

  /** Defaults to the part of the email before the `@`. */
  @IsOmittable()
  @Trim()
  @IsString()
  @Length(1, MAX_DISPLAY_NAME_LENGTH)
  displayName?: string;

  /**
   * The language the page was showing, which the new account keeps; without it,
   * `DEFAULT_LOCALE`. Otherwise the app would reload in another language the
   * moment the account exists.
   */
  @IsOmittable()
  @IsIn([...SUPPORTED_LOCALES])
  locale?: SupportedLocale;
}

/**
 * `POST /auth/sign-in`. No minimum length: a password chosen under older rules
 * must still sign in.
 */
export class SignInDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  @IsString()
  @Length(1, MAX_PASSWORD_LENGTH)
  password!: string;
}

/**
 * `POST /me/password`. The current password proves it is the account's owner at
 * the keyboard, not someone holding a copied access token.
 */
export class ChangePasswordDto {
  @IsString()
  @Length(1, MAX_PASSWORD_LENGTH)
  currentPassword!: string;

  /** Taken as typed: never trimmed. */
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  newPassword!: string;
}

/** `PUT /admin/users/:email/password`: the password an administrator sets, under sign-up's rules. */
export class ResetPasswordDto {
  /** Taken as typed: never trimmed. */
  @IsString()
  @Length(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH)
  password!: string;
}

/** `POST /auth/refresh` and `POST /auth/sign-out`: the session's current refresh token. */
export class RefreshTokenDto {
  @IsString()
  @Length(1, MAX_REFRESH_TOKEN_LENGTH)
  refreshToken!: string;
}

/**
 * `POST /auth/dev-sign-in`, answered only with `DEV_AUTH=true`: a session for any
 * email, whose account is created on first use. The development stand-in for
 * signing in.
 */
export class DevSignInDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  /** As at sign-up: the language an account created here starts with. An existing account keeps its own. */
  @IsOmittable()
  @IsIn([...SUPPORTED_LOCALES])
  locale?: SupportedLocale;
}
