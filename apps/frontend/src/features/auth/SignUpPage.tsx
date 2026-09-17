import { MIN_PASSWORD_LENGTH } from '@pantry-pal/shared';
import { SignUpDto, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useState, type FormEvent, type ReactElement } from 'react';
import { Link, useLocation } from 'react-router';

import { messages } from '../../i18n/messages';
import { useAuthStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { ROUTES } from '../shell/navigation';
import { authFieldErrors } from './authFieldErrors';
import { AuthPage, PRIMARY_BUTTON, TEXT_LINK } from './AuthPage';

/**
 * A new account, signed straight in. Its first visit to the pantry creates the
 * household, as for any user who has none.
 */
export const SignUpPage = observer(function SignUpPage(): ReactElement {
  const auth = useAuthStore();
  const location = useLocation();
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSubmitting, setSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = validateDto(SignUpDto, {
      email,
      password,
      // Left empty, the server names the account after the email.
      ...(displayName.trim() === '' ? {} : { displayName }),
    });
    if (!result.ok) {
      setErrors(authFieldErrors(result.errors, 'chosen'));
      return;
    }

    setErrors({});
    setFailure(null);
    setSubmitting(true);
    const message = await auth.signUp(result.value);
    // Signed in: this page is already on its way out.
    if (message === null) return;

    setFailure(message);
    setSubmitting(false);
  }

  return (
    <AuthPage
      title={messages.auth.signUpTitle}
      footer={
        <>
          {messages.auth.haveAccount}{' '}
          <Link to={ROUTES.signIn} state={location.state} className={TEXT_LINK}>
            {messages.auth.toSignIn}
          </Link>
        </>
      }
    >
      <form
        noValidate
        onSubmit={(event) => void submit(event)}
        className="mt-5 flex flex-col gap-4"
      >
        <Field
          label={messages.auth.displayName}
          hint={messages.auth.displayNameHint}
          error={errors['displayName']}
        >
          {(props) => (
            <input
              {...props}
              type="text"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              className={FIELD_CONTROL}
            />
          )}
        </Field>
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
        <Field
          label={messages.auth.password}
          hint={messages.auth.passwordHint(MIN_PASSWORD_LENGTH)}
          error={errors['password']}
        >
          {(props) => (
            <input
              {...props}
              type="password"
              autoComplete="new-password"
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
          {isSubmitting ? messages.auth.signingUp : messages.auth.signUp}
        </button>
      </form>
    </AuthPage>
  );
});
