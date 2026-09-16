import {
  COUNT_UNIT,
  type PantryCategory,
  type PantryItem,
  type Unit,
  type UnitSystemPreference,
} from '@pantry-pal/shared';

import { messages } from '../../i18n/messages';

/** The edit form's state: every field as its input holds it, numbers included. */
export interface ItemDraft {
  name: string;
  locationId: string;
  category: PantryCategory;
  quantity: string;
  unit: string;
  sizeValue: string;
  sizeUnit: string;
  expiresAt: string;
  openedAt: string;
  periodAfterOpeningDays: string;
  notes: string;
}

/** A change set in the shapes `UpdatePantryItemDto` accepts. */
export interface ItemPatch {
  name?: string;
  locationId?: string;
  category?: PantryCategory;
  quantity?: number;
  unit?: string;
  sizeValue?: number | null;
  sizeUnit?: string | null;
  expiresAt?: string | null;
  openedAt?: string | null;
  periodAfterOpeningDays?: number | null;
  notes?: string | null;
}

/** `quantity` is the one on screen, which may include a step not yet saved. */
export function toDraft(item: PantryItem, quantity: number): ItemDraft {
  return {
    name: item.name,
    locationId: item.locationId,
    category: item.category,
    quantity: String(quantity),
    unit: item.unit,
    sizeValue: item.sizeValue === null ? '' : String(item.sizeValue),
    sizeUnit: item.sizeUnit ?? '',
    expiresAt: item.expiresAt ?? '',
    openedAt: item.openedAt ?? '',
    periodAfterOpeningDays:
      item.periodAfterOpeningDays === null ? '' : String(item.periodAfterOpeningDays),
    notes: item.notes ?? '',
  };
}

/**
 * Only the fields the user changed since `base`.
 *
 * Sending less than the whole item is what keeps a save from overwriting a
 * field another member edited while this form was open. Invalid input (an
 * empty quantity) becomes `NaN`, which `UpdatePantryItemDto` then rejects.
 */
export function toPatch(base: ItemDraft, draft: ItemDraft): ItemPatch {
  const patch: ItemPatch = {};

  if (draft.name !== base.name) patch.name = draft.name;
  if (draft.locationId !== base.locationId) patch.locationId = draft.locationId;
  if (draft.category !== base.category) patch.category = draft.category;
  if (draft.quantity !== base.quantity) patch.quantity = toNumber(draft.quantity);
  if (draft.unit !== base.unit) patch.unit = draft.unit;

  // The server takes a size only as a pair, so both halves travel together.
  const size = sizeOfDraft(draft);
  const baseSize = sizeOfDraft(base);
  if (!Object.is(size.value, baseSize.value) || size.unit !== baseSize.unit) {
    patch.sizeValue = size.value;
    patch.sizeUnit = size.unit;
  }

  if (draft.expiresAt !== base.expiresAt) patch.expiresAt = blankToNull(draft.expiresAt);
  if (draft.openedAt !== base.openedAt) patch.openedAt = blankToNull(draft.openedAt);
  if (draft.periodAfterOpeningDays !== base.periodAfterOpeningDays) {
    patch.periodAfterOpeningDays =
      draft.periodAfterOpeningDays.trim() === '' ? null : toNumber(draft.periodAfterOpeningDays);
  }
  if (draft.notes !== base.notes) {
    patch.notes = draft.notes.trim() === '' ? null : draft.notes;
  }

  return patch;
}

/**
 * The one rule `UpdatePantryItemDto` cannot state: size value and unit come
 * together. The server checks it separately; checking it here puts the message
 * beside the field.
 */
export function sizeErrors(draft: ItemDraft): Record<string, string> {
  const size = sizeOfDraft(draft);
  if (size.value !== null && size.unit === null) {
    return { sizeUnit: messages.itemForm.sizeUnitRequired };
  }
  if (size.value === null && size.unit !== null) {
    return { sizeValue: messages.itemForm.sizeValueRequired };
  }
  return {};
}

/**
 * The units a picker offers: the user's preferred system plus units common to
 * both — and always the ones already chosen, so an existing item never shows a
 * blank select. A display preference only; any unit can be stored.
 */
export function pickerUnits(
  units: readonly Unit[],
  preference: UnitSystemPreference | undefined,
  keep: readonly string[],
): Unit[] {
  return units.filter(
    (unit) =>
      preference === undefined ||
      unit.system === 'both' ||
      unit.system === preference ||
      keep.includes(unit.code),
  );
}

/** Today in the user's own calendar, as `YYYY-MM-DD`: in UTC it may still be yesterday. */
export function todayIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${padTwo(now.getMonth() + 1)}-${padTwo(now.getDate())}`;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

/** Only a counted item has a size: switching the unit away from `pcs` clears it. */
function sizeOfDraft(draft: ItemDraft): { value: number | null; unit: string | null } {
  if (draft.unit !== COUNT_UNIT) return { value: null, unit: null };
  return {
    value: draft.sizeValue.trim() === '' ? null : toNumber(draft.sizeValue),
    unit: blankToNull(draft.sizeUnit),
  };
}

function toNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value);
}

function blankToNull(value: string): string | null {
  return value.trim() === '' ? null : value;
}
