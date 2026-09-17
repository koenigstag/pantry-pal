import { SignInDto, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useEffect, useId, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import { LOCALE } from '../../i18n/locale';
import { messages } from '../../i18n/messages';
import { useAuthStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { ROUTES } from '../shell/navigation';
import { authFieldErrors } from './authFieldErrors';
import { AuthPage, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXT_LINK } from './AuthPage';
import { ProviderChoice } from './ProviderChoice';

/** Choose how to sign in, then give the email, then the password. */
type Step = 'method' | 'email' | 'password';

/**
 * Hides a field from people but not from password managers. Some managers skip
 * a field that is `hidden` or `display: none`, so it stays rendered, transparent
 * and out of the layout; `inert` on it keeps it out of the tab order and away
 * from screen readers.
 */
const HIDDEN_FIELD = 'pointer-events-none absolute inset-x-0 top-0 opacity-0';

/**
 * Development builds start from the seeded test household's owner, ready for the
 * sign-in without a password. A filled field is one a password manager leaves be.
 */
const INITIAL_EMAIL = import.meta.env.DEV
  ? (import.meta.env.VITE_DEV_USER_EMAIL ?? 'owner@pantry-pal.test')
  : '';

/** The email's rules alone, as the server applies them; the password waits for its step. */
function emailError(email: string): string | undefined {
  const result = validateDto(SignInDto, { email, password: 'not checked yet' });
  return result.ok ? undefined : messages.auth.fieldErrors.email;
}

/**
 * Three steps: how to sign in (Google, not built yet, or email), the email, then
 * the password.
 *
 * One form holds both inputs from the start, and each step only hides from view
 * the ones it does not use. A password manager can therefore fill both whenever
 * it likes, even before the email step shows, and the later steps show what it
 * filled.
 *
 * Values are read from the inputs, not kept in state. Autofill does not always
 * fire the events React listens for, and Chrome withholds a filled password from
 * scripts until the user interacts with the page, which every step's button does.
 *
 * Once the session is stored, `GuestOnly` takes the visitor on to the page that
 * sent them here.
 */
export const SignInPage = observer(function SignInPage(): ReactElement {
  const auth = useAuthStore();
  const location = useLocation();
  const devHintId = useId();
  const emailMethodRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('method');
  /** The email Continue accepted, shown on the password step. */
  const [email, setEmail] = useState<string | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [pending, setPending] = useState<'password' | 'dev' | null>(null);
  /** Focus follows a change of step, never the first render, where a phone would raise its keyboard. */
  const hasChangedStep = useRef(false);

  useEffect(() => {
    if (!hasChangedStep.current) return;
    const target = { method: emailMethodRef, email: emailRef, password: passwordRef }[step];
    target.current?.focus();
  }, [step]);

  function goTo(next: Step): void {
    hasChangedStep.current = true;
    setErrors({});
    setFailure(null);
    setStep(next);
  }

  function continueWithEmail(): void {
    const typed = emailRef.current?.value ?? '';
    const error = emailError(typed);
    if (error !== undefined) {
      setErrors({ email: error });
      return;
    }

    const accepted = typed.trim().toLowerCase();
    // A password filled in for the previous email belongs to that account.
    if (email !== null && accepted !== email && passwordRef.current !== null) {
      passwordRef.current.value = '';
    }
    setEmail(accepted);
    goTo('password');
  }

  /**
   * Reads both inputs, the hidden email included: on this step only a password
   * manager can change it, and when it does it fills the password of the same
   * account, so the pair it chose is the pair signed in with.
   */
  async function signIn(): Promise<void> {
    const result = validateDto(SignInDto, {
      email: emailRef.current?.value ?? '',
      password: passwordRef.current?.value ?? '',
    });
    if (!result.ok) {
      setErrors(authFieldErrors(result.errors, 'typed'));
      return;
    }
    await attempt('password', () => auth.signIn(result.value));
  }

  /**
   * Development builds only: a session for the email without a password, which
   * the backend grants only while it runs with `DEV_AUTH=true`. An account made
   * this way has no password, and starts in the page's language.
   */
  async function signInWithoutPassword(): Promise<void> {
    if (email === null) return;
    await attempt('dev', () => auth.devSignIn({ email, locale: LOCALE }));
  }

  async function attempt(
    kind: 'password' | 'dev',
    call: () => Promise<string | null>,
  ): Promise<void> {
    setErrors({});
    setFailure(null);
    setPending(kind);
    const message = await call();
    // Signed in: this page is already on its way out.
    if (message === null) return;

    setFailure(message);
    setPending(null);
  }

  function submit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    // A password manager may submit the form for the user, whatever step shows.
    if (step === 'method') goTo('email');
    else if (step === 'email') continueWithEmail();
    else void signIn();
  }

  const onEmailStep = step === 'email';
  const onPasswordStep = step === 'password';

  return (
    <AuthPage
      title={messages.auth.signInTitle}
      footer={
        <>
          {messages.auth.noAccount}{' '}
          <Link to={ROUTES.signUp} state={location.state} className={TEXT_LINK}>
            {messages.auth.toSignUp}
          </Link>
        </>
      }
    >
      {auth.endedElsewhere && (
        <output className="mt-2 block text-sm text-ink-muted">{messages.auth.sessionEnded}</output>
      )}

      <form noValidate onSubmit={submit} className="relative mt-5 flex flex-col gap-4">
        {step === 'method' && (
          <ProviderChoice emailButtonRef={emailMethodRef} onEmail={() => goTo('email')} />
        )}

        <div inert={!onEmailStep} className={cn(!onEmailStep && HIDDEN_FIELD)}>
          <Field label={messages.auth.email} error={errors['email']}>
            {(props) => (
              <input
                {...props}
                ref={emailRef}
                name="email"
                type="email"
                inputMode="email"
                autoComplete="username"
                spellCheck={false}
                defaultValue={INITIAL_EMAIL}
                // Hidden on the password step, this changes there only when a
                // password manager fills in another account; the email shown follows.
                onChange={(event) => {
                  if (onPasswordStep) setEmail(event.target.value.trim().toLowerCase());
                }}
                className={FIELD_CONTROL}
              />
            )}
          </Field>
        </div>

        {onPasswordStep && (
          <div className="flex min-w-0 items-center justify-between gap-3 rounded-lg bg-sunken px-3 py-2">
            <span className="truncate text-sm font-medium">{email}</span>
            <button
              type="button"
              onClick={() => goTo('email')}
              className={cn(TEXT_LINK, 'shrink-0 cursor-pointer text-sm')}
            >
              {messages.auth.changeEmail}
            </button>
          </div>
        )}

        <div inert={!onPasswordStep} className={cn(!onPasswordStep && HIDDEN_FIELD)}>
          <Field label={messages.auth.password} error={errors['password']}>
            {(props) => (
              <input
                {...props}
                ref={passwordRef}
                name="password"
                type="password"
                autoComplete="current-password"
                className={FIELD_CONTROL}
              />
            )}
          </Field>
        </div>

        {failure !== null && (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        )}

        {step !== 'method' && (
          <button
            type="submit"
            disabled={pending !== null}
            className={cn(PRIMARY_BUTTON, 'w-full')}
          >
            {onEmailStep
              ? messages.auth.continue
              : pending === 'password'
                ? messages.auth.signingIn
                : messages.auth.signIn}
          </button>
        )}

        {onEmailStep && (
          <button
            type="button"
            onClick={() => goTo('method')}
            className={cn(TEXT_LINK, 'cursor-pointer self-center text-sm')}
          >
            {messages.auth.otherMethods}
          </button>
        )}

        {onPasswordStep && import.meta.env.DEV && (
          <div className="flex flex-col gap-1.5 border-t border-line pt-4">
            <button
              type="button"
              disabled={pending !== null}
              aria-describedby={devHintId}
              onClick={() => void signInWithoutPassword()}
              className={SECONDARY_BUTTON}
            >
              {messages.auth.dev.submit}
            </button>
            <p id={devHintId} className="text-xs text-ink-muted">
              {messages.auth.dev.hint}
            </p>
          </div>
        )}
      </form>
    </AuthPage>
  );
});
