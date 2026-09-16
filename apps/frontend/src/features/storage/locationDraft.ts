import type { PantryLocation } from '@pantry-pal/shared';
import type { UpsertLocationsDto } from '@pantry-pal/shared/dto';

/** One row of the locations editor. */
export interface DraftLocation {
  /** Stable while editing and dragging: the location's id, or a generated key for a new one. */
  key: string;
  /** `null` for a location that does not exist yet. */
  id: string | null;
  /** As typed; trimmed when compared and saved. */
  name: string;
  /** The server's name when this row last followed it; `null` for a new location. */
  savedName: string | null;
  /** Deleted on save. Only a saved location is marked; a new row is dropped instead. */
  removed: boolean;
  /** Where a removed location's items go, once the user has picked a location. */
  moveItemsTo: string | null;
}

export type DraftError = 'required' | 'duplicate' | 'nowhereToMove';

function fromLocation(location: PantryLocation): DraftLocation {
  return {
    key: location.id,
    id: location.id,
    name: location.name,
    savedName: location.name,
    removed: false,
    moveItemsTo: null,
  };
}

export function toDraft(locations: readonly PantryLocation[]): DraftLocation[] {
  return locations.map(fromLocation);
}

export function newDraftLocation(key: string): DraftLocation {
  return { key, id: null, name: '', savedName: null, removed: false, moveItemsTo: null };
}

/** A new row nobody has typed a name into: ignored, as if it were not there. */
function isBlankNew(row: DraftLocation): boolean {
  return row.id === null && row.name.trim() === '';
}

/** Rows that will exist after saving, in their new order. */
export function keptRows(draft: readonly DraftLocation[]): DraftLocation[] {
  return draft.filter((row) => !row.removed && !isBlankNew(row));
}

/**
 * Brings a draft up to date with the server's list, which other members can
 * change while the editor is open — and which a save refused as stale (409)
 * has just refetched.
 *
 * Locations deleted elsewhere drop out and ones added elsewhere are appended.
 * A location renamed elsewhere takes the new name unless the user has edited
 * it here. Everything else the user did is kept, so saving again applies their
 * edits on top of the latest list.
 */
export function rebase(
  draft: readonly DraftLocation[],
  locations: readonly PantryLocation[],
): readonly DraftLocation[] {
  const current = new Map(locations.map((location) => [location.id, location]));
  let changed = false;

  const rows = draft.flatMap((row): DraftLocation[] => {
    if (row.id === null) return [row];

    const location = current.get(row.id);
    if (location === undefined) {
      changed = true;
      return [];
    }
    if (location.name === row.savedName) return [row];

    changed = true;
    const edited = row.name !== row.savedName;
    return [{ ...row, name: edited ? row.name : location.name, savedName: location.name }];
  });

  const listed = new Set(draft.map((row) => row.id));
  const added = locations.filter((location) => !listed.has(location.id)).map(fromLocation);

  return changed || added.length > 0 ? [...rows, ...added] : draft;
}

/** Whether saving would change anything. Expects a draft rebased onto `locations`. */
export function isChanged(
  draft: readonly DraftLocation[],
  locations: readonly PantryLocation[],
): boolean {
  if (draft.some((row) => row.removed || (row.id === null && !isBlankNew(row)))) return true;

  const rows = keptRows(draft);
  return (
    rows.length !== locations.length ||
    rows.some(
      (row, index) => row.id !== locations[index]?.id || row.name.trim() !== locations[index]?.name,
    )
  );
}

/** Saved locations that stay, other than `row`: where a removed location's items can go. */
export function moveTargets(draft: readonly DraftLocation[], row: DraftLocation): DraftLocation[] {
  return draft.filter(
    (candidate) => candidate.id !== null && !candidate.removed && candidate.id !== row.id,
  );
}

/** The user's pick while it is still possible, otherwise the first saved location that stays. */
export function moveTarget(draft: readonly DraftLocation[], row: DraftLocation): string | null {
  const targets = moveTargets(draft, row);
  return targets.find((target) => target.id === row.moveItemsTo)?.id ?? targets[0]?.id ?? null;
}

/**
 * Problems that would make the server refuse the save, by row key.
 *
 * Names are compared the way `UpsertLocationsDto` compares them — trimmed, and
 * lowercased with `toLowerCase` — so the editor and the server agree on what a
 * duplicate is.
 */
export function draftErrors(
  draft: readonly DraftLocation[],
  holdsItems: (locationId: string) => boolean,
): ReadonlyMap<string, DraftError> {
  const errors = new Map<string, DraftError>();
  const keysByName = new Map<string, string[]>();

  for (const row of draft) {
    if (row.removed) {
      if (row.id !== null && holdsItems(row.id) && moveTarget(draft, row) === null) {
        errors.set(row.key, 'nowhereToMove');
      }
      continue;
    }

    const name = row.name.trim();
    if (name === '') {
      if (row.id !== null) errors.set(row.key, 'required');
      continue;
    }

    const normalized = name.toLowerCase();
    keysByName.set(normalized, [...(keysByName.get(normalized) ?? []), row.key]);
  }

  for (const keys of keysByName.values()) {
    if (keys.length > 1) for (const key of keys) errors.set(key, 'duplicate');
  }
  return errors;
}

export function toUpsertLocations(
  draft: readonly DraftLocation[],
  holdsItems: (locationId: string) => boolean,
): UpsertLocationsDto {
  return {
    locations: keptRows(draft).map((row) =>
      row.id === null ? { name: row.name.trim() } : { id: row.id, name: row.name.trim() },
    ),
    removed: draft.flatMap((row) => {
      if (!row.removed || row.id === null) return [];

      const target = holdsItems(row.id) ? moveTarget(draft, row) : null;
      return [target === null ? { id: row.id } : { id: row.id, moveItemsTo: target }];
    }),
  };
}
