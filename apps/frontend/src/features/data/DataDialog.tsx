import {
  IMPORT_SOURCE,
  IMPORT_SOURCES,
  MAX_IMPORT_FILE_BYTES,
  MAX_ITEM_QUANTITY,
  type ImportSource,
  type ImportSummary,
} from '@pantry-pal/shared';
import {
  ArchiveRestore,
  ArrowLeft,
  ChefHat,
  CircleCheck,
  Download,
  FileSpreadsheet,
  Upload,
  type LucideIcon,
} from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';

import { formatNumber } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import { SheetButton } from '../../ui/SheetButton';
import { todayIsoDate } from '../storage/itemDraft';
import { saveFile } from './saveFile';

/** The menu, the list of sources, or one source's import. */
type View = 'menu' | 'sources' | ImportSource;

const SOURCE_ICONS: Readonly<Record<ImportSource, LucideIcon>> = {
  [IMPORT_SOURCE.PantryPal]: ArchiveRestore,
  [IMPORT_SOURCE.KitchenPal]: ChefHat,
};

/** .xlsx, by extension and by type: file pickers filter by one or the other. */
const ACCEPT = '.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const BYTES_PER_KB = 1024;
const BYTES_PER_MB = 1024 * 1024;

const QUIET_BUTTON =
  'focus-ring h-10 cursor-pointer rounded-full px-4 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50';
const PRIMARY_BUTTON =
  'focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-50';

const isSource = (view: View): view is ImportSource =>
  (IMPORT_SOURCES as readonly string[]).includes(view);

interface DataDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * The household's data, out and in: Export saves a backup, and Import picks a
 * source, then a file. The steps are views of one dialog, full-screen on a
 * phone, so Back walks up them and closing from any of them returns to the
 * page. While a file is on its way, nothing closes or goes back: the import
 * would carry on unseen.
 */
