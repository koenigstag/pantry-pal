import { useId, type ReactElement, type ReactNode } from 'react';

import { messages } from '../../i18n/messages';
import { cn } from '../../ui/cn';
import { LanguagePicker } from './LanguagePicker';

export const PRIMARY_BUTTON =
  'focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

export const SECONDARY_BUTTON =
  'focus-ring inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-line px-5 text-sm font-medium transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60';

export const TEXT_LINK = 'focus-ring rounded font-medium text-accent hover:underline';

/** Where a page stands in a journey of several pages or steps. */
export interface JourneyStep {
  current: number;
  total: number;
}

interface AuthPageProps {
  title: string;
  children: ReactNode;
  /** Under the card: the way to the other page, sign-in or sign-up. */
  footer?: ReactNode;
  /** Shown above the title, as a bar and in words. */
  step?: JourneyStep;
  /**
   * The signed-out pages offer a language for this browser. A signed-in page
   * leaves it out: the account's language applies there.
   */
  languagePicker?: boolean;
}

/**
 * The frame of the sign-in and sign-up journey: the app's name, one card, and a
 * line under it. The language picker stands apart, at the foot of the page, out
 * of the form's way.
 */
export function AuthPage({
  title,
  children,
  footer,
  step,
  languagePicker = true,
}: AuthPageProps): ReactElement {
  const titleId = useId();

  return (
    <div className="flex min-h-dvh flex-col items-center px-4">
      <main className="flex w-full max-w-sm flex-1 flex-col justify-center py-10">
        <p className="mb-6 text-center text-lg font-bold tracking-tight">{messages.app.name}</p>
        <section
          aria-labelledby={titleId}
          className="rounded-xl border border-line bg-surface px-5 py-6"
        >
          {step !== undefined && <StepBar step={step} />}
          <h1 id={titleId} className="text-xl font-semibold tracking-tight">
            {title}
          </h1>
          {children}
        </section>
        {footer !== undefined && (
          <p className="mt-6 text-center text-sm text-ink-muted">{footer}</p>
        )}
      </main>
      {languagePicker && (
        <footer className="pb-6">
          <LanguagePicker />
        </footer>
      )}
    </div>
  );
}

function StepBar({ step }: { step: JourneyStep }): ReactElement {
  return (
    <div className="mb-3 flex items-center gap-3">
      <div aria-hidden="true" className="flex flex-1 gap-1">
        {Array.from({ length: step.total }, (_, index) => (
          <span
            key={index}
            className={cn(
              'h-1 flex-1 rounded-full',
              index < step.current ? 'bg-accent' : 'bg-line',
            )}
          />
        ))}
      </div>
      <p className="shrink-0 text-xs text-ink-muted">
        {messages.auth.step(step.current, step.total)}
      </p>
    </div>
  );
}
