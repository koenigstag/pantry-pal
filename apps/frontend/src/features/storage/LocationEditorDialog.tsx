import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from '@dnd-kit/core';
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import { MAX_LOCATION_NAME_LENGTH, MAX_LOCATIONS_PER_HOUSEHOLD } from '@pantry-pal/shared';
import { UpsertLocationsDto, validateDto } from '@pantry-pal/shared/dto';
import { GripVertical, Plus, Trash, Undo2 } from 'lucide-react';
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
  keptRows,
  moveTarget,
  moveTargets,
  newDraftLocation,
  rebase,
  toDraft,
  toUpsertLocations,
  type DraftError,
  type DraftLocation,
} from './locationDraft';

interface LocationEditorDialogProps {
  open: boolean;
  onClose: () => void;
}

/** Rows only move up and down. */
const restrictToVerticalAxis: Modifier = ({ transform }) => ({ ...transform, x: 0 });
const MODIFIERS = [restrictToVerticalAxis];

const ERROR_MESSAGES: Record<Exclude<DraftError, 'nowhereToMove'>, string> = {
  required: messages.locationEditor.nameRequired,
  duplicate: messages.locationEditor.nameTaken,
};

function displayName(row: DraftLocation): string {
  if (row.removed && row.savedName !== null) return row.savedName;
  return row.name.trim() || row.savedName || messages.locationEditor.unnamed;
}

function focusName(list: HTMLElement | null, key: string): void {
  list?.querySelector<HTMLInputElement>(`[data-location-key="${CSS.escape(key)}"] input`)?.focus();
}

/**
 * Renames, adds, deletes and reorders the household's locations, and saves it
 * all in one request (`PUT .../locations`), so no member ever sees half an edit.
 *
 * The draft is rebased onto the store's locations on every render: whatever
 * other members change while the editor is open shows up in it, and a save the
 * server refuses as stale needs nothing more than a second try. Deleting a
 * location that still holds items asks where they should go.
 */
