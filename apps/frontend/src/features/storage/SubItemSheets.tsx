import {
  freshSubItemState,
  FULL_FILL_PERCENT,
  ITEM_STATUS,
  MAX_ITEM_QUANTITY,
  MAX_PERIOD_AFTER_OPENING_DAYS,
  type PantryItem,
  type SubItemState,
} from '@pantry-pal/shared';
import { NewSubItemDto, validateDto } from '@pantry-pal/shared/dto';
import {
  CalendarDays,
  Eraser,
  Gauge,
  PackageCheck,
  PackageOpen,
  PackageX,
  Trash,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useState, type FormEvent, type ReactElement } from 'react';

import { formatPercent } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import type { SubItemPatch } from '../../stores/PantryStore';
import { useNotices, usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Dialog } from '../../ui/Dialog';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { SheetButton } from '../../ui/SheetButton';
import { todayIsoDate } from './itemDraft';
import { DateInput, QuantityInput } from './ItemEditForm';
import { itemFieldErrors } from './itemFieldErrors';
import { CancelButton } from './ItemSheets';
import type { SubItemGroup } from './subItemGroups';

/** How finely the slider sets how much is left. The API takes any whole percent. */
const FILL_STEP = 5;

const PRIMARY_BUTTON =
  'focus-ring h-11 cursor-pointer rounded-xl bg-accent px-4 font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';

interface GroupSheetProps {
  item: PantryItem;
  /** The row whose sheet is open; `undefined` keeps it closed. */
  group: SubItemGroup | undefined;
  title: string;
  onClose: () => void;
  onFill: () => void;
  onChangeDates: () => void;
  /** The item's last unit leaves as the item does: through the remove sheet, as from the card. */
  onRemoveItem: () => void;
}

/**
 * What a row of units offers. Each action takes one of them: the first of the
 * row, which is the one to use first. Writes are local, so the sheet closes at
 * once and a failure comes back as a notice.
 */
export const GroupSheet = observer(function GroupSheet({
  item,
  group,
  title,
  onClose,
  onFill,
  onChangeDates,
  onRemoveItem,
}: GroupSheetProps): ReactElement {
  const pantry = usePantryStore();
  const notices = useNotices();
  const first = group?.units[0];
  const count = group?.units.length ?? 0;
  const t = messages.subItems;

  async function run(write: () => Promise<string | null>): Promise<void> {
    onClose();
    const failure = await write();
    if (failure !== null) notices.error(failure);
  }

  function change(patch: SubItemPatch): void {
    if (first === undefined) return;
    void run(() => pantry.changeSubItems(item.id, [first.id], patch));
  }

  return (
    <Dialog variant="sheet" open={first !== undefined} onClose={onClose} title={title}>
      {first !== undefined && (
        <div className="flex flex-col gap-2">
          {first.openedAt === null && (
            <SheetButton
              icon={PackageOpen}
              label={t.openToday(count)}
              onClick={() => change({ openedAt: todayIsoDate() })}
            />
          )}
          <SheetButton icon={Gauge} label={t.howMuchLeft} onClick={onFill} />
          <SheetButton icon={CalendarDays} label={t.changeDates} onClick={onChangeDates} />
          {/* The item's only unit on the shelf: it leaves with the item, as the card's bin says. */}
          {item.quantity <= 1 ? (
            <SheetButton
              icon={Trash}
              tone="danger"
              label={messages.itemDetails.remove}
              onClick={onRemoveItem}
            />
          ) : (
            <>
              <SheetButton
                icon={PackageCheck}
                label={t.usedUp(count)}
                onClick={() => change({ status: ITEM_STATUS.Consumed })}
              />
              <SheetButton
                icon={PackageX}
                label={t.threwOut(count)}
                onClick={() => change({ status: ITEM_STATUS.Discarded })}
              />
              <SheetButton
                icon={Eraser}
                tone="danger"
                label={t.deleteOne(count)}
                hint={t.deleteHint}
                onClick={() => void run(() => pantry.deleteSubItem(item.id, first.id))}
              />
            </>
          )}
          <CancelButton onClick={onClose} />
        </div>
      )}
    </Dialog>
  );
});

interface FillSheetProps {
  item: PantryItem;
  /** The row whose first unit is being measured; `undefined` keeps it closed. */
  group: SubItemGroup | undefined;
  onClose: () => void;
}

/**
 * How much is left of one unit of the row, the first: the tube in use, not its
 * spares. A partly used unit has been opened, so an unopened one set below full
 * is opened today, and the sheet says so.
 */
