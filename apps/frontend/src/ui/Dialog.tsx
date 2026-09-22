import { X } from 'lucide-react';
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  type ReactElement,
  type ReactNode,
} from 'react';

import { messages } from '../i18n/messages';
import { cn } from './cn';
import { IconButton } from './IconButton';

type DialogVariant = 'modal' | 'sheet' | 'fullscreen';

interface DialogProps {
  open: boolean;
  /**
   * Escape, the backdrop or the close button asked to close. The dialog does not
   * close itself: the owner decides, by setting `open` to false or by unmounting
   * it (a route change). A request the owner declines — a blocked navigation —
   * leaves it open.
   */
  onClose: () => void;
  title: string;
  /**
   * On a phone a dialog is a sheet or fills the screen:
   * - `modal` fills a phone, with a header bar, and is a box centred on wide screens;
   * - `sheet` rises from the bottom edge on narrow screens and centres on wide ones;
   * - `fullscreen` fills a phone and is a large panel on wide screens, with a header bar on both.
   */
  variant?: DialogVariant;
  /** Not for `sheet`: replaces the close button at the start of the header bar. */
  headerStart?: ReactNode;
  /**
   * Not for `sheet`: actions at the end of the header bar. A `modal` has the bar
   * below `md` only, so its content shows the same actions itself from `md` up.
   */
  headerEnd?: ReactNode;
  /**
   * `fullscreen` only. `center` centres the title on the header itself, not on
   * the space between the buttons, so unequal buttons do not pull it aside.
   */
  titleAlign?: 'start' | 'center';
  children: ReactNode;
}

/**
 * A modal `<dialog>` is fixed to every edge of the viewport and centred by its
 * margins, which only works while its height fits its content (`h-fit`, the
 * browser's own default): `h-auto` would stretch it to its maximum and leave a
 * short box at the top.
 */
const DIALOG_CLASSES: Record<DialogVariant, string> = {
  modal:
    'm-0 h-dvh max-h-none w-full max-w-none md:m-auto md:h-fit md:max-h-[85dvh] md:w-[calc(100%-2rem)] md:max-w-lg',
  sheet: 'mx-0 mt-auto mb-0 max-h-[85dvh] w-full max-w-none md:m-auto md:max-w-md',
  fullscreen:
    'm-0 h-dvh max-h-none w-full max-w-none md:m-auto md:h-[min(90dvh,52rem)] md:w-[calc(100%-4rem)] md:max-w-5xl',
};

/**
 * A native `<dialog>` opened with `showModal()`.
 *
 * The browser provides the focus trap, the inert page, the top layer, and focus
 * returning to the opener once the dialog closes — which is why it is closed
 * before it leaves the DOM, and why sheets stay mounted with `open` toggled.
 *
 * A click on the backdrop requests a close. The inner panel covers the whole
 * dialog box, so a click targeting the dialog element itself landed outside it
 * — provided the press started there too, or dragging a text selection out of
 * an input would count.
 */
