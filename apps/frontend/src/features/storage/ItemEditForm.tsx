import {
  DEFAULT_CATEGORY,
  MAX_ITEM_NAME_LENGTH,
  MAX_ITEM_NOTES_LENGTH,
  MAX_ITEM_QUANTITY,
  MAX_PERIOD_AFTER_OPENING_DAYS,
} from '@pantry-pal/shared';
import { Minus, Plus, X } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useRef, type ReactElement } from 'react';

import { formatList } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Field, FIELD_CONTROL, FIELD_TEXTAREA, type FieldControlProps } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { DETAILS_GRID, DetailsSection, ItemPhoto } from './detailsLayout';
import {
  draftFieldLabel,
  isQuantityUnit,
  nounCount,
  pickerUnits,
  todayIsoDate,
  type DraftField,
  type ItemDraft,
} from './itemDraft';
import { SizeInput } from './SizeInput';

interface ItemEditFormProps {
  /** Lets the Save or Add button in the dialog header submit this form. */
  id: string;
  draft: ItemDraft;
  errors: Readonly<Record<string, string>>;
  /** Fields another member changed differently while this form was open. */
  conflicts: readonly DraftField[];
  disabled: boolean;
  /** The least the quantity steps down to: 0 for an item being used up, 1 for a new one. */
  minQuantity?: number;
  onChange: (draft: ItemDraft) => void;
  onSubmit: () => void;
}

/** Outlined buttons beside a control, as tall as the control itself. */
const SIDE_BUTTON = 'border border-line text-ink-muted hover:bg-sunken hover:text-ink';

/**
 * Every field of an item, for editing one (`ItemDetailsDialog`) or adding one
 * (`AddItemDialog`), in the same layout and sections as the details view, so
 * switching modes keeps everything in place. Controlled: the dialog owns the
 * draft, because it also decides what is dirty, which DTO validates it, and
 * whether leaving needs a confirmation.
 */
