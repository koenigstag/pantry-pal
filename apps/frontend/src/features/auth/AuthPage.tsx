import { useId, type ReactElement, type ReactNode } from 'react';

import { messages } from '../../i18n/messages';

export const PRIMARY_BUTTON =
  'focus-ring h-10 cursor-pointer rounded-full bg-accent px-5 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-60';

export const SECONDARY_BUTTON =
  'focus-ring inline-flex h-10 cursor-pointer items-center justify-center gap-2 rounded-full border border-line px-5 text-sm font-medium transition-colors hover:bg-sunken disabled:cursor-not-allowed disabled:opacity-60';

export const TEXT_LINK = 'focus-ring rounded font-medium text-accent hover:underline';

interface AuthPageProps {
  title: string;
  children: ReactNode;
  /** Under the card: the way to the other page, sign-in or sign-up. */
  footer: ReactNode;
}

/** The frame of a signed-out page: the app's name, one card, and a line under it. */
export function AuthPage({ title, children, footer }: AuthPageProps): ReactElement {
  const titleId = useId();

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-sm">
        <p className="mb-6 text-center text-lg font-bold tracking-tight">{messages.app.name}</p>
        <section
          aria-labelledby={titleId}
          className="rounded-xl border border-line bg-surface px-5 py-6"
        >
          <h1 id={titleId} className="text-xl font-semibold tracking-tight">
            {title}
          </h1>
          {children}
        </section>
        <p className="mt-6 text-center text-sm text-ink-muted">{footer}</p>
      </div>
    </main>
  );
}
