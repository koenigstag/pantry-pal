import {
  MAX_ITEM_NAME_LENGTH,
  PANTRY_CATEGORIES,
  PANTRY_UNITS,
  titleCase,
  type PantryCategory,
  type PantryUnit,
} from '@pantry-pal/shared';
import { CreatePantryItemDto, toFieldMessages, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useState, type FormEvent, type ReactElement } from 'react';

import { usePantryStore } from '../stores/StoreContext';

const EMPTY = {
  name: '',
  quantity: '1',
  unit: 'pcs' as PantryUnit,
  category: 'other' as PantryCategory,
  expiresAt: '',
};

export const AddItemForm = observer(function AddItemForm(): ReactElement {
  const pantry = usePantryStore();
  const [draft, setDraft] = useState(EMPTY);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();

    // Validated against the very same DTO class the backend's ValidationPipe
    // uses, so anything accepted here is accepted there. A rejection costs no
    // network round-trip.
    const result = validateDto(CreatePantryItemDto, {
      name: draft.name.trim(),
      quantity: Number(draft.quantity),
      unit: draft.unit,
      category: draft.category,
      // The date input yields '' when empty; the API expects null.
      expiresAt: draft.expiresAt === '' ? null : draft.expiresAt,
    });

    if (!result.ok) {
      setFieldErrors(toFieldMessages(result.errors));
      return;
    }

    setFieldErrors({});
    setSubmitting(true);
    const created = await pantry.addItem(result.value);
    setSubmitting(false);

    if (created) setDraft(EMPTY);
  }

  function errorFor(field: string): ReactElement | null {
    const message = fieldErrors[field];
    return message === undefined ? null : <em className="field__error">{message}</em>;
  }

  return (
    // noValidate: the shared DTO is the single source of validation truth, so
    // the browser's own constraint UI would only duplicate (and disagree with) it.
    <form className="form" noValidate onSubmit={(event) => void handleSubmit(event)}>
      <div className="form__row">
        <label className="field field--grow">
          <span>Item</span>
          <input
            maxLength={MAX_ITEM_NAME_LENGTH}
            placeholder="Whole milk"
            aria-invalid={fieldErrors['name'] !== undefined}
            value={draft.name}
            onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          />
          {errorFor('name')}
        </label>

        <label className="field field--narrow">
          <span>Qty</span>
          <input
            type="number"
            aria-invalid={fieldErrors['quantity'] !== undefined}
            value={draft.quantity}
            onChange={(event) => setDraft({ ...draft, quantity: event.target.value })}
          />
        </label>

        <label className="field field--narrow">
          <span>Unit</span>
          <select
            value={draft.unit}
            onChange={(event) => setDraft({ ...draft, unit: event.target.value as PantryUnit })}
          >
            {PANTRY_UNITS.map((unit) => (
              <option key={unit} value={unit}>
                {unit}
              </option>
            ))}
          </select>
        </label>
      </div>

      {errorFor('quantity')}

      <div className="form__row">
        <label className="field field--grow">
          <span>Category</span>
          <select
            value={draft.category}
            onChange={(event) =>
              setDraft({ ...draft, category: event.target.value as PantryCategory })
            }
          >
            {PANTRY_CATEGORIES.map((category) => (
              <option key={category} value={category}>
                {titleCase(category)}
              </option>
            ))}
          </select>
        </label>

        <label className="field field--grow">
          <span>Expires</span>
          <input
            type="date"
            aria-invalid={fieldErrors['expiresAt'] !== undefined}
            value={draft.expiresAt}
            onChange={(event) => setDraft({ ...draft, expiresAt: event.target.value })}
          />
          {errorFor('expiresAt')}
        </label>

        <button className="button" type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Adding…' : 'Add item'}
        </button>
      </div>
    </form>
  );
});
