import {
  MAX_SHOPPING_LIST_NAME_LENGTH,
  MAX_SHOPPING_LISTS_PER_HOUSEHOLD,
} from '@pantry-pal/shared';
import { UpsertShoppingListsDto, validateDto } from '@pantry-pal/shared/dto';
import { Archive, ArchiveRestore, Plus, Trash, Undo2 } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Dialog } from '../../ui/Dialog';
import { FIELD_CONTROL } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import {
  draftErrors,
  isChanged,
  newDraftList,
  rebase,
  toDraft,
  toUpsertShoppingLists,
  type DraftError,
  type DraftList,
} from './shoppingListDraft';

interface ShoppingListEditorDialogProps {
  open: boolean;
  /**
   * Opens with a new row holding this name, focused: `''` for a blank one, a
   * suggestion for a household's first list. `null` opens the lists as they are.
   */
  newListName: string | null;
  onClose: () => void;
}

/** The key of the row `newListName` asks for, which the dialog focuses when it opens. */
const REQUESTED_ROW = 'new-requested';

const SAVE_BUTTON =
  'focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

const ERROR_MESSAGES: Record<DraftError, string> = {
  required: messages.shoppingListEditor.nameRequired,
  duplicate: messages.shoppingListEditor.nameTaken,
};

/** A row's name in labels: as typed, else as saved, else a placeholder. */
function displayName(row: DraftList): string {
  if (row.removed && row.savedName !== null) return row.savedName;
  return row.name.trim() || row.savedName || messages.shoppingListEditor.unnamed;
}

function focusName(container: HTMLElement | null, key: string): void {
  container?.querySelector<HTMLInputElement>(`[data-list-key="${CSS.escape(key)}"] input`)?.focus();
}

/**
 * Adds, renames, archives, restores and deletes the household's shopping lists,
 * and saves it all in one request (`PUT .../shopping-lists`), so no member ever
 * sees half an edit.
 *
 * Lists in use come first, then the archived ones, which are hidden everywhere
 * else and frozen until restored. As in the storage spaces editor, the draft is
 * rebased onto the store's lists on every render: whatever other members change
 * meanwhile shows up in it, and a save the server refuses as stale needs nothing
 * more than a second try.
 */
