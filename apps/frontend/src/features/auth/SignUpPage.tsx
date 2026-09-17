import { MIN_PASSWORD_LENGTH } from '@pantry-pal/shared';
import { SignUpDto, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import { LOCALE } from '../../i18n/locale';
import { messages } from '../../i18n/messages';
import { useAuthStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { ROUTES } from '../shell/navigation';
import { authFieldErrors } from './authFieldErrors';
import { AuthPage, PRIMARY_BUTTON, TEXT_LINK } from './AuthPage';
import { ProviderChoice } from './ProviderChoice';

/**
 * Signing up takes three steps: how, then the account, then the onboarding
 * questions (`WelcomePage`), which come once the account exists.
 */
export const SIGN_UP_STEPS = 3;

/** The steps on this page; the third is its own page. */
type Step = 'method' | 'account';

/**
 * How to sign up (Google, not built yet, or email), then the account's email and
 * password. Creating the account signs straight in, and `GuestOnly` sends the new
 * account on to the onboarding questions.
 *
 * The account step stays mounted while hidden, so going back to the first step
 * keeps what was typed. Values are read from the inputs, as on the sign-in page:
 * a password manager's generated password does not always fire React's events.
 */
export const SignUpPage = observer(function SignUpPage(): ReactElement {
  const auth = useAuthStore();
  const location = useLocation();
  const emailMethodRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>('method');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);
  /** Focus follows a change of step, never the first render, where a phone would raise its keyboard. */
  const hasChangedStep = useRef(false);

  useEffect(() => {
    if (!hasChangedStep.current) return;
    (step === 'method' ? emailMethodRef : emailRef).current?.focus();
  }, [step]);

  function goTo(next: Step): void {
    hasChangedStep.current = true;
    setErrors({});
    setFailure(null);
    setStep(next);
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = validateDto(SignUpDto, {
      email: emailRef.current?.value ?? '',
      password: passwordRef.current?.value ?? '',
      // The account keeps the language of this page, so signing up reloads nothing.
      locale: LOCALE,
    });
    if (!result.ok) {
      setErrors(authFieldErrors(result.errors, 'chosen'));
      return;
    }

    setErrors({});
    setFailure(null);
    setSubmitting(true);
    const message = await auth.signUp(result.value);
    // Signed up: the onboarding step is already on its way.
    if (message === null) return;

    setFailure(message);
    setSubmitting(false);
  }

  const onAccountStep = step === 'account';

  return (
    <AuthPage
      title={messages.auth.signUpTitle}
      step={{ current: onAccountStep ? 2 : 1, total: SIGN_UP_STEPS }}
      footer={
        <>
          {messages.auth.haveAccount}{' '}
          <Link to={ROUTES.signIn} state={location.state} className={TEXT_LINK}>
            {messages.auth.toSignIn}
          </Link>
        </>
      }
    >
      {!onAccountStep && (
        <div className="mt-5 flex flex-col gap-4">
          <ProviderChoice emailButtonRef={emailMethodRef} onEmail={() => goTo('account')} />
        </div>
      )}

      <form
        noValidate
        hidden={!onAccountStep}
        onSubmit={(event) => void submit(event)}
        className="mt-5 flex flex-col gap-4"
      >
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
              className={FIELD_CONTROL}
            />
          )}
        </Field>
        <Field
          label={messages.auth.password}
          hint={messages.auth.passwordHint(MIN_PASSWORD_LENGTH)}
          error={errors['password']}
        >
          {(props) => (
            <input
              {...props}
              ref={passwordRef}
              name="password"
              type="password"
              autoComplete="new-password"
              className={FIELD_CONTROL}
            />
          )}
        </Field>

        {failure !== null && (
          <p role="alert" className="text-sm text-danger">
            {failure}
          </p>
        )}

        <button type="submit" disabled={isSubmitting} className={cn(PRIMARY_BUTTON, 'w-full')}>
          {isSubmitting ? messages.auth.signingUp : messages.auth.signUp}
        </button>
        <button
          type="button"
          onClick={() => goTo('method')}
          className={cn(TEXT_LINK, 'cursor-pointer self-center text-sm')}
        >
          {messages.auth.otherSignUpMethods}
        </button>
      </form>
    </AuthPage>
  );
});
