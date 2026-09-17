import {
  HOUSEHOLD_ROLE,
  MAX_DISPLAY_NAME_LENGTH,
  MAX_HOUSEHOLD_NAME_LENGTH,
  MIN_BIRTH_DATE,
  type CurrentUser,
  type UnitSystemPreference,
  type UserHousehold,
} from '@pantry-pal/shared';
import { UpdateHouseholdDto, UpdateMeDto, validateDto } from '@pantry-pal/shared/dto';

import { messages } from '../../i18n/messages';
import { todayIsoDate } from '../storage/itemDraft';

/** The details form as typed. An empty date of birth means none. */
export interface DetailsDraft {
  displayName: string;
  birthDate: string;
  unitSystem: UnitSystemPreference;
  householdName: string;
}

export function detailsDraftOf(user: CurrentUser, household: UserHousehold | null): DetailsDraft {
  return {
    displayName: user.displayName,
    birthDate: user.birthDate ?? '',
    unitSystem: user.unitSystem,
    householdName: household?.name ?? '',
  };
}

/** Owners rename a household; members only see its name. */
export const canRenameHousehold = (household: UserHousehold | null): boolean =>
  household?.role === HOUSEHOLD_ROLE.Owner;

/** What saving sends: the account's changed fields, and the household's name when it changed. */
export interface DetailsChanges {
  me: UpdateMeDto;
  householdName?: string;
}

/** The fields of `draft` that differ from what is saved, trimmed as the server trims them. */
export function detailsChanges(
  draft: DetailsDraft,
  user: CurrentUser,
  household: UserHousehold | null,
): DetailsChanges {
  const me: UpdateMeDto = {};
  const displayName = draft.displayName.trim();
  if (displayName !== user.displayName) me.displayName = displayName;
  const birthDate = draft.birthDate === '' ? null : draft.birthDate;
  if (birthDate !== user.birthDate) me.birthDate = birthDate;
  if (draft.unitSystem !== user.unitSystem) me.unitSystem = draft.unitSystem;

  const householdName = draft.householdName.trim();
  return household !== null && canRenameHousehold(household) && householdName !== household.name
    ? { me, householdName }
    : { me };
}

export const hasDetailsChanges = (changes: DetailsChanges): boolean =>
  Object.keys(changes.me).length > 0 || changes.householdName !== undefined;

/**
 * The changes checked against the DTOs the server applies, plus the one rule a
 * DTO cannot state: a date of birth after today in the user's own calendar. One
 * catalog message per field, or `null` when they pass.
 */
export function detailsErrors(changes: DetailsChanges): Record<string, string> | null {
  const t = messages.details.fieldErrors;
  const byField: Record<string, string> = {
    displayName: t.displayName(MAX_DISPLAY_NAME_LENGTH),
    birthDate: t.birthDate(MIN_BIRTH_DATE.slice(0, 4)),
    householdName: t.householdName(MAX_HOUSEHOLD_NAME_LENGTH),
  };
  const errors: Record<string, string> = {};

  const me = validateDto(UpdateMeDto, changes.me);
  if (!me.ok) {
    for (const error of me.errors) {
      errors[error.property] = byField[error.property] ?? error.messages[0] ?? '';
    }
  }
  const birthDate = changes.me.birthDate;
  if (typeof birthDate === 'string' && birthDate > todayIsoDate()) {
    errors['birthDate'] = byField['birthDate'] ?? '';
  }
  if (
    changes.householdName !== undefined &&
    !validateDto(UpdateHouseholdDto, { name: changes.householdName }).ok
  ) {
    errors['householdName'] = byField['householdName'] ?? '';
  }

  return Object.keys(errors).length > 0 ? errors : null;
}
