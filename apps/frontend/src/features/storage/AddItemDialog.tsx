import {
  COUNT_UNIT,
  MAX_ITEM_NAME_LENGTH,
  PANTRY_CATEGORIES,
  type PantryCategory,
} from '@pantry-pal/shared';
import { CreatePantryItemDto, toFieldMessages, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useState, type FormEvent, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { pickerUnits } from './itemDraft';

interface AddItemDialogProps {
  open: boolean;
  onClose: () => void;
  /** The location shown when the dialog opened; the user may pick another. */
  defaultLocationId: string;
}

const EMPTY_DRAFT = {
  name: '',
  quantity: '1',
  unit: COUNT_UNIT,
  category: 'other' as PantryCategory,
  expiresAt: '',
};

export const AddItemDialog = observer(function AddItemDialog({
  open,
  onClose,
  defaultLocationId,
}: AddItemDialogProps): ReactElement {
  const pantry = usePantryStore();
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  /** `null` follows `defaultLocationId`, so the dialog opens on the location being viewed. */
  const [chosenLocationId, setChosenLocationId] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  const locationId = chosenLocationId ?? defaultLocationId;
  const units = pickerUnits(pantry.units, pantry.user?.unitSystem, [draft.unit]);

  function close(): void {
    setDraft(EMPTY_DRAFT);
    setChosenLocationId(null);
    setFieldErrors({});
    setServerError(null);
    onClose();
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // The same DTO class the backend's ValidationPipe enforces: anything accepted
    // here is accepted there, and a rejection costs no round-trip.
    const result = validateDto(CreatePantryItemDto, {
      name: draft.name,
      locationId,
      category: draft.category,
      quantity: Number(draft.quantity),
      unit: draft.unit,
      // The date input yields '' when empty; the API expects null.
      expiresAt: draft.expiresAt === '' ? null : draft.expiresAt,
    });

    if (!result.ok) {
      setFieldErrors(toFieldMessages(result.errors));
      return;
    }

    setFieldErrors({});
    setServerError(null);
    setSubmitting(true);
    const error = await pantry.addItem(result.value);
    setSubmitting(false);

    if (error === null) close();
    else setServerError(error);
  }

  return (
    <Dialog open={open} onClose={close} title={messages.addItem.title}>
      {/* noValidate: the shared DTO is the single source of validation truth. */}
      <form
        noValidate
        onSubmit={(event) => void handleSubmit(event)}
        className="grid grid-cols-2 gap-3"
      >
        <Field label={messages.itemForm.name} error={fieldErrors['name']} className="col-span-2">
          {(props) => (
            <input
              {...props}
              maxLength={MAX_ITEM_NAME_LENGTH}
              placeholder={messages.itemForm.namePlaceholder}
              value={draft.name}
              onChange={(event) => setDraft({ ...draft, name: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        <Field label={messages.itemForm.quantity} error={fieldErrors['quantity']}>
          {(props) => (
            <input
              {...props}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={draft.quantity}
              onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        <Field label={messages.itemForm.unit} error={fieldErrors['unit']}>
          {(props) => (
            <select
              {...props}
              value={draft.unit}
              onChange={(event) => setDraft({ ...draft, unit: event.target.value })}
              className={FIELD_CONTROL}
            >
              {units.map((unit) => (
                <option key={unit.code} value={unit.code}>
                  {unit.label}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label={messages.itemForm.location} error={fieldErrors['locationId']}>
          {(props) => (
            <select
              {...props}
              value={locationId}
              onChange={(event) => setChosenLocationId(event.target.value)}
              className={FIELD_CONTROL}
            >
              {pantry.locations.map((location) => (
                <option key={location.id} value={location.id}>
                  {location.name}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field label={messages.itemForm.category} error={fieldErrors['category']}>
          {(props) => (
            <select
              {...props}
              value={draft.category}
              onChange={(event) =>
                setDraft({ ...draft, category: event.target.value as PantryCategory })
              }
              className={FIELD_CONTROL}
            >
              {PANTRY_CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {messages.categories[category]}
                </option>
              ))}
            </select>
          )}
        </Field>

        <Field
          label={messages.itemForm.expires}
          error={fieldErrors['expiresAt']}
          className="col-span-2"
        >
          {(props) => (
            <input
              {...props}
              type="date"
              value={draft.expiresAt}
              onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        {serverError !== null && (
          <p role="alert" className="col-span-2 text-sm text-danger">
            {serverError}
          </p>
        )}

        <div className="col-span-2 mt-2 flex justify-end gap-2">
          <button
            type="button"
            onClick={close}
            className="focus-ring h-10 cursor-pointer rounded-full px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink"
          >
            {messages.common.cancel}
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60"
          >
            {isSubmitting ? messages.addItem.submitting : messages.addItem.submit}
          </button>
        </div>
      </form>
    </Dialog>
  );
});
