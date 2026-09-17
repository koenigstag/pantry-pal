import type { ShoppingList } from '@pantry-pal/shared';
import type { UpsertShoppingListsDto } from '@pantry-pal/shared/dto';

/** One row of the shopping lists editor. */
export interface DraftList {
  /** Stable while editing: the list's id, or a generated key for a new one. */
  key: string;
  /** `null` for a list that does not exist yet. */
  id: string | null;
  /** As typed; trimmed when compared and saved. */
  name: string;
  /** The server's name when this row last followed it; `null` for a new list. */
  savedName: string | null;
  archived: boolean;
  /** The server's archived state when this row last followed it; `null` for a new list. */
  savedArchived: boolean | null;
  /** Deleted on save. Only a saved list is marked; a new row is dropped instead. */
  removed: boolean;
}

export type DraftError = 'required' | 'duplicate';

function fromList(list: ShoppingList): DraftList {
  const archived = list.archivedAt !== null;
  return {
    key: list.id,
    id: list.id,
    name: list.name,
    savedName: list.name,
    archived,
    savedArchived: archived,
    removed: false,
  };
}

/** The lists in the order the editor shows and saves them: those in use, then the archived. */
function inEditorOrder<T extends { archived: boolean }>(rows: readonly T[]): T[] {
  return [...rows.filter((row) => !row.archived), ...rows.filter((row) => row.archived)];
}

export function toDraft(lists: readonly ShoppingList[]): DraftList[] {
  return inEditorOrder(lists.map(fromList));
}

export function newDraftList(key: string, name = ''): DraftList {
  return {
    key,
    id: null,
    name,
    savedName: null,
    archived: false,
    savedArchived: null,
    removed: false,
  };
}

/** A new row nobody has typed a name into: ignored, as if it were not there. */
function isBlankNew(row: DraftList): boolean {
  return row.id === null && row.name.trim() === '';
}

/** Rows that will exist after saving, in the order they are saved. */
export function keptRows(draft: readonly DraftList[]): DraftList[] {
  return inEditorOrder(draft.filter((row) => !row.removed && !isBlankNew(row)));
}

/**
 * Brings a draft up to date with the server's lists, which other members can
 * change while the editor is open — and which a save refused as stale (409)
 * has just refetched.
 *
 * Lists deleted elsewhere drop out and ones added elsewhere are appended. A
 * name or archived state changed elsewhere is taken over unless the user has
 * changed it here. Everything else the user did is kept, so saving again
 * applies their edits on top of the latest lists.
 */
export function rebase(
  draft: readonly DraftList[],
  lists: readonly ShoppingList[],
): readonly DraftList[] {
  const current = new Map(lists.map((list) => [list.id, list]));
  let changed = false;

  const rows = draft.flatMap((row): DraftList[] => {
    if (row.id === null) return [row];

    const list = current.get(row.id);
    if (list === undefined) {
      changed = true;
      return [];
    }

    const archived = list.archivedAt !== null;
    if (list.name === row.savedName && archived === row.savedArchived) return [row];

    changed = true;
    return [
      {
        ...row,
        name: row.name === row.savedName ? list.name : row.name,
        savedName: list.name,
        archived: row.archived === row.savedArchived ? archived : row.archived,
        savedArchived: archived,
      },
    ];
  });

  const listed = new Set(draft.map((row) => row.id));
  const added = lists.filter((list) => !listed.has(list.id)).map(fromList);

  return changed || added.length > 0 ? [...rows, ...added] : draft;
}

/** Whether saving would change anything. Expects a draft rebased onto `lists`. */
export function isChanged(draft: readonly DraftList[], lists: readonly ShoppingList[]): boolean {
  if (draft.some((row) => row.removed || (row.id === null && !isBlankNew(row)))) return true;

  const rows = keptRows(draft);
  const saved = toDraft(lists);
  return (
    rows.length !== saved.length ||
    rows.some(
      (row, index) =>
        row.id !== saved[index]?.id ||
        row.name.trim() !== saved[index]?.name ||
        row.archived !== saved[index]?.archived,
    )
  );
}

/**
 * Problems that would make the server refuse the save, by row key. Names are
 * compared the way `UpsertShoppingListsDto` compares them — trimmed, and
 * lowercased with `toLowerCase` — archived lists included.
 */
export function draftErrors(draft: readonly DraftList[]): ReadonlyMap<string, DraftError> {
  const errors = new Map<string, DraftError>();
  const keysByName = new Map<string, string[]>();

  for (const row of draft) {
    if (row.removed) continue;

    const name = row.name.trim();
    if (name === '') {
      if (row.id !== null) errors.set(row.key, 'required');
      continue;
    }

    const normalized = name.toLowerCase();
    keysByName.set(normalized, [...(keysByName.get(normalized) ?? []), row.key]);
  }

  for (const keys of keysByName.values()) {
    if (keys.length < 2) continue;
    for (const key of keys) errors.set(key, 'duplicate');
  }
  return errors;
}

export function toUpsertShoppingLists(draft: readonly DraftList[]): UpsertShoppingListsDto {
  return {
    lists: keptRows(draft).map((row) =>
      row.id === null
        ? { name: row.name.trim(), archived: row.archived }
        : { id: row.id, name: row.name.trim(), archived: row.archived },
    ),
    removed: draft.flatMap((row) => (row.removed && row.id !== null ? [row.id] : [])),
  };
}