export const LocationEditorDialog = observer(function LocationEditorDialog({
  open,
  onClose,
}: LocationEditorDialogProps): ReactElement {
  const pantry = usePantryStore();
  /** `null` until the first edit; until then the rows are the store's locations. */
  const [draft, setDraft] = useState<readonly DraftLocation[] | null>(null);
  const [showErrors, setShowErrors] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);
  const [isConfirmingDiscard, setConfirmingDiscard] = useState(false);
  const listRef = useRef<HTMLUListElement>(null);
  const nextKey = useRef(0);
  const pendingFocus = useRef<string | null>(null);
  const announcedOver = useRef<UniqueIdentifier | null>(null);
  const limitHintId = useId();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // A row just added gets focus once it is on screen.
  useEffect(() => {
    const key = pendingFocus.current;
    if (key === null) return;
    pendingFocus.current = null;
    focusName(listRef.current, key);
  });

  const rows = draft === null ? toDraft(pantry.locations) : rebase(draft, pantry.locations);

  const holdsItems = (locationId: string): boolean => pantry.itemsIn(locationId).length > 0;
  const errors = draftErrors(rows, holdsItems);
  const keepsNone = keptRows(rows).length === 0;
  const saved = rows.filter((row) => row.id !== null && !row.removed);
  /** The one saved location left, if only one is: it cannot be deleted. */
  const onlyKey = saved.length === 1 ? saved[0]?.key : undefined;
  const changed = isChanged(rows, pantry.locations);
  const canAdd = rows.filter((row) => !row.removed).length < MAX_LOCATIONS_PER_HOUSEHOLD;

  function update(key: string, change: Partial<DraftLocation>): void {
    setDraft(rows.map((row) => (row.key === key ? { ...row, ...change } : row)));
  }

  function addLocation(): void {
    if (!canAdd) return;

    const key = `new-${nextKey.current}`;
    nextKey.current += 1;
    pendingFocus.current = key;
    setDraft([...rows, newDraftLocation(key)]);
  }

  function removeLocation(row: DraftLocation): void {
    if (row.key === onlyKey) return;
    if (row.id === null) setDraft(rows.filter((candidate) => candidate.key !== row.key));
    else update(row.key, { removed: true });
  }

  function handleDragEnd({ active, over }: DragEndEvent): void {
    if (over === null || active.id === over.id) return;

    const from = rows.findIndex((row) => row.key === active.id);
    const to = rows.findIndex((row) => row.key === over.id);
    if (from !== -1 && to !== -1) setDraft(arrayMove([...rows], from, to));
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
      focusName(listRef.current, firstInvalid.key);
      return;
    }
    if (keepsNone) return;

    // The DTO the server enforces has the last word on what is sent.
    const result = validateDto(UpsertLocationsDto, toUpsertLocations(rows, holdsItems));
    if (!result.ok) {
      setServerError(result.errors[0]?.messages[0] ?? messages.locationEditor.saveFailed);
      return;
    }

    setServerError(null);
    setSaving(true);
    const error = await pantry.saveLocations(result.value);
    setSaving(false);

    if (error === null) close();
    else setServerError(error);
  }

  const nameOf = (id: UniqueIdentifier): string => {
    const row = rows.find((candidate) => candidate.key === id);
    return row === undefined ? '' : displayName(row);
  };
  const positionOf = (id: UniqueIdentifier): number => rows.findIndex((row) => row.key === id) + 1;

  // Positions are read from this render's order, which a drag leaves alone until it ends.
  const announcements: Announcements = {
    onDragStart: ({ active }) => {
      announcedOver.current = active.id;
      return messages.locationEditor.pickedUp(
        nameOf(active.id),
        positionOf(active.id),
        rows.length,
      );
    },
    // Also fires as the drag starts, over the row itself. Announcing that would
    // replace "picked up" before a screen reader got to read it.
    onDragOver: ({ active, over }) => {
      if (over === null || over.id === announcedOver.current) return undefined;
      announcedOver.current = over.id;
      return messages.locationEditor.movedTo(nameOf(active.id), positionOf(over.id), rows.length);
    },
    onDragEnd: ({ active, over }) =>
      over === null
        ? messages.locationEditor.dropCancelled(nameOf(active.id))
        : messages.locationEditor.dropped(nameOf(active.id), positionOf(over.id), rows.length),
    onDragCancel: ({ active }) => messages.locationEditor.dropCancelled(nameOf(active.id)),
  };

  return (
    <Dialog open={open} onClose={requestClose} title={messages.locationEditor.title}>
      {open && (
        <>
          {/* noValidate: the checks below and the shared DTO decide what is valid. */}
          <form
            noValidate
            onSubmit={(event) => void save(event)}
            className="flex min-h-0 flex-col gap-3"
          >
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={MODIFIERS}
              accessibility={{
                announcements,
                screenReaderInstructions: { draggable: messages.locationEditor.dragInstructions },
              }}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={rows.map((row) => row.key)}
                strategy={verticalListSortingStrategy}
              >
                <ul
                  ref={listRef}
                  className="-mx-1 flex min-h-0 flex-col gap-1 overflow-y-auto overscroll-contain p-1"
                >
                  {rows.map((row) => {
                    const error = errors.get(row.key);

                    return (
                      <LocationRow
                        key={row.key}
                        row={row}
                        error={showErrors && error !== 'nowhereToMove' ? error : undefined}
                        itemCount={row.id === null ? 0 : pantry.itemsIn(row.id).length}
                        targets={row.removed ? moveTargets(rows, row) : []}
                        target={row.removed ? moveTarget(rows, row) : null}
                        isOnlyLocation={row.key === onlyKey}
                        disabled={isSaving}
                        onNameChange={(name) => update(row.key, { name })}
                        onRemove={() => removeLocation(row)}
                        onRestore={() => update(row.key, { removed: false })}
                        onTargetChange={(locationId) =>
                          update(row.key, { moveItemsTo: locationId })
                        }
                      />
                    );
                  })}
                </ul>
              </SortableContext>
            </DndContext>

            <div className="flex flex-col items-start gap-1">
              <button
                type="button"
                aria-disabled={!canAdd || undefined}
                aria-describedby={canAdd ? undefined : limitHintId}
                onClick={addLocation}
                className="focus-ring inline-flex h-10 cursor-pointer items-center gap-2 rounded-full ps-2 pe-4 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft aria-disabled:cursor-not-allowed aria-disabled:opacity-50 aria-disabled:hover:bg-transparent"
              >
                <Plus aria-hidden="true" className="size-5" />
                {messages.locationEditor.add}
              </button>
              {!canAdd && (
                <p id={limitHintId} className="ps-2 text-xs text-ink-muted">
                  {messages.locationEditor.limitReached(MAX_LOCATIONS_PER_HOUSEHOLD)}
                </p>
              )}
            </div>

            {showErrors && keepsNone && (
              <p role="alert" className="text-sm text-danger">
                {messages.locationEditor.keepOne}
              </p>
            )}
            {serverError !== null && (
              <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
                {serverError}
              </p>
            )}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="focus-ring h-10 cursor-pointer rounded-full px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
              >
                {messages.common.cancel}
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
              >
                {isSaving ? messages.locationEditor.saving : messages.locationEditor.save}
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

interface LocationRowProps {
  row: DraftLocation;
  /** A name problem to show; `undefined` while there is none, or before a save was tried. */
  error: Exclude<DraftError, 'nowhereToMove'> | undefined;
  /** Active items in the location: what a deletion has to move. */
  itemCount: number;
  /** A removed row's choice of where its items go. */
  targets: readonly DraftLocation[];
  target: string | null;
  /** The last saved location left, which cannot be deleted; new rows do not count. */
  isOnlyLocation: boolean;
  disabled: boolean;
  onNameChange: (name: string) => void;
  onRemove: () => void;
  onRestore: () => void;
  onTargetChange: (locationId: string) => void;
}

function LocationRow({
  row,
  error,
  itemCount,
  targets,
  target,
  isOnlyLocation,
  disabled,
  onNameChange,
  onRemove,
  onRestore,
  onTargetChange,
}: LocationRowProps): ReactElement {
  const errorId = useId();
  const onlyHintId = useId();
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: row.key,
    // A row marked for deletion stays in place: the others can pass it, it cannot move.
    disabled: { draggable: row.removed || disabled, droppable: false },
    attributes: { roleDescription: messages.locationEditor.sortable },
  });
  const name = displayName(row);

  return (
    <li
      ref={setNodeRef}
      data-location-key={row.key}
      style={{
        transform:
          transform === null ? undefined : `translate3d(${transform.x}px, ${transform.y}px, 0)`,
        transition,
      }}
      className={cn('flex flex-col rounded-xl bg-surface', isDragging && 'relative z-10 shadow-lg')}
    >
      <div className="flex items-center gap-1">
        {/* touch-none: a finger on the handle drags the row instead of scrolling the list. */}
        <button
          ref={setActivatorNodeRef}
          type="button"
          {...attributes}
          {...listeners}
          aria-label={messages.locationEditor.reorder(name)}
          className="focus-ring flex size-10 shrink-0 cursor-grab touch-none items-center justify-center rounded-full text-ink-muted transition-colors hover:bg-sunken hover:text-ink active:cursor-grabbing aria-disabled:cursor-default aria-disabled:opacity-40 aria-disabled:hover:bg-transparent"
        >
          <GripVertical aria-hidden="true" className="size-5" />
        </button>

        {row.removed ? (
          <span className="min-w-0 flex-1 truncate px-3 text-sm text-ink-muted line-through">
            {name}
          </span>
        ) : (
          <input
            value={row.name}
            maxLength={MAX_LOCATION_NAME_LENGTH}
            aria-label={messages.locationEditor.name}
            aria-invalid={error !== undefined}
            aria-describedby={error === undefined ? undefined : errorId}
            placeholder={row.id === null ? messages.locationEditor.newPlaceholder : undefined}
            disabled={disabled}
            onChange={(event) => onNameChange(event.target.value)}
            className={cn(FIELD_CONTROL, 'min-w-0 flex-1')}
          />
        )}

        {row.removed ? (
          <IconButton
            icon={Undo2}
            label={messages.locationEditor.restore(name)}
            disabled={disabled}
            onClick={onRestore}
            className="text-ink-muted hover:bg-sunken hover:text-ink"
          />
        ) : (
          // aria-disabled rather than disabled: it stays focusable and says why.
          <IconButton
            icon={Trash}
            label={messages.locationEditor.remove(name)}
            title={isOnlyLocation ? messages.locationEditor.keepOne : undefined}
            aria-disabled={isOnlyLocation || undefined}
            aria-describedby={isOnlyLocation ? onlyHintId : undefined}
            disabled={disabled}
            onClick={isOnlyLocation ? undefined : onRemove}
            className="text-ink-muted hover:bg-danger-soft hover:text-danger aria-disabled:cursor-not-allowed aria-disabled:hover:bg-transparent aria-disabled:hover:text-ink-muted"
          />
        )}
        {isOnlyLocation && (
          <span id={onlyHintId} className="sr-only">
            {messages.locationEditor.keepOne}
          </span>
        )}
      </div>

      {row.removed && (
        <div className="ps-11 pe-11 pb-2 text-sm text-ink-muted">
          {itemCount === 0 ? (
            messages.locationEditor.deletedOnSave
          ) : target === null ? (
            <span className="text-danger">{messages.locationEditor.nowhereToMove(itemCount)}</span>
          ) : (
            <label className="flex flex-col gap-1">
              {messages.locationEditor.moveItemsTo(itemCount)}
              <select
                value={target}
                disabled={disabled}
                onChange={(event) => onTargetChange(event.target.value)}
                className={FIELD_CONTROL}
              >
                {targets.map((candidate) => (
                  <option key={candidate.key} value={candidate.id ?? ''}>
                    {displayName(candidate)}
                  </option>
                ))}
              </select>
            </label>
          )}
        </div>
      )}

      {error !== undefined && (
        <p id={errorId} className="ps-11 pe-11 pb-1 text-xs text-danger">
          {ERROR_MESSAGES[error]}
        </p>
      )}
    </li>
  );
}