export const DataDialog = observer(function DataDialog({
  open,
  onClose,
}: DataDialogProps): ReactElement {
  const pantry = usePantryStore();
  const formId = useId();
  const contentRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<View>('menu');
  const [file, setFile] = useState<File | null>(null);
  const [isBusy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  function show(next: View): void {
    setView(next);
    setFile(null);
    setError(null);
    setStatus(null);
    setSummary(null);
  }

  // Every opening starts at the menu.
  function close(): void {
    if (isBusy) return;
    show('menu');
    onClose();
  }

  async function exportBackup(): Promise<void> {
    if (isBusy) return;
    setBusy(true);
    setError(null);
    setStatus(null);
    const result = await pantry.exportBackup();
    setBusy(false);

    const dialog = contentRef.current?.closest('dialog');
    if (!result.ok) setError(result.error);
    else if (dialog) {
      saveFile(result.value, `pantry-pal-backup-${todayIsoDate()}.xlsx`, dialog);
      setStatus(messages.data.exported);
    }
  }

  async function importFile(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (file === null || isBusy || !isSource(view)) return;
    // The server would refuse it too, after the whole upload.
    if (file.size > MAX_IMPORT_FILE_BYTES) {
      setError(messages.data.errors.tooLarge(MAX_IMPORT_FILE_BYTES / BYTES_PER_MB));
      return;
    }

    setBusy(true);
    setError(null);
    const result = await pantry.importFile(view, file);
    setBusy(false);
    if (result.ok) setSummary(result.value);
    else setError(result.error);
  }

  const source = isSource(view) ? view : null;
  const back: View | null = source !== null ? 'sources' : view === 'sources' ? 'menu' : null;
  const title =
    source !== null
      ? messages.data.sources[source].name
      : view === 'sources'
        ? messages.data.importFrom
        : messages.data.title;

  return (
    <Dialog
      open={open}
      onClose={close}
      title={title}
      headerStart={
        back === null || summary !== null ? undefined : (
          <button
            type="button"
            disabled={isBusy}
            onClick={() => show(back)}
            className="focus-ring inline-flex h-10 cursor-pointer items-center gap-1.5 rounded-full ps-2 pe-3 text-sm font-medium text-ink-muted transition-colors hover:bg-sunken hover:text-ink disabled:cursor-not-allowed disabled:opacity-50"
          >
            <ArrowLeft aria-hidden="true" className="size-5 rtl:-scale-x-100" />
            {messages.common.back}
          </button>
        )
      }
      headerEnd={
        source === null ? undefined : summary === null ? (
          <button
            type="submit"
            form={formId}
            disabled={file === null || isBusy}
            className={PRIMARY_BUTTON}
          >
            {isBusy ? messages.data.submitting : messages.data.submit}
          </button>
        ) : (
          <button type="button" onClick={close} className={PRIMARY_BUTTON}>
            {messages.data.done}
          </button>
        )
      }
    >
      <div ref={contentRef} className="flex flex-1 flex-col gap-4">
        {view === 'menu' && (
          <>
            <div className="flex flex-col gap-2">
              <SheetButton
                icon={Upload}
                label={messages.data.import}
                hint={messages.data.importHint}
                unavailable={isBusy}
                onClick={() => show('sources')}
              />
              <SheetButton
                icon={Download}
                label={isBusy ? messages.data.exporting : messages.data.export}
                hint={messages.data.exportHint}
                unavailable={isBusy}
                onClick={() => void exportBackup()}
              />
            </div>
            <Feedback error={error} status={status} />
            <Actions>
              <button type="button" onClick={close} disabled={isBusy} className={QUIET_BUTTON}>
                {messages.common.close}
              </button>
            </Actions>
          </>
        )}

        {view === 'sources' && (
          <>
            <div className="flex flex-col gap-2">
              {IMPORT_SOURCES.map((candidate) => (
                <SheetButton
                  key={candidate}
                  icon={SOURCE_ICONS[candidate]}
                  label={messages.data.sources[candidate].name}
                  hint={messages.data.sources[candidate].hint}
                  onClick={() => show(candidate)}
                />
              ))}
            </div>
            <Actions>
              <button type="button" onClick={() => show('menu')} className={QUIET_BUTTON}>
                {messages.common.back}
              </button>
            </Actions>
          </>
        )}

        {source !== null && summary === null && (
          <form
            id={formId}
            noValidate
            onSubmit={(event) => void importFile(event)}
            className="flex flex-1 flex-col gap-4"
          >
            <ol className="flex list-decimal flex-col gap-1 ps-5 text-sm text-ink-muted">
              {messages.data.sources[source].steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>

            <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-line px-4 py-3 transition-colors hover:bg-sunken has-disabled:cursor-not-allowed has-disabled:opacity-60 has-focus-visible:outline-2 has-focus-visible:outline-offset-2 has-focus-visible:outline-current">
              <FileSpreadsheet aria-hidden="true" className="size-6 shrink-0 text-ink-muted" />
              <span className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-medium">
                  {file?.name ?? messages.data.chooseFile}
                </span>
                <span className="text-sm text-ink-muted">
                  {file === null
                    ? messages.data.fileHint
                    : messages.data.fileSize(Math.max(1, Math.round(file.size / BYTES_PER_KB)))}
                </span>
              </span>
              <input
                type="file"
                accept={ACCEPT}
                disabled={isBusy}
                onChange={(event) => {
                  setFile(event.target.files?.[0] ?? null);
                  setError(null);
                }}
                className="sr-only"
              />
            </label>

            <p className="text-sm text-ink-muted">{messages.data.sources[source].note}</p>
            <Feedback error={error} status={null} />

            <Actions>
              <button
                type="button"
                onClick={() => show('sources')}
                disabled={isBusy}
                className={QUIET_BUTTON}
              >
                {messages.common.back}
              </button>
              <button type="submit" disabled={file === null || isBusy} className={PRIMARY_BUTTON}>
                {isBusy ? messages.data.submitting : messages.data.submit}
              </button>
            </Actions>
          </form>
        )}

        {summary !== null && (
          <>
            <SummaryView summary={summary} />
            <Actions>
              <button type="button" onClick={close} className={PRIMARY_BUTTON}>
                {messages.data.done}
              </button>
            </Actions>
          </>
        )}
      </div>
    </Dialog>
  );
});

/** From `md` up, at the foot of the dialog; a phone has them in the header bar. */
function Actions({ children }: { children: ReactElement | ReactElement[] }): ReactElement {
  return <div className="mt-auto hidden justify-end gap-2 pt-2 md:flex">{children}</div>;
}

function Feedback({
  error,
  status,
}: {
  error: string | null;
  status: string | null;
}): ReactElement | null {
  if (error !== null) {
    return (
      <p role="alert" className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger">
        {error}
      </p>
    );
  }
  if (status !== null) return <output className="block text-sm text-ink-muted">{status}</output>;
  return null;
}

/**
 * What the import did, counting the household's items; only what happened is
 * listed. It replaces the form, button and all, so its heading takes focus.
 */
function SummaryView({ summary }: { summary: ImportSummary }): ReactElement {
  const t = messages.data.summary;
  const headingRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    headingRef.current?.focus();
  }, []);
  const counts: Array<[label: string, value: number]> = [
    [t.createdItems, summary.createdItems],
    [t.updatedItems, summary.updatedItems],
    [t.restoredItems, summary.restoredItems],
    [t.unchangedItems, summary.unchangedItems],
    [t.addedUnits, summary.addedUnits],
  ];
  const shown = counts.filter(([, value]) => value > 0);
  const changed = summary.createdItems + summary.updatedItems + summary.restoredItems > 0;

  return (
    <div className="flex flex-col gap-4 text-sm">
      <h3
        ref={headingRef}
        tabIndex={-1}
        className="flex items-center gap-2 text-base font-semibold outline-none"
      >
        <CircleCheck aria-hidden="true" className="size-5 text-success" />
        {t.title}
      </h3>

      {!changed && <p>{t.nothingNew}</p>}
      {shown.length > 0 && (
        <dl className="divide-y divide-line rounded-xl border border-line">
          {shown.map(([label, value]) => (
            <div key={label} className="flex items-center justify-between gap-4 px-4 py-2.5">
              <dt>{label}</dt>
              <dd className="font-semibold tabular-nums">{formatNumber(value)}</dd>
            </div>
          ))}
        </dl>
      )}

      {summary.createdLocations.length > 0 && <p>{t.newLocations(summary.createdLocations)}</p>}

      {summary.capped.length > 0 && (
        <div>
          <p>{t.capped(MAX_ITEM_QUANTITY)}</p>
          <ul className="mt-1 list-disc ps-5 text-ink-muted">
            {summary.capped.map((entry) => (
              <li key={entry.name}>{t.cappedItem(entry.name, entry.units)}</li>
            ))}
          </ul>
        </div>
      )}

      {summary.skipped.length > 0 && (
        <details>
          <summary className="cursor-pointer font-medium">
            {t.skipped(summary.skipped.length)}
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-ink-muted">
            {summary.skipped.map((row) => (
              <li key={`${row.sheet}:${row.row}`}>
                {t.skippedRow(row.sheet, row.row, row.name, t.reasons[row.reason])}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
