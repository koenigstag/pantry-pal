import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { FIELD_CONTROL, type FieldControlProps } from '../../ui/Field';
import { groupByKind, nounCount, pickerUnits } from './itemDraft';

interface SizeInputProps {
  /** From `Field`: labels the number, and describes both controls with the hint and error. */
  controlProps: FieldControlProps;
  value: string;
  unit: string;
  valueInvalid: boolean;
  unitInvalid: boolean;
  onValueChange: (value: string) => void;
  onUnitChange: (unit: string) => void;
}

/**
 * What one of them holds — the `400 g` of a can — as a number and a unit of any
 * kind, grouped by kind. Both or neither: `ruleErrors` says which half is missing.
 */
export const SizeInput = observer(function SizeInput({
  controlProps,
  value,
  unit,
  valueInvalid,
  unitInvalid,
  onValueChange,
  onUnitChange,
}: SizeInputProps): ReactElement {
  const pantry = usePantryStore();
  const units = pickerUnits(pantry.units, pantry.user?.unitSystem, unit);

  return (
    <div className="flex gap-2">
      <input
        {...controlProps}
        aria-invalid={valueInvalid}
        type="number"
        min="0"
        step="any"
        inputMode="decimal"
        value={value}
        onChange={(event) => onValueChange(event.target.value)}
        className={cn(FIELD_CONTROL, 'min-w-0 flex-1')}
      />
      <select
        aria-label={messages.itemForm.sizeUnit}
        aria-invalid={unitInvalid}
        aria-describedby={controlProps['aria-describedby']}
        value={unit}
        onChange={(event) => onUnitChange(event.target.value)}
        // `max-w-*`, not `w-*`: FIELD_CONTROL already sets `w-full`.
        className={cn(FIELD_CONTROL, 'max-w-32 shrink-0')}
      >
        <option value="">{messages.itemForm.noSizeUnit}</option>
        {groupByKind(units).map((group) => (
          <optgroup key={group.kind} label={messages.units.kinds[group.kind]}>
            {group.units.map((candidate) => (
              <option key={candidate.code} value={candidate.code}>
                {pantry.unitName(candidate.code, nounCount(value))}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </div>
  );
});
