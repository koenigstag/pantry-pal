import {
  QUANTITY_UNIT_KIND,
  type PantryCategory,
  type PantryItem,
  type Unit,
  type UnitKind,
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
 * Rules `UpdatePantryItemDto` cannot state, checked here so each message sits
 * beside its field: a size's value and unit come together (the server checks
 * that separately), and nothing is opened in the future.
 */
export function ruleErrors(
  draft: ItemDraft,
  today: string = todayIsoDate(),
): Record<string, string> {
  const errors: Record<string, string> = {};

  const size = sizeOfDraft(draft);
  if (size.value !== null && size.unit === null) {
    errors['sizeUnit'] = messages.fieldErrors.sizeUnitRequired;
  } else if (size.value === null && size.unit !== null) {
    errors['sizeValue'] = messages.fieldErrors.sizeValueRequired;
  }

  // `YYYY-MM-DD` compares chronologically as a string.
  if (draft.openedAt !== '' && draft.openedAt > today) {
    errors['openedAt'] = messages.fieldErrors.openedInFuture;
  }

  return errors;
}

export type DraftField = keyof ItemDraft;

/**
 * Moves an open form onto a newer copy of the item — one another member saved
 * while it was being edited.
 *
 * A field the user has not touched follows the new value. A touched field keeps
 * the user's value; if the other member changed it too, to something else, it is
 * a conflict, since saving would replace their value — the form says so.
 */
export function rebaseDraft(
  base: ItemDraft,
  draft: ItemDraft,
  next: ItemDraft,
): { draft: ItemDraft; conflicts: DraftField[] } {
  const rebased: Record<DraftField, string> = { ...draft };
  const conflicts: DraftField[] = [];

  for (const field of Object.keys(base) as DraftField[]) {
    if (draft[field] === base[field]) {
      rebased[field] = next[field];
    } else if (next[field] !== base[field] && next[field] !== draft[field]) {
      conflicts.push(field);
    }
  }

  return { draft: rebased as ItemDraft, conflicts };
}

/** The label a field has in the edit form, for naming it in a message. */
export function draftFieldLabel(field: DraftField): string {
  const labels = messages.itemForm;
  switch (field) {
    case 'name':
      return labels.name;
    case 'locationId':
      return labels.location;
    case 'category':
      return labels.category;
    case 'quantity':
      return labels.howMany;
    case 'unit':
      return labels.unit;
    case 'sizeValue':
    case 'sizeUnit':
      return labels.sizeValue;
    case 'expiresAt':
      return labels.expires;
    case 'openedAt':
      return labels.opened;
    case 'periodAfterOpeningDays':
      return labels.periodAfterOpening;
    case 'notes':
      return labels.notes;
  }
}

/**
 * The units a picker offers: the user's preferred system plus units common to
 * both — and always the one already chosen, so an existing item never shows a
 * blank select. A display preference only; any unit can be stored.
 */
export function pickerUnits(
  units: readonly Unit[],
  preference: UnitSystemPreference | undefined,
  keep: string,
): Unit[] {
  return units.filter(
    (unit) =>
      preference === undefined ||
      unit.system === 'both' ||
      unit.system === preference ||
      unit.code === keep,
  );
}

/** What an item can be counted in: `pcs`, `bottle`, `can` — never `kg`. */
export function isQuantityUnit(unit: Unit): boolean {
  return unit.kind === QUANTITY_UNIT_KIND;
}

/** Size picker groups: weights and volumes first, since most sizes are one. */
const SIZE_KIND_ORDER: readonly UnitKind[] = ['mass', 'volume', 'count'];

/** `units` by kind, in size picker order, leaving out kinds with none. */
export function groupByKind(units: readonly Unit[]): { kind: UnitKind; units: Unit[] }[] {
  return SIZE_KIND_ORDER.map((kind) => ({
    kind,
    units: units.filter((unit) => unit.kind === kind),
  })).filter((group) => group.units.length > 0);
}

/**
 * The count a unit's noun agrees with while a number is being typed: the
 * number once there is one, else 1, so an empty field reads `bottle`.
 */
export function nounCount(value: string): number {
  const count = Number(value);
  return value.trim() !== '' && Number.isFinite(count) ? count : 1;
}

/** Today in the user's own calendar, as `YYYY-MM-DD`: in UTC it may still be yesterday. */
export function todayIsoDate(now: Date = new Date()): string {
  return `${now.getFullYear()}-${padTwo(now.getMonth() + 1)}-${padTwo(now.getDate())}`;
}

function padTwo(value: number): string {
  return String(value).padStart(2, '0');
}

function sizeOfDraft(draft: ItemDraft): { value: number | null; unit: string | null } {
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