export const ItemEditForm = observer(function ItemEditForm({
  id,
  draft,
  errors,
  conflicts,
  disabled,
  minQuantity = 0,
  onChange,
  onSubmit,
}: ItemEditFormProps): ReactElement {
  const pantry = usePantryStore();
  const unitSystem = pantry.user?.unitSystem;
  // Counted in a count unit; the size (`SizeInput`) may be of any kind: `2 cans × 400 g`.
  const quantityUnits = pickerUnits(pantry.units, unitSystem, draft.unit).filter(isQuantityUnit);
  // The draft's own category stays listed even when it is not among those loaded:
  // added by an admin since, or the list failed to load.
  const categoryCodes = pantry.categories.map((category) => category.code);
  if (!categoryCodes.includes(draft.category)) categoryCodes.push(draft.category);

  function update(changes: Partial<ItemDraft>): void {
    onChange({ ...draft, ...changes });
  }

  // Only the default category lets an item choose; any other decides for it.
  const canSetEdible = draft.category === DEFAULT_CATEGORY;

  /** Into the default category the item keeps its value; into any other it takes that one's. */
  function changeCategory(code: string): void {
    update(
      code === DEFAULT_CATEGORY
        ? { category: code }
        : { category: code, isEdible: pantry.categoryEdible(code) },
    );
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
      className={DETAILS_GRID}
    >
      <ItemPhoto className="hidden md:flex" />

      <fieldset disabled={disabled} className="flex min-w-0 flex-col gap-4">
        {conflicts.length > 0 && (
          // `<output>` is a status region: the notice is announced when it appears.
          <output className="block rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
            {messages.itemForm.conflict(formatList([...new Set(conflicts.map(draftFieldLabel))]))}
          </output>
        )}

        <DetailsSection title={messages.itemDetails.details}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <Field label={messages.itemForm.name} error={errors['name']} className="col-span-2">
              {(props) => (
                <input
                  {...props}
                  maxLength={MAX_ITEM_NAME_LENGTH}
                  autoComplete="off"
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
                  onChange={(event) => changeCategory(event.target.value)}
                  className={FIELD_CONTROL}
                >
                  {categoryCodes.map((code) => (
                    <option key={code} value={code}>
                      {pantry.categoryName(code)}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            {/* Only where the item decides: any other category states the value itself. */}
            {canSetEdible && (
              <label className="col-span-2 flex w-fit cursor-pointer items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={draft.isEdible}
                  onChange={(event) => update({ isEdible: event.target.checked })}
                  className="focus-ring size-4.5 cursor-pointer accent-accent"
                />
                {messages.itemForm.edible}
              </label>
            )}
          </div>
        </DetailsSection>

        <DetailsSection title={messages.itemDetails.quantity}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <Field
              label={messages.itemForm.howMany}
              error={errors['quantity']}
              className="col-span-2 sm:col-span-1"
            >
              {(props) => (
                <QuantityInput
                  controlProps={props}
                  min={minQuantity}
                  value={draft.quantity}
                  onChange={(quantity) => update({ quantity })}
                />
              )}
            </Field>

            <Field
              label={messages.itemForm.unit}
              error={errors['unit']}
              className="col-span-2 sm:col-span-1"
            >
              {(props) => (
                <select
                  {...props}
                  value={draft.unit}
                  onChange={(event) => update({ unit: event.target.value })}
                  className={FIELD_CONTROL}
                >
                  {quantityUnits.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {pantry.unitName(unit.code, nounCount(draft.quantity))}
                    </option>
                  ))}
                </select>
              )}
            </Field>

            <Field
              label={messages.itemForm.sizeValue}
              hint={messages.itemForm.sizeHint}
              error={errors['sizeValue'] ?? errors['sizeUnit']}
              className="col-span-2"
            >
              {(props) => (
                <SizeInput
                  controlProps={props}
                  value={draft.sizeValue}
                  unit={draft.sizeUnit}
                  valueInvalid={errors['sizeValue'] !== undefined}
                  unitInvalid={errors['sizeUnit'] !== undefined}
                  onValueChange={(sizeValue) => update({ sizeValue })}
                  onUnitChange={(sizeUnit) => update({ sizeUnit })}
                />
              )}
            </Field>
          </div>
        </DetailsSection>

        <DetailsSection title={messages.itemDetails.expiry}>
          <div className="grid grid-cols-2 gap-x-3 gap-y-4">
            <Field
              label={messages.itemForm.expires}
              error={errors['expiresAt']}
              className="col-span-2 sm:col-span-1"
            >
              {(props) => (
                <DateInput
                  controlProps={props}
                  value={draft.expiresAt}
                  onChange={(expiresAt) => update({ expiresAt })}
                  clearLabel={messages.itemForm.clearExpires}
                />
              )}
            </Field>

            <Field
              label={messages.itemForm.opened}
              error={errors['openedAt']}
              className="col-span-2 sm:col-span-1"
            >
              {(props) => (
                <DateInput
                  controlProps={props}
                  value={draft.openedAt}
                  onChange={(openedAt) => update({ openedAt })}
                  clearLabel={messages.itemForm.clearOpened}
                  max={todayIsoDate()}
                  todayLabel={messages.itemForm.openedToday}
                />
              )}
            </Field>

            <Field
              label={messages.itemForm.periodAfterOpening}
              error={errors['periodAfterOpeningDays']}
              className="col-span-2"
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
                  className={cn(FIELD_CONTROL, 'sm:max-w-40')}
                />
              )}
            </Field>
          </div>
        </DetailsSection>

        <DetailsSection title={messages.itemDetails.notes}>
          <Field label={messages.itemForm.notes} hideLabel error={errors['notes']}>
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
        </DetailsSection>
      </fieldset>
    </form>
  );
});

interface QuantityInputProps {
  controlProps: FieldControlProps;
  min: number;
  value: string;
  onChange: (value: string) => void;
}

/** A whole number with − and + beside it, like the stepper on the cards. */
function QuantityInput({ controlProps, min, value, onChange }: QuantityInputProps): ReactElement {
  const quantity = Number(value);
  const isWhole = value.trim() !== '' && Number.isInteger(quantity);

  return (
    <div className="flex gap-2">
      <IconButton
        icon={Minus}
        label={messages.itemForm.decreaseQuantity}
        disabled={!isWhole || quantity <= min}
        onClick={() => onChange(String(quantity - 1))}
        className={SIDE_BUTTON}
      />
      <input
        {...controlProps}
        type="number"
        min={min}
        max={MAX_ITEM_QUANTITY}
        step="1"
        inputMode="numeric"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_CONTROL, 'no-spinner min-w-0 text-center tabular-nums')}
      />
      <IconButton
        icon={Plus}
        label={messages.itemForm.increaseQuantity}
        disabled={!isWhole || quantity >= MAX_ITEM_QUANTITY}
        onClick={() => onChange(String(quantity + 1))}
        className={SIDE_BUTTON}
      />
    </div>
  );
}

interface DateInputProps {
  controlProps: FieldControlProps;
  value: string;
  onChange: (value: string) => void;
  clearLabel: string;
  max?: string;
  /** Offers a one-tap "today" while the date is empty. */
  todayLabel?: string;
}

/**
 * A native date input with a clear button, which a phone's date picker does not
 * reliably offer. The button that replaced itself hands focus back to the input.
 */
function DateInput({
  controlProps,
  value,
  onChange,
  clearLabel,
  max,
  todayLabel,
}: DateInputProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  function set(next: string): void {
    onChange(next);
    inputRef.current?.focus();
  }

  return (
    <div className="flex gap-2">
      <input
        {...controlProps}
        ref={inputRef}
        type="date"
        max={max}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_CONTROL, 'min-w-0 flex-1')}
      />
      {value !== '' && (
        <IconButton icon={X} label={clearLabel} onClick={() => set('')} className={SIDE_BUTTON} />
      )}
      {value === '' && todayLabel !== undefined && (
        <button
          type="button"
          onClick={() => set(todayIsoDate())}
          className={cn(
            'focus-ring h-10 shrink-0 cursor-pointer rounded-lg px-3 text-sm font-medium transition-colors',
            SIDE_BUTTON,
          )}
        >
          {todayLabel}
        </button>
      )}
    </div>
  );
}
