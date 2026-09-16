import { toFieldMessages, UpdatePantryItemDto, validateDto } from '@pantry-pal/shared/dto';
import { ArrowLeft, SquarePen } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';
import { useBlocker, useLocation, useNavigate, useOutletContext } from 'react-router';

import { messages } from '../../i18n/messages';
import { usePantryStore, useQuantities } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import { NoticeRegion } from '../shell/NoticeRegion';
import { wasOpenedFromList, type StorageOutletContext } from './itemDetailsNavigation';
import { ItemDetailsView } from './ItemDetailsView';
import { sizeErrors, toDraft, toPatch, todayIsoDate, type ItemDraft } from './itemDraft';
import { ItemEditForm } from './ItemEditForm';
import { useStorageParams } from './useStorageParams';

interface EditState {
  /** The item as the form first showed it: the patch is what changed since. */
  base: ItemDraft;
  draft: ItemDraft;
  errors: Readonly<Record<string, string>>;
}

/**
 * `/storage/:locationId/items/:itemId` — an item's details over its location's
 * list, full screen on a phone.
 *
 * The URL makes the back button close it and a reload keep it open. Closing
 * pops the history entry the card's link pushed, or replaces the URL when the
 * details were opened directly. While the edit form has unsaved changes, any
 * way out — Escape, the backdrop, Cancel, the back button — asks first.
 *
 * Nothing here is optimistic: a save waits for the server and shows its error
 * in the dialog, which covers the page's notices.
 */
export const ItemDetailsDialog = observer(function ItemDetailsDialog(): ReactElement | null {
  const pantry = usePantryStore();
  const quantities = useQuantities();
  const params = useStorageParams();
  const { openRemoveSheet } = useOutletContext<StorageOutletContext>();
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const formId = useId();

  const [edit, setEdit] = useState<EditState | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [isConfirmingCancel, setConfirmingCancel] = useState(false);
  const closing = useRef(false);

  const item = pantry.items.find((candidate) => candidate.id === params.itemId);
  const isDirty =
    item !== undefined && edit !== null && Object.keys(toPatch(edit.base, edit.draft)).length > 0;
  const blocker = useBlocker(isDirty);

  function close(): void {
    if (closing.current) return;
    closing.current = true;

    if (wasOpenedFromList(routerLocation.state)) {
      void navigate(-1);
    } else if (params.locationId !== undefined) {
      void navigate(params.locationLink(params.locationId), { replace: true });
    }
  }

  // Deleted, consumed or discarded — here or by another member: nothing to show.
  const isGone = item === undefined;
  useEffect(() => {
    if (isGone) close();
  });

  if (item === undefined) return null;

  const startEditing = (): void => {
    const base = toDraft(item, quantities.quantityOf(item));
    setEdit({ base, draft: base, errors: {} });
    setServerError(null);
  };

  const cancelEditing = (): void => {
    if (isDirty) setConfirmingCancel(true);
    else setEdit(null);
  };

  const save = async (): Promise<void> => {
    if (edit === null) return;

    const patch = toPatch(edit.base, edit.draft);
    if (Object.keys(patch).length === 0) {
      setEdit(null);
      return;
    }

    // The same DTO the server enforces, plus the size-pair rule it checks separately.
    const result = validateDto(UpdatePantryItemDto, patch);
    const errors = {
      ...(result.ok ? {} : toFieldMessages(result.errors)),
      ...sizeErrors(edit.draft),
    };
    if (!result.ok || Object.keys(errors).length > 0) {
      setEdit({ ...edit, errors });
      return;
    }

    setServerError(null);
    setBusy(true);
    // The typed quantity replaces any stepper tap still waiting to be sent.
    if (patch.quantity !== undefined) quantities.discard(item.id);
    const error = await pantry.updateItem(item.id, result.value);
    setBusy(false);

    if (error === null) setEdit(null);
    else setServerError(error);
  };

  const markOpened = async (): Promise<void> => {
    setServerError(null);
    setBusy(true);
    const error = await pantry.updateItem(item.id, { openedAt: todayIsoDate() });
    setBusy(false);
    if (error !== null) setServerError(error);
  };

  const isDiscardSheetOpen = blocker.state === 'blocked' || isConfirmingCancel;

  const discardChanges = (): void => {
    if (blocker.state === 'blocked') {
      blocker.proceed();
      return;
    }
    setConfirmingCancel(false);
    setEdit(null);
  };

  const keepEditing = (): void => {
    if (blocker.state === 'blocked') blocker.reset();
    closing.current = false;
    setConfirmingCancel(false);
  };

  return (
    <Dialog
      open
      variant="fullscreen"
      onClose={close}
      title={edit === null ? item.name : messages.itemDetails.editTitle}
      titleAlign={edit === null ? 'start' : 'center'}
      headerStart={
        edit === null ? undefined : (
          <button
            type="button"
            onClick={cancelEditing}
            className="focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full ps-2 pe-3 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            <ArrowLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            {messages.common.back}
          </button>
        )
      }
      headerEnd={
        edit === null ? (
          <button
            type="button"
            onClick={startEditing}
            className="focus-ring inline-flex h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold text-accent transition-colors hover:bg-accent-soft"
          >
            <SquarePen aria-hidden="true" className="size-4" />
            {messages.itemDetails.edit}
          </button>
        ) : (
          <button
            type="submit"
            form={formId}
            disabled={isBusy}
            className="focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isBusy ? messages.itemDetails.saving : messages.itemDetails.save}
          </button>
        )
      }
    >
      {serverError !== null && (
        <p
          role="alert"
          className="mx-4 mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger md:mx-6"
        >
          {serverError}
        </p>
      )}

      {edit === null ? (
        <ItemDetailsView
          item={item}
          isBusy={isBusy}
          onMarkOpened={() => void markOpened()}
          onRemove={openRemoveSheet}
        />
      ) : (
        <ItemEditForm
          id={formId}
          draft={edit.draft}
          errors={edit.errors}
          disabled={isBusy}
          onChange={(draft) => setEdit({ ...edit, draft })}
          onSubmit={() => void save()}
        />
      )}

      <NoticeRegion placement="dialog" />

      <Dialog
        variant="sheet"
        open={isDiscardSheetOpen}
        onClose={keepEditing}
        title={messages.discardSheet.title}
      >
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={discardChanges}
            className="focus-ring h-11 cursor-pointer rounded-xl bg-danger px-4 font-semibold text-surface transition-opacity hover:opacity-90"
          >
            {messages.discardSheet.discard}
          </button>
          <button
            type="button"
            onClick={keepEditing}
            className="focus-ring h-11 cursor-pointer rounded-xl px-4 font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            {messages.discardSheet.keepEditing}
          </button>
        </div>
      </Dialog>
    </Dialog>
  );
});