export const ShoppingListEditorDialog = observer(function ShoppingListEditorDialog({
  open,
  newListName,
  onClose,
}: ShoppingListEditorDialogProps): ReactElement {
  const pantry = usePantryStore();
  /** `null` until the first edit; until then the rows are the store's lists. */
  const [draft, setDraft] = useState<readonly DraftList[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [isConfirmingDiscard, setConfirmingDiscard] = useState(false);
  const rowsRef = useRef<HTMLDivElement>(null);
  const nextKey = useRef(0);
  const pendingFocus = useRef<string | null>(null);
  const limitHintId = useId();
  const archivedHeadingId = useId();
  const formId = useId();

  // Opening with a new row focuses it; so does adding one.
  useEffect(() => {
    if (open && newListName !== null) pendingFocus.current = REQUESTED_ROW;
  }, [open, newListName]);

  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    focusName(rowsRef.current, key);
  });

  const lists = pantry.shoppingLists;
  const rows =
    draft === null
      ? [
          ...toDraft(lists),
          ...(open && newListName !== null ? [newDraftList(REQUESTED_ROW, newListName)] : []),
        ]
      : rebase(draft, lists);

  const errors = draftErrors(rows);
  const changed = isChanged(rows, lists);
  const canAdd = rows.filter((row) => !row.removed).length < MAX_SHOPPING_LISTS_PER_HOUSEHOLD;
  const inUse = rows.filter((row) => !row.archived);
  const archived = rows.filter((row) => row.archived);

  function update(key: string, change: Partial<DraftList>): void {
    setDraft(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function addList(): void {
    if (!canAdd) return;

    const key = `new-${nextKey.current}`;
    nextKey.current += 1;
    pendingFocus.current = key;
    setDraft([...rows, newDraftList(key)]);
  }

  function removeList(row: DraftList): void {
    if (row.id === null) setDraft(rows.filter((candidate) => candidate.key !== row.key));
    else update(row.key, { removed: true });
  }

  function close(): void {
    setDraft(null);
    setShowErrors(false);
    setServerError(null);
    setConfirmingDiscard(false);
    onClose();
  }

  function requestClose(): void {
    if (isSaving) return;
    if (changed) setConfirmingDiscard(true);
    else close();
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isSaving) return;
    if (!changed) {
      close();
      return;
    }

    setShowErrors(true);
    const firstInvalid = rows.find((row) => errors.has(row.key));
    if (firstInvalid !== undefined) {
      focusName(rowsRef.current, firstInvalid.key);
      return;
    }

    // The DTO the server enforces has the last word on what is sent.
    const result = validateDto(UpsertShoppingListsDto, toUpsertShoppingLists(rows));
    if (!result.ok) {
      setServerError(result.errors[0]?.messages[0] ?? messages.shoppingListEditor.saveFailed);
      return;
    }

    setServerError(null);
    setSaving(true);
    const error = await pantry.saveShoppingLists(result.value);
    setSaving(false);

    if (error === null) close();
    else setServerError(error);
  }

  const renderRow = (row: DraftList): ReactElement => (
    <ListRow
      key={row.key}
      row={row}
      error={showErrors ? errors.get(row.key) : undefined}
      entryCount={row.id === null ? 0 : pantry.entriesOn(row.id).length}
      disabled={isSaving}
      onNameChange={(name) => update(row.key, { name })}
      onToggleArchived={() => update(row.key, { archived: !row.archived })}
      onRemove={() => removeList(row)}
      onRestore={() => update(row.key, { removed: false })}
    />
  );

  return (
    <Dialog
      open={open}
      onClose={requestClose}
      title={messages.shoppingListEditor.title}
      // On a phone the dialog fills the screen and this takes the buttons' place.
      headerEnd={
        <button type="submit" form={formId} disabled={isSaving} className={SAVE_BUTTON}>
          {isSaving ? messages.shoppingListEditor.saving : messages.shoppingListEditor.save}
        </button>
      }
    >
      {open && (
        <>
          {/* noValidate: the checks below and the shared DTO decide what is valid. */}
          <form
            id={formId}
            noValidate
            onSubmit={(event) => void save(event)}
            className="flex min-h-0 flex-col gap-3"
          >
            <div
              ref={rowsRef}
              className="-mx-1 flex min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-1"
            >
              {rows.length === 0 && (
                <p className="px-1 text-sm text-ink-muted">{messages.shoppingListEditor.empty}</p>
              )}

              {inUse.length > 0 && <ul className="flex flex-col gap-1">{inUse.map(renderRow)}</ul>}

              <div className="flex flex-col items-start gap-1">
                <button
                  type="button"
                  aria-disabled={!canAdd || undefined}
                  aria-describedby={canAdd ? undefined : limitHintId}
                  onClick={addList}
                  className="focus-ring inline-flex h-10 cursor-pointer items-center gap-2 rounded-full ps-2 pe-4 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
                >
                  <Plus aria-hidden="true" className="size-5" />
                  {messages.shoppingListEditor.add}
                </button>
                {!canAdd && (
                  <p id={limitHintId} className="ps-2 text-xs text-ink-muted">
                    {messages.shoppingListEditor.limitReached(MAX_SHOPPING_LISTS_PER_HOUSEHOLD)}
                  </p>
                )}
              </div>

              {archived.length > 0 && (
                <section aria-labelledby={archivedHeadingId} className="flex flex-col gap-1">
                  <h3
                    id={archivedHeadingId}
                    className="px-1 text-xs font-semibold tracking-wide text-ink-muted uppercase"
                  >
                    {messages.shoppingListEditor.archivedHeading}
                  </h3>
                  <p className="px-1 pb-1 text-xs text-ink-muted">
                    {messages.shoppingListEditor.archivedHint}
                  </p>
                  <ul className="flex flex-col gap-1">{archived.map(renderRow)}</ul>
                </section>
              )}
            </div>

            {serverError !== null && (
              <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
                {serverError}
              </p>
            )}

            {/* From `md` up; a phone has these in the header bar. */}
            <div className="hidden justify-end gap-2 md:flex">
              <button
                type="button"
                onClick={requestClose}
                className="focus-ring h-10 cursor-pointer rounded-full px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
              >
                {messages.common.cancel}
              </button>
              <button type="submit" disabled={isSaving} className={SAVE_BUTTON}>
                {isSaving ? messages.shoppingListEditor.saving : messages.shoppingListEditor.save}
              </button>
            </div>
          </form>

          <Dialog
            variant="sheet"
            open={isConfirmingDiscard}
            onClose={() => setConfirmingDiscard(false)}
            title={messages.discardSheet.title}
          >
            <div className="flex flex-col gap-2">
              <button
                type="button"
                onClick={close}
                className="focus-ring h-11 cursor-pointer rounded-xl bg-danger px-4 font-semibold text-surface transition-opacity hover:opacity-90"
              >
                {messages.discardSheet.discard}
              </button>
              <button
                type="button"
                onClick={() => setConfirmingDiscard(false)}
                className="focus-ring h-11 cursor-pointer rounded-xl px-4 font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
              >
                {messages.discardSheet.keepEditing}
              </button>
            </div>
          </Dialog>
        </>
      )}
    </Dialog>
  );
});

