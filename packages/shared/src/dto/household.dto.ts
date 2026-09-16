import { IsEmail, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';

import { HOUSEHOLD_ROLES, MAX_EMAIL_LENGTH, MAX_HOUSEHOLD_NAME_LENGTH } from '../constants';
import type { HouseholdRole } from '../types';
import { NormalizeEmail, Trim } from './decorators';

/** The caller becomes the owner, and the default locations are copied in. */
export class CreateHouseholdDto {
  @Trim()
  @IsString()
  @Length(1, MAX_HOUSEHOLD_NAME_LENGTH)
  name!: string;
}

export class UpdateHouseholdDto {
  @Trim()
  @IsString()
  @Length(1, MAX_HOUSEHOLD_NAME_LENGTH)
  name!: string;
}

/**
 * Adds an existing user by email. There is no invitation flow yet, so the user
 * must have signed in at least once.
 */
export class AddHouseholdMemberDto {
  @NormalizeEmail()
  @IsEmail()
  @MaxLength(MAX_EMAIL_LENGTH)
  email!: string;

  /** Defaults to `member`. */
  @IsOptional()
  @IsIn([...HOUSEHOLD_ROLES])
  role?: HouseholdRole;
}

export class UpdateHouseholdMemberDto {
  @IsIn([...HOUSEHOLD_ROLES])
  role!: HouseholdRole;
}
