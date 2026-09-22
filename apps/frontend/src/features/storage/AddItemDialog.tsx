import { DEFAULT_CATEGORY } from '@pantry-pal/shared';
import { CreatePantryItemDto, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import {
  emptyDraft,
  ruleErrors,
  toCreate,
  toPatch,
  type DraftField,
  type ItemDraft,
} from './itemDraft';
import { ItemEditForm } from './ItemEditForm';
import { itemFieldErrors } from './itemFieldErrors';

interface AddItemDialogProps {
  open: boolean;
  onClose: () => void;
  /** The location shown when the dialog opened; the user may pick another. */
  defaultLocationId: string;
}

/** A new item has no other member's save to collide with. */
const NO_CONFLICTS: readonly DraftField[] = [];

/**
 * A new item, entered in the form that edits an existing one (`ItemEditForm`)
 * and in the same full-screen dialog, so both offer every field and validate
 * alike — here against `CreatePantryItemDto`.
 *
 * Closing a form that has anything typed into it asks first.
 */
export const AddItemDialog = observer(function AddItemDialog({
  open,
  onClose,
  defaultLocationId,
}: AddItemDialogProps): ReactElement {
  const pantry = usePantryStore();
  const formId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  /** `null` until the first change: until then the form shows an empty item in `defaultLocationId`. */
  const [edited, setEdited] = useState<ItemDraft | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  const [isConfirmingDiscard, setConfirmingDiscard] = useState(false);

  const blank = emptyDraft(defaultLocationId, pantry.categoryEdible(DEFAULT_CATEGORY));
  const draft = edited ?? blank;
  const isDirty = Object.keys(toPatch(blank, draft)).length > 0;

  // As when the details switch to editing: a keyboard or mouse user starts on
  // the name, while on a touch screen, where that would pop the keyboard up,
  // focus goes to the title.
  useEffect(() => {
    if (!open) return;

    const dialog = contentRef.current?.closest('dialog');
    const firstField = dialog?.querySelector<HTMLElement>('form :is(input, select, textarea)');
    if (firstField && window.matchMedia('(pointer: fine)').matches) firstField.focus();
    else dialog?.querySelector<HTMLElement>('[data-dialog-title]')?.focus();
  }, [open]);

  function close(): void {
    setEdited(null);
    setErrors({});
    setServerError(null);
    setConfirmingDiscard(false);
    onClose();
  }

  function requestClose(): void {
    if (isSubmitting) return;
    if (isDirty) setConfirmingDiscard(true);
    else close();
  }

  async function submit(): Promise<void> {
    // The same DTO the server enforces, plus the rules it cannot state: anything
    // accepted here is accepted there, and a rejection costs no round-trip.
    const result = validateDto(CreatePantryItemDto, toCreate(draft));
    const found = {
      ...(result.ok ? {} : itemFieldErrors(result.errors, 1)),
      ...ruleErrors(draft),
    };
    if (!result.ok || Object.keys(found).length > 0) {
      setErrors(found);
      requestAnimationFrame(() => {
        contentRef.current
          ?.closest('dialog')
          ?.querySelector<HTMLElement>('form [aria-invalid="true"]')
          ?.focus();
      });
      return;
    }

    setErrors({});
    setServerError(null);
    setSubmitting(true);
    const error = await pantry.addItem(result.value);
    setSubmitting(false);

    if (error === null) close();
    else setServerError(error);
  }

  return (
    <Dialog
      open={open}
      variant="fullscreen"
      onClose={requestClose}
      title={messages.addItem.title}
      titleAlign="center"
      headerEnd={
        <button
          type="submit"
          form={formId}
          disabled={isSubmitting}
          className="focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50"
        >
          {isSubmitting ? messages.addItem.submitting : messages.addItem.submit}
        </button>
      }
    >
      <div ref={contentRef} className="contents">
        {serverError !== null && (
          <p
            role="alert"
            className="mx-4 mt-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger md:mx-6"
          >
            {serverError}
          </p>
        )}

        <ItemEditForm
          id={formId}
          draft={draft}
          errors={errors}
          conflicts={NO_CONFLICTS}
          disabled={isSubmitting}
          isNew
          onChange={setEdited}
          onSubmit={() => void submit()}
        />
      </div>

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
    </Dialog>
  );
});
