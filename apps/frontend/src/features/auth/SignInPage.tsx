import { DevSignInDto, SignInDto, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import { messages } from '../../i18n/messages';
import { useAuthStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { ROUTES } from '../shell/navigation';
import { authFieldErrors } from './authFieldErrors';
import { AuthPage, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXT_LINK } from './AuthPage';

/** The development sign-in's starting email: the owner of the seeded test household. */
const DEV_EMAIL = import.meta.env.VITE_DEV_USER_EMAIL ?? 'owner@pantry-pal.test';

/**
 * Email and password. Once the session is stored, `GuestOnly` takes the visitor
 * on to the page that sent them here.
 */
export const SignInPage = observer(function SignInPage(): ReactElement {
  const auth = useAuthStore();
  const location = useLocation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = validateDto(SignInDto, { email, password });
    if (!result.ok) {
      setErrors(authFieldErrors(result.errors, 'typed'));
      return;
    }

    setErrors({});
    setFailure(null);
    setSubmitting(true);
    const message = await auth.signIn(result.value);
    // Signed in: this page is already on its way out.
    if (message === null) return;

    setFailure(message);
    setSubmitting(false);
  }

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

      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="mt-5 flex flex-col gap-4"
      >
        <Field label={messages.auth.email} error={errors['email']}>
          {(props) => (
            <input
              {...props}
              type="email"
              inputMode="email"
              autoComplete="username"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              className={FIELD_CONTROL}
            />
          )}
        </Field>
        <Field label={messages.auth.password} error={errors['password']}>
          {(props) => (
            <input
              {...props}
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
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
          {isSubmitting ? messages.auth.signingIn : messages.auth.signIn}
        </button>
      </form>

      {import.meta.env.DEV && <DevSignIn />}
    </AuthPage>
  );
});

/**
 * Development builds only: a session for any email without a password, which the
 * backend grants only while it runs with `DEV_AUTH=true`. Accounts made this way
 * have no password.
 */
const DevSignIn = observer(function DevSignIn(): ReactElement {
  const auth = useAuthStore();
  const titleId = useId();
  const [email, setEmail] = useState(DEV_EMAIL);
  const [error, setError] = useState<string | undefined>(undefined);
  const [failure, setFailure] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = validateDto(DevSignInDto, { email });
    if (!result.ok) {
      setError(messages.auth.fieldErrors.email);
      return;
    }

    setError(undefined);
    setFailure(null);
    setSubmitting(true);
    const message = await auth.devSignIn(result.value);
    if (message === null) return;

    setFailure(message);
    setSubmitting(false);
  }

  return (
    <form
      noValidate
      aria-labelledby={titleId}
      onSubmit={(event) => void submit(event)}
      className="mt-6 flex flex-col gap-3 border-t border-line pt-5"
    >
      <h2 id={titleId} className="text-sm font-semibold">
        {messages.auth.dev.title}
      </h2>
      <Field label={messages.auth.email} hint={messages.auth.dev.hint} error={error}>
        {(props) => (
          <input
            {...props}
            type="email"
            inputMode="email"
            autoComplete="off"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className={FIELD_CONTROL}
          />
        )}
      </Field>

      {failure !== null && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}

      <button type="submit" disabled={isSubmitting} className={SECONDARY_BUTTON}>
        {messages.auth.dev.submit}
      </button>
    </form>
  );
});