export const FillSheet = observer(function FillSheet({
  item,
  group,
  onClose,
}: FillSheetProps): ReactElement {
  const first = group?.units[0];

  return (
    <Dialog
      variant="sheet"
      open={first !== undefined}
      onClose={onClose}
      title={messages.subItems.howMuchLeft}
    >
      {first !== undefined && (
        <FillForm
          key={first.id}
          itemId={item.id}
          unitId={first.id}
          initial={first.fillPercent}
          isOpened={first.openedAt !== null}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
});

function FillForm({
  itemId,
  unitId,
  initial,
  isOpened,
  onDone,
}: {
  itemId: string;
  unitId: string;
  initial: number;
  isOpened: boolean;
  onDone: () => void;
}): ReactElement {
  const pantry = usePantryStore();
  const [value, setValue] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  async function save(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (value === initial) {
      onDone();
      return;
    }
    setBusy(true);
    const patch: SubItemPatch =
      isOpened || value === FULL_FILL_PERCENT
        ? { fillPercent: value }
        : { fillPercent: value, openedAt: todayIsoDate() };
    const failure = await pantry.changeSubItems(itemId, [unitId], patch);
    setBusy(false);
    if (failure === null) onDone();
    else setError(failure);
  }

  return (
    <form onSubmit={(event) => void save(event)} className="flex flex-col gap-3">
      {error !== null && <ErrorMessage message={error} />}
      <FillInput value={value} onChange={setValue} />
      {!isOpened && (
        <p className="text-center text-sm text-ink-muted">
          {messages.subItems.opensToday(formatPercent(FULL_FILL_PERCENT))}
        </p>
      )}
      <button type="submit" disabled={isBusy} className={cn(PRIMARY_BUTTON, 'mt-2')}>
        {messages.itemDetails.save}
      </button>
      <CancelButton onClick={onDone} />
    </form>
  );
}

/** A slider in steps of `FILL_STEP`, its value written out large above it. */
function FillInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (value: number) => void;
}): ReactElement {
  // A value set elsewhere in finer steps shows on the step below it, never at 0.
  const shown = Math.max(FILL_STEP, Math.floor(value / FILL_STEP) * FILL_STEP);

  return (
    <div className="flex flex-col items-stretch gap-2">
      <output className="text-center text-3xl font-semibold tabular-nums">
        {formatPercent(value)}
      </output>
      <input
        type="range"
        min={FILL_STEP}
        max={FULL_FILL_PERCENT}
        step={FILL_STEP}
        value={shown}
        aria-label={messages.subItems.howMuchLeft}
        aria-valuetext={formatPercent(value)}
        onChange={(event) => onChange(Number(event.target.value))}
        className="focus-ring h-10 w-full cursor-pointer accent-accent"
      />
    </div>
  );
}

/** Adding units to an item, or changing the dates of some or all of a row's. */
export type UnitsForm = { mode: 'add' } | { mode: 'change'; group: SubItemGroup };

interface UnitsFormSheetProps {
  item: PantryItem;
  /** What the sheet is doing; `undefined` keeps it closed. */
  form: UnitsForm | undefined;
  onClose: () => void;
}

/**
 * Units in a state of their own: new ones, starting as the stepper's plus
 * would add them — partly used, if they come opened — or the dates of some of
 * a row's units: all of them unless fewer are chosen, so changing one of three
 * splits the row. How much is left of a unit already there is the row's own
 * action (`FillSheet`).
 */
export const UnitsFormSheet = observer(function UnitsFormSheet({
  item,
  form,
  onClose,
}: UnitsFormSheetProps): ReactElement {
  const t = messages.subItems;

  return (
    <Dialog
      variant="sheet"
      open={form !== undefined}
      onClose={onClose}
      title={form?.mode === 'change' ? t.changeTitle : t.addTitle}
    >
      {form !== undefined && (
        <UnitsFormContent
          key={form.mode === 'change' ? form.group.key : 'add'}
          item={item}
          form={form}
          onDone={onClose}
        />
      )}
    </Dialog>
  );
});

/** The form's state, every field as its input holds it. */
interface UnitsDraft {
  count: string;
  expiresAt: string;
  openedAt: string;
  periodAfterOpeningDays: string;
  fillPercent: number;
}

function toDraft(state: SubItemState, count: number): UnitsDraft {
  return {
    count: String(count),
    expiresAt: state.expiresAt ?? '',
    openedAt: state.openedAt ?? '',
    periodAfterOpeningDays:
      state.periodAfterOpeningDays === null ? '' : String(state.periodAfterOpeningDays),
    fillPercent: state.fillPercent,
  };
}

/** The draft as a unit's state; invalid numbers are `NaN`, which the DTO refuses. */
function toState(draft: UnitsDraft): SubItemState {
  const days = draft.periodAfterOpeningDays.trim();
  return {
    expiresAt: draft.expiresAt === '' ? null : draft.expiresAt,
    openedAt: draft.openedAt === '' ? null : draft.openedAt,
    periodAfterOpeningDays: days === '' ? null : Number(days),
    // Only an opened unit can be partly used.
    fillPercent: draft.openedAt === '' ? FULL_FILL_PERCENT : draft.fillPercent,
  };
}

function UnitsFormContent({
  item,
  form,
  onDone,
}: {
  item: PantryItem;
  form: UnitsForm;
  onDone: () => void;
}): ReactElement {
  const pantry = usePantryStore();
  const t = messages.subItems;
  const isAdding = form.mode === 'add';
  const base: SubItemState = isAdding
    ? freshSubItemState(item)
    : (form.group.units[0] ?? freshSubItemState(item));
  const most = isAdding ? MAX_ITEM_QUANTITY - item.quantity : form.group.units.length;

  const [draft, setDraft] = useState(() => toDraft(base, isAdding ? 1 : most));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [isBusy, setBusy] = useState(false);

  function update(changes: Partial<UnitsDraft>): void {
    setDraft({ ...draft, ...changes });
  }

  /**
   * What the draft changes on the row's units: nothing until a date differs. The
   * fill changes only with the opened date: not opened after all, a unit is full.
   */
  function patchFor(state: SubItemState): SubItemPatch {
    const patch: SubItemPatch = {};
    for (const field of [
      'expiresAt',
      'openedAt',
      'periodAfterOpeningDays',
      'fillPercent',
    ] as const) {
      if (state[field] !== base[field]) Object.assign(patch, { [field]: state[field] });
    }
    return patch;
  }
  // Changing a row's dates needs a date to change: how many only says where it goes.
  const canSave = isAdding || Object.keys(patchFor(toState(draft))).length > 0;

  function countField(label: string, hint: string | undefined): ReactElement {
    return (
      <Field label={label} hint={hint} error={errors['count']} className="col-span-2">
        {(props) => (
          <QuantityInput
            controlProps={props}
            min={1}
            max={most}
            value={draft.count}
            onChange={(count) => update({ count })}
          />
        )}
      </Field>
    );
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();

    const state = toState(draft);
    const count = Number(draft.count);
    // The DTO the server enforces, plus the rules it cannot state.
    const result = validateDto(NewSubItemDto, state);
    const found: Record<string, string> = result.ok ? {} : itemFieldErrors(result.errors, 1);
    if (!Number.isInteger(count) || count < 1 || count > most) {
      found['count'] = messages.fieldErrors.quantity(1, most);
    }
    if (state.openedAt !== null && state.openedAt > todayIsoDate()) {
      found['openedAt'] = messages.fieldErrors.openedInFuture;
    }
    setErrors(found);
    if (Object.keys(found).length > 0) return;

    setServerError(null);
    setBusy(true);
    const failure = isAdding
      ? await pantry.addSubItems(item.id, count, state)
      : await changeRow(form.group, count, state);
    setBusy(false);
    if (failure === null) onDone();
    else setServerError(failure);
  }

  /** The first `count` of the row take the fields that differ from what the row shares. */
  function changeRow(
    group: SubItemGroup,
    count: number,
    state: SubItemState,
  ): Promise<string | null> {
    const patch = patchFor(state);
    if (Object.keys(patch).length === 0) return Promise.resolve(null);

    const ids = group.units.slice(0, count).map((unit) => unit.id);
    return pantry.changeSubItems(item.id, ids, patch);
  }

  return (
    <form noValidate onSubmit={(event) => void submit(event)} className="flex flex-col gap-4">
      {serverError !== null && <ErrorMessage message={serverError} />}

      <fieldset disabled={isBusy} className="grid grid-cols-2 gap-x-3 gap-y-4">
        {isAdding && most > 1 && countField(messages.itemForm.howMany, undefined)}

        <Field label={messages.itemForm.expires} error={errors['expiresAt']} className="col-span-2">
          {(props) => (
            <DateInput
              controlProps={props}
              value={draft.expiresAt}
              onChange={(expiresAt) => update({ expiresAt })}
              clearLabel={messages.itemForm.clearExpires}
            />
          )}
        </Field>

        <Field label={messages.itemForm.opened} error={errors['openedAt']} className="col-span-2">
          {(props) => (
            <DateInput
              controlProps={props}
              value={draft.openedAt}
              // Not opened after all: full again, as the server makes it.
              onChange={(openedAt) =>
                update(
                  openedAt === '' ? { openedAt, fillPercent: FULL_FILL_PERCENT } : { openedAt },
                )
              }
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

        {/* A unit added already started; one already here is measured from its row. */}
        {isAdding && draft.openedAt !== '' && (
          <div className="col-span-2 flex flex-col gap-1">
            <span className="text-sm font-medium">{t.howMuchLeft}</span>
            <FillInput
              value={draft.fillPercent}
              onChange={(fillPercent) => update({ fillPercent })}
            />
            {errors['fillPercent'] !== undefined && (
              <span className="text-sm text-danger">{errors['fillPercent']}</span>
            )}
          </div>
        )}

        {!isAdding && most > 1 && countField(t.applyTo, t.outOf(most))}
      </fieldset>

      <div className="flex flex-col gap-2">
        <button type="submit" disabled={isBusy || !canSave} className={PRIMARY_BUTTON}>
          {isAdding ? t.add : messages.itemDetails.save}
        </button>
        <CancelButton onClick={onDone} />
      </div>
    </form>
  );
}

function ErrorMessage({ message }: { message: string }): ReactElement {
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
      {message}
    </p>
  );
}
