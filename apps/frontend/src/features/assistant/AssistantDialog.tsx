import {
  MAX_ASSISTANT_TEXT_LENGTH,
  type AssistantAction,
  type AssistantInterpretation,
} from '@pantry-pal/shared';
import { ArrowLeft } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { useNotices, usePantryStore } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import { actionLine } from './actionLines';

const QUIET_BUTTON =
  'focus-ring h-10 cursor-pointer rounded-full px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON =
  'focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50 aria-disabled:cursor-not-allowed aria-disabled:opacity-50';

/** What the user wrote, kept on this device until it is applied: per household, since names differ. */
const draftKey = (householdId: string): string => `pantry-pal:assistant-draft:${householdId}`;

function readDraft(householdId: string | null): string {
  if (householdId === null) return '';
  try {
    return localStorage.getItem(draftKey(householdId)) ?? '';
  } catch {
    return '';
  }
}

function writeDraft(householdId: string | null, text: string): void {
  if (householdId === null) return;
  try {
    if (text === '') localStorage.removeItem(draftKey(householdId));
    else localStorage.setItem(draftKey(householdId), text);
  } catch {
    // Storage blocked: the draft lasts as long as the page.
  }
}

/** The text being written, or the assistant's reading of it with the changes still ticked. */
type View =
  | { kind: 'write' }
  | { kind: 'preview'; interpretation: AssistantInterpretation; kept: ReadonlySet<number> };

const WRITING: View = { kind: 'write' };

interface AssistantDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The text assistant: people write what they did or what a storage space holds,
 * and see what the assistant made of it as tickable changes, then apply the
 * ones they keep. Nothing is saved before Apply.
 *
 * Both steps need the server. The text is kept on this device as a draft until
 * it is applied, so writing offline, or closing the sheet, loses nothing.
 */
export const AssistantDialog = observer(function AssistantDialog({
  open,
  onClose,
}: AssistantDialogProps): ReactElement {
  const pantry = usePantryStore();
  const notices = useNotices();
  const formId = useId();
  const textId = useId();
  const [text, setText] = useState(() => readDraft(pantry.householdId));
  const [view, setView] = useState<View>(WRITING);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Another household's draft once the household changes.
  const householdId = pantry.householdId;
  useEffect(() => {
    setText(readDraft(householdId));
    setView(WRITING);
  }, [householdId]);

  function changeText(next: string): void {
    setText(next);
    writeDraft(householdId, next);
    setError(null);
  }

  function close(): void {
    if (isBusy) return;
    setView(WRITING);
    setError(null);
    onClose();
  }

  async function interpret(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (isBusy || text.trim() === '' || !pantry.isOnline) return;

    setBusy(true);
    setError(null);
    const result = await pantry.interpretText(text.trim());
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    const { actions } = result.value;
    setView({
      kind: 'preview',
      interpretation: result.value,
      kept: new Set(actions.map((_, index) => index)),
    });
  }

  async function apply(): Promise<void> {
    if (view.kind !== 'preview' || isBusy) return;
    const kept: AssistantAction[] = view.interpretation.actions.filter((_, index) =>
      view.kept.has(index),
    );
    if (kept.length === 0) return;

    setBusy(true);
    setError(null);
    const result = await pantry.applyAssistant(kept);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    changeText('');
    setView(WRITING);
    onClose();
    notices.info(messages.assistant.applied(result.value.applied));
  }

  function toggle(index: number): void {
    if (view.kind !== 'preview') return;
    const kept = new Set(view.kept);
    if (kept.has(index)) kept.delete(index);
    else kept.add(index);
    setView({ ...view, kept });
  }

  const t = messages.assistant;
  const canInterpret = text.trim() !== '' && pantry.isOnline;
  const keptCount = view.kind === 'preview' ? view.kept.size : 0;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={t.title}
      headerStart={
        view.kind === 'preview' ? (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => {
              setView(WRITING);
              setError(null);
            }}
            className="focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full ps-2 pe-3 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            {messages.common.back}
          </button>
        ) : undefined
      }
      headerEnd={
        view.kind === 'write' ? (
          <button
            type="submit"
            form={formId}
            aria-disabled={!canInterpret || isBusy || undefined}
            className={PRIMARY_BUTTON}
          >
            {isBusy ? t.interpreting : t.interpret}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void apply()}
            disabled={keptCount === 0 || isBusy}
            className={PRIMARY_BUTTON}
          >
            {isBusy ? t.applying : t.applyShort}
          </button>
        )
      }
    >
      <div className="flex flex-1 flex-col gap-4">
        {view.kind === 'write' ? (
          <form
            id={formId}
            noValidate
            onSubmit={(event) => void interpret(event)}
            className="flex flex-1 flex-col gap-3"
          >
            <label htmlFor={textId} className="text-sm text-ink-muted">
              {t.intro}
            </label>
            <textarea
              id={textId}
              value={text}
              onChange={(event) => changeText(event.target.value)}
              maxLength={MAX_ASSISTANT_TEXT_LENGTH}
              rows={6}
              readOnly={isBusy}
              placeholder={t.placeholder}
              className="min-h-36 w-full resize-y rounded-xl border border-line bg-surface px-4 py-3 text-ink placeholder:text-ink-muted focus-visible:ring-2 focus-visible:ring-accent focus-visible:outline-none focus-visible:ring-inset"
            />
            <p className="text-end text-xs text-ink-muted" aria-live="polite">
              {t.length(text.length, MAX_ASSISTANT_TEXT_LENGTH)}
            </p>
            {!pantry.isOnline && <p className="text-sm text-ink-muted">{t.offline}</p>}
            <Feedback error={error} />
            <Actions>
              <button type="button" onClick={close} disabled={isBusy} className={QUIET_BUTTON}>
                {messages.common.close}
              </button>
              <button
                type="submit"
                aria-disabled={!canInterpret || isBusy || undefined}
                className={PRIMARY_BUTTON}
              >
                {isBusy ? t.interpreting : t.interpret}
              </button>
            </Actions>
          </form>
        ) : (
          <>
            <Preview
              interpretation={view.interpretation}
              kept={view.kept}
              disabled={isBusy}
              onToggle={toggle}
            />
            <Feedback error={error} />
            <Actions>
              <button
                type="button"
                onClick={() => setView(WRITING)}
                disabled={isBusy}
                className={QUIET_BUTTON}
              >
                {t.editText}
              </button>
              <button
                type="button"
                onClick={() => void apply()}
                disabled={keptCount === 0 || isBusy}
                className={PRIMARY_BUTTON}
              >
                {isBusy ? t.applying : t.apply(keptCount)}
              </button>
            </Actions>
          </>
        )}
      </div>
    </Dialog>
  );
});

