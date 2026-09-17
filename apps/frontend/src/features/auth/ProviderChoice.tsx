import { Mail } from 'lucide-react';
import { useId, type ReactElement, type Ref } from 'react';

import { messages } from '../../i18n/messages';
import { cn } from '../../ui/cn';
import { PRIMARY_BUTTON, SECONDARY_BUTTON } from './AuthPage';
import { GoogleMark } from './GoogleMark';

interface ProviderChoiceProps {
  /** The email button, which returning to this step focuses. */
  emailButtonRef: Ref<HTMLButtonElement>;
  onEmail: () => void;
}

/**
 * The first step of signing in and of signing up: how. Google is shown so the
 * choice is visible from the start, and works once the backend offers it.
 */
export function ProviderChoice({ emailButtonRef, onEmail }: ProviderChoiceProps): ReactElement {
  const googleHintId = useId();

  return (
    <>
      <div className="flex flex-col gap-1.5">
        <button
          type="button"
          aria-disabled="true"
          aria-describedby={googleHintId}
          className={cn(
            SECONDARY_BUTTON,
            'w-full aria-disabled:cursor-not-allowed aria-disabled:opacity-60 aria-disabled:hover:bg-transparent',
          )}
        >
          <GoogleMark className="size-4" />
          {messages.auth.continueWithGoogle}
        </button>
        <p id={googleHintId} className="text-center text-xs text-ink-muted">
          {messages.common.comingSoon}
        </p>
      </div>
      <button
        ref={emailButtonRef}
        type="button"
        onClick={onEmail}
        className={cn(PRIMARY_BUTTON, 'inline-flex w-full items-center justify-center gap-2')}
      >
        <Mail aria-hidden="true" className="size-4" />
        {messages.auth.continueWithEmail}
      </button>
    </>
  );
}
