import {
  COUNT_UNIT,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_NOTES_LENGTH,
  MAX_PERIOD_AFTER_OPENING_DAYS,
  PANTRY_CATEGORIES,
  type PantryCategory,
} from '@pantry-pal/shared';
import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { Field, FIELD_CONTROL, FIELD_TEXTAREA } from '../../ui/Field';
import { pickerUnits, type ItemDraft } from './itemDraft';

interface ItemEditFormProps {
  /** Lets the Save button in the dialog header submit this form. */
  id: string;
  draft: ItemDraft;
  errors: Readonly<Record<string, string>>;
  disabled: boolean;
  onChange: (draft: ItemDraft) => void;
  onSubmit: () => void;
}

/**
 * Every field `UpdatePantryItemDto` accepts. Controlled: the dialog owns the
 * draft, because it also decides what is dirty and guards leaving with changes.
 */
export const ItemEditForm = observer(function ItemEditForm({
  id,
  draft,
  errors,
  disabled,
  onChange,
  onSubmit,
}: ItemEditFormProps): ReactElement {
  const pantry = usePantryStore();
  const units = pickerUnits(pantry.units, pantry.user?.unitSystem, [draft.unit, draft.sizeUnit]);
  const isCounted = draft.unit === COUNT_UNIT;

  function update(changes: Partial<ItemDraft>): void {
    onChange({ ...draft, ...changes });
  }

  return (
    // noValidate: the shared DTO is the single source of validation truth.
    <form
      id={id}
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSubmit();
      }}
      className="mx-auto w-full max-w-2xl p-4 md:p-6"
    >
      <fieldset disabled={disabled} className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-4">
        <Field label={messages.itemForm.name} error={errors['name']} className="col-span-2">
          {(props) => (
            <input
              {...props}
              maxLength={MAX_ITEM_NAME_LENGTH}
              value={draft.name}
              onChange={(event) => update({ name: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        <Field
          label={messages.itemForm.location}
          error={errors['locationId']}
          className="col-span-2 sm:col-span-1"
        >
          {(props) => (
            <select
              {...props}
              value={draft.locationId}
              onChange={(event) => update({ locationId: event.target.value })}
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

        <Field
          label={messages.itemForm.category}
          error={errors['category']}
          className="col-span-2 sm:col-span-1"
        >
          {(props) => (
            <select
              {...props}
              value={draft.category}
              onChange={(event) => update({ category: event.target.value as PantryCategory })}
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

        <Field label={messages.itemForm.quantity} error={errors['quantity']}>
          {(props) => (
            <input
              {...props}
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={draft.quantity}
              onChange={(event) => update({ quantity: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        <Field label={messages.itemForm.unit} error={errors['unit']}>
          {(props) => (
            <select
              {...props}
              value={draft.unit}
              onChange={(event) => {
                const unit = event.target.value;
                // A size only exists for counted things; leaving `pcs` clears it.
                update(unit === COUNT_UNIT ? { unit } : { unit, sizeValue: '', sizeUnit: '' });
              }}
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

        {isCounted && (
          <>
            <Field
              label={messages.itemForm.sizeValue}
              hint={messages.itemForm.sizeHint}
              error={errors['sizeValue']}
            >
              {(props) => (
                <input
                  {...props}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={draft.sizeValue}
                  onChange={(event) => update({ sizeValue: event.target.value })}
                  className={FIELD_CONTROL}
                />
              )}
            </Field>

            <Field label={messages.itemForm.sizeUnit} error={errors['sizeUnit']}>
              {(props) => (
                <select
                  {...props}
                  value={draft.sizeUnit}
                  onChange={(event) => update({ sizeUnit: event.target.value })}
                  className={FIELD_CONTROL}
                >
                  <option value="">{messages.itemForm.noSizeUnit}</option>
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.label}
                    </option>
                  ))}
                </select>
              )}
            </Field>
          </>
        )}

        <Field
          label={messages.itemForm.expires}
          error={errors['expiresAt']}
          className="col-span-2 sm:col-span-1"
        >
          {(props) => (
            <input
              {...props}
              type="date"
              value={draft.expiresAt}
              onChange={(event) => update({ expiresAt: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        <Field
          label={messages.itemForm.opened}
          error={errors['openedAt']}
          className="col-span-2 sm:col-span-1"
        >
          {(props) => (
            <input
              {...props}
              type="date"
              value={draft.openedAt}
              onChange={(event) => update({ openedAt: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        <Field
          label={messages.itemForm.periodAfterOpening}
          error={errors['periodAfterOpeningDays']}
          className="col-span-2 sm:col-span-1"
        >
          {(props) => (
            <input
              {...props}
              type="number"
              min="1"
              max={MAX_PERIOD_AFTER_OPENING_DAYS}
              step="1"
              inputMode="numeric"
              value={draft.periodAfterOpeningDays}
              onChange={(event) => update({ periodAfterOpeningDays: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        <Field label={messages.itemForm.notes} error={errors['notes']} className="col-span-2">
          {(props) => (
            <textarea
              {...props}
              rows={4}
              maxLength={MAX_ITEM_NOTES_LENGTH}
              value={draft.notes}
              onChange={(event) => update({ notes: event.target.value })}
              className={FIELD_TEXTAREA}
            />
          )}
        </Field>
      </fieldset>
    </form>
  );
});