interface PreviewProps {
  interpretation: AssistantInterpretation;
  kept: ReadonlySet<number>;
  disabled: boolean;
  onToggle: (index: number) => void;
}

/**
 * One tickable line per proposed change, then what was not understood. It
 * replaces the text box, so its heading takes focus.
 */
const Preview = observer(function Preview({
  interpretation,
  kept,
  disabled,
  onToggle,
}: PreviewProps): ReactElement {
  const pantry = usePantryStore();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const t = messages.assistant;

  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <h3 ref={headingRef} tabIndex={-1} className="font-semibold focus:outline-none">
        {interpretation.actions.length === 0 ? t.nothingFound : t.preview}
      </h3>

      {interpretation.actions.length > 0 && (
        <ul className="flex flex-col gap-2">
          {interpretation.actions.map((action, index) => {
            const line = actionLine(action, pantry);
            return (
              // The index is the proposal's identity: the list never changes order.
              // oxlint-disable-next-line react/no-array-index-key
              <li key={index}>
                <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-line px-4 py-3 transition-colors hover:bg-sunken has-disabled:cursor-not-allowed">
                  <input
                    type="checkbox"
                    checked={kept.has(index)}
                    disabled={disabled}
                    onChange={() => onToggle(index)}
                    className="mt-1 size-4 shrink-0 accent-accent"
                  />
                  <span className="flex min-w-0 flex-col gap-0.5">
                    <span className="font-medium">{line.title}</span>
                    {line.details.length > 0 && (
                      <span className="text-sm text-ink-muted">{line.details.join(' · ')}</span>
                    )}
                    {action.quote !== '' && (
                      <span className="text-xs text-ink-muted italic">
                        {t.quoted(action.quote)}
                      </span>
                    )}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      {interpretation.unresolved.length > 0 && (
        <section className="flex flex-col gap-2">
          <h4 className="text-sm font-semibold text-ink-muted">{t.unresolved}</h4>
          <ul className="flex flex-col gap-2 text-sm">
            {interpretation.unresolved.map((part, index) => (
              // Read-only and never reordered, so the index is a stable key.
              // oxlint-disable-next-line react/no-array-index-key
              <li key={index} className="rounded-xl bg-sunken px-4 py-3">
                {part.quote !== '' && <p className="italic">{t.quoted(part.quote)}</p>}
                <p className="text-ink-muted">{part.reason ?? t.unresolvedReason}</p>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
});

/** From `md` up, at the foot of the dialog; a phone has the primary action in the header bar. */
function Actions({ children }: { children: ReactElement | ReactElement[] }): ReactElement {
  return <div className="mt-auto hidden justify-end gap-2 pt-2 md:flex">{children}</div>;
}

function Feedback({ error }: { error: string | null }): ReactElement | null {
  if (error === null) return null;
  return (
    <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
      {error}
    </p>
  );
}