interface ListRowProps {
  row: DraftList;
  /** A name problem to show; `undefined` while there is none, or before a save was tried. */
  error: DraftError | undefined;
  /** What is on the list: what a deletion takes with it. */
  entryCount: number;
  disabled: boolean;
  onNameChange: (name: string) => void;
  onToggleArchived: () => void;
  onRemove: () => void;
  onRestore: () => void;
}

function ListRow({
  row,
  error,
  entryCount,
  disabled,
  onNameChange,
  onToggleArchived,
  onRemove,
  onRestore,
}: ListRowProps): ReactElement {
  const errorId = useId();
  const name = displayName(row);

  return (
    <li data-list-key={row.key} className="flex flex-col">
      <div className="flex items-center gap-1">
        {row.removed ? (
          <span className="min-w-0 flex-1 truncate px-3 text-sm text-ink-muted line-through">
            {name}
          </span>
        ) : (
          <input
            value={row.name}
            maxLength={MAX_SHOPPING_LIST_NAME_LENGTH}
            aria-label={messages.shoppingListEditor.name}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : errorId}
            placeholder={row.id === null ? messages.shoppingListEditor.newPlaceholder : undefined}
            disabled={disabled}
            onChange={(event) => onNameChange(event.target.value)}
            className={cn(FIELD_CONTROL, 'min-w-0 flex-1', row.archived && 'text-ink-muted')}
          />
        )}

        {row.removed ? (
          <IconButton
            icon={Undo2}
            label={messages.shoppingListEditor.restore(name)}
            disabled={disabled}
            onClick={onRestore}
            className="text-ink-muted hover:bg-sunken hover:text-ink"
          />
        ) : (
          <>
            <IconButton
              icon={row.archived ? ArchiveRestore : Archive}
              label={
                row.archived
                  ? messages.shoppingListEditor.unarchive(name)
                  : messages.shoppingListEditor.archive(name)
              }
              disabled={disabled}
              onClick={onToggleArchived}
              className="text-ink-muted hover:bg-sunken hover:text-ink"
            />
            <IconButton
              icon={Trash}
              label={messages.shoppingListEditor.remove(name)}
              disabled={disabled}
              onClick={onRemove}
              className="text-ink-muted hover:bg-danger-soft hover:text-danger"
            />
          </>
        )}
      </div>

      {row.removed && (
        <p className="px-3 pb-1 text-sm text-ink-muted">
          {messages.shoppingListEditor.deletedOnSave(entryCount)}
        </p>
      )}

      {error !== undefined && !row.removed && (
        <p id={errorId} className="px-3 pb-1 text-xs text-danger">
          {ERROR_MESSAGES[error]}
        </p>
      )}
    </li>
  );
}