export function Dialog({
  open,
  onClose,
  title,
  variant = 'modal',
  headerStart,
  headerEnd,
  titleAlign = 'start',
  children,
}: DialogProps): ReactElement {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const pressStartedOnBackdrop = useRef(false);
  const unmounting = useRef(false);
  const latest = useRef({ open, onClose });
  const isModal = variant === 'modal';

  useLayoutEffect(() => {
    latest.current = { open, onClose };
  });

  // Keeps the element in step with `open` after every render, including one
  // where the browser closed it on its own (see `onClose` below).
  useEffect(() => {
    const dialog = ref.current;
    if (dialog === null) return;

    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  });

  useLayoutEffect(() => {
    // Reset for StrictMode, which runs this cleanup and then the effect again.
    unmounting.current = false;
    const dialog = ref.current;

    return () => {
      unmounting.current = true;
      if (dialog?.open) dialog.close();
    };
  }, []);

  function requestClose(): void {
    latest.current.onClose();
  }

  return (
    // Escape is handled through the native `cancel` event; the pointer handlers
    // only add the backdrop click, so there is no key handler to pair them with.
    // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      // React bubbles `cancel` and `close` through the component tree although
      // the browser does not, so a dialog nested inside this one (a confirmation
      // sheet) would otherwise be taken for this one closing.
      onCancel={(event) => {
        if (event.target !== event.currentTarget) return;
        event.preventDefault();
        requestClose();
      }}
      onClose={(event) => {
        if (event.target !== event.currentTarget) return;
        // `close` is dispatched as a task, after the fact. If the dialog is open
        // again by then, the event is stale: StrictMode's development remount
        // closes and reopens every dialog on mount, and its `close` lands after
        // the reopen.
        if (event.currentTarget.open) return;
        // Closed by the browser anyway: it refuses to let a page cancel a second
        // Escape in a row. Tell the owner; if it keeps `open` true, the sync
        // effect above reopens the dialog on the next render.
        if (!unmounting.current && latest.current.open) requestClose();
      }}
      onPointerDown={(event) => {
        pressStartedOnBackdrop.current = event.target === event.currentTarget;
      }}
      onClick={(event) => {
        if (pressStartedOnBackdrop.current && event.target === event.currentTarget) requestClose();
      }}
      className={cn(
        'overflow-visible bg-transparent p-0 text-ink',
        'transition-[translate,opacity] duration-200 ease-out starting:open:translate-y-6 starting:open:opacity-0',
        DIALOG_CLASSES[variant],
      )}
    >
      {variant === 'sheet' ? (
        <div className="flex max-h-[85dvh] flex-col overflow-y-auto rounded-t-2xl bg-surface p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-xl md:rounded-2xl md:pb-4">
          <h2 id={titleId} className="mb-3 text-lg font-semibold text-balance">
            {title}
          </h2>
          {children}
        </div>
      ) : (
        <div
          className={cn(
            'flex h-full flex-col overflow-hidden bg-surface md:rounded-2xl md:shadow-xl',
            isModal && 'md:h-auto md:max-h-[85dvh]',
          )}
        >
          <header
            className={cn(
              'min-h-14 shrink-0 items-center gap-2 border-b border-line px-2 pt-[env(safe-area-inset-top)]',
              // From `md` up a modal is a plain box: the bar folds into a heading.
              isModal ? 'md:min-h-0 md:border-b-0 md:px-4 md:pt-4' : 'md:px-3',
              titleAlign === 'center'
                ? // Equal side tracks centre the title; each is at least as wide as its buttons.
                  'grid grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)]'
                : 'flex',
            )}
          >
            <div className={cn('flex justify-start', isModal && 'md:hidden')}>
              {headerStart ?? (
                <IconButton
                  icon={X}
                  label={messages.common.close}
                  onClick={requestClose}
                  className="text-ink-muted hover:bg-sunken hover:text-ink"
                />
              )}
            </div>
            {/* Focusable from script only: the place focus goes when the content swaps. */}
            <h2
              id={titleId}
              tabIndex={-1}
              data-dialog-title=""
              className={cn(
                'min-w-0 truncate font-semibold outline-none',
                titleAlign === 'center' ? 'text-center' : 'flex-1',
                isModal && 'md:text-lg md:text-balance md:whitespace-normal',
              )}
            >
              {title}
            </h2>
            <div className={cn('flex justify-end', isModal && 'md:hidden')}>{headerEnd}</div>
          </header>
          <div
            className={cn(
              'min-h-0 flex-1 overflow-y-auto overscroll-contain',
              isModal
                ? 'flex flex-col p-4 pb-[max(1rem,env(safe-area-inset-bottom))] md:pt-3 md:pb-4'
                : 'pb-[env(safe-area-inset-bottom)]',
            )}
          >
            {children}
          </div>
        </div>
      )}
    </dialog>
  );
}
