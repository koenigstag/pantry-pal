import {
  MIN_BIRTH_DATE,
  UNIT_SYSTEM_PREFERENCES,
  type UnitSystemPreference,
} from '@pantry-pal/shared';
import { X } from 'lucide-react';
import { useId, useRef, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { cn } from '../../ui/cn';
import { Field, FIELD_CONTROL, type FieldControlProps } from '../../ui/Field';
import { IconButton } from '../../ui/IconButton';
import { todayIsoDate } from '../storage/itemDraft';
import type { DetailsDraft } from './details';

interface DetailsFieldsProps {
  draft: DetailsDraft;
  errors: Readonly<Record<string, string>>;
  onChange: (patch: Partial<DetailsDraft>) => void;
  /** Left out for anyone who is not the household's owner. */
  showHouseholdName: boolean;
}

/**
 * The account's details as fields: name, date of birth, units and the
 * household's name. The onboarding step and the Profile page both use them.
 */
export function DetailsFields({
  draft,
  errors,
  onChange,
  showHouseholdName,
}: DetailsFieldsProps): ReactElement {
  return (
    <>
      <Field
        label={messages.details.name}
        hint={messages.details.nameHint}
        error={errors['displayName']}
      >
        {(props) => (
          <input
            {...props}
            type="text"
            autoComplete="name"
            value={draft.displayName}
            onChange={(event) => onChange({ displayName: event.target.value })}
            className={FIELD_CONTROL}
          />
        )}
      </Field>

      <Field
        label={messages.details.birthDate}
        hint={messages.details.birthDateHint}
        error={errors['birthDate']}
      >
        {(props) => (
          <BirthDateInput
            controlProps={props}
            value={draft.birthDate}
            onChange={(birthDate) => onChange({ birthDate })}
          />
        )}
      </Field>

      <UnitSystemField
        value={draft.unitSystem}
        onChange={(unitSystem) => onChange({ unitSystem })}
      />

      {showHouseholdName && (
        <Field label={messages.details.householdName} error={errors['householdName']}>
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="off"
              value={draft.householdName}
              onChange={(event) => onChange({ householdName: event.target.value })}
              className={FIELD_CONTROL}
            />
          )}
        </Field>
      )}
    </>
  );
}

interface BirthDateInputProps {
  controlProps: FieldControlProps;
  value: string;
  onChange: (value: string) => void;
}

/**
 * A native date input with a clear button, which a phone's date picker does not
 * reliably offer. The button replaces itself, so clearing hands focus back to
 * the input.
 */
function BirthDateInput({ controlProps, value, onChange }: BirthDateInputProps): ReactElement {
  const inputRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex gap-2">
      <input
        {...controlProps}
        ref={inputRef}
        type="date"
        autoComplete="bday"
        min={MIN_BIRTH_DATE}
        max={todayIsoDate()}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={cn(FIELD_CONTROL, 'min-w-0 flex-1')}
      />
      {value !== '' && (
        <IconButton
          icon={X}
          label={messages.details.clearBirthDate}
          onClick={() => {
            onChange('');
            inputRef.current?.focus();
          }}
          className="border border-line text-ink-muted hover:bg-sunken hover:text-ink"
        />
      )}
    </div>
  );
}

interface UnitSystemFieldProps {
  value: UnitSystemPreference;
  onChange: (value: UnitSystemPreference) => void;
}

/** Two choices side by side, each with the units it brings, so the names need no explaining. */
function UnitSystemField({ value, onChange }: UnitSystemFieldProps): ReactElement {
  const name = useId();

  return (
    <fieldset className="flex min-w-0 flex-col">
      <legend className="mb-1 text-xs font-medium text-ink-muted">{messages.details.units}</legend>
      <div className="grid grid-cols-2 gap-2">
        {UNIT_SYSTEM_PREFERENCES.map((system) => (
          <label
            key={system}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2 transition-colors',
              value === system ? 'border-accent bg-accent-soft' : 'border-line hover:bg-sunken',
            )}
          >
            <input
              type="radio"
              name={name}
              value={system}
              checked={value === system}
              onChange={() => onChange(system)}
              className="focus-ring mt-0.5 size-4 shrink-0 cursor-pointer accent-accent"
            />
            <span className="flex min-w-0 flex-col text-sm font-medium">
              {messages.details.unitSystems[system].name}
              <span className="text-xs font-normal text-ink-muted">
                {messages.details.unitSystems[system].examples}
              </span>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
