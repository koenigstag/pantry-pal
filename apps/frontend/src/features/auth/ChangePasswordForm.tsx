import { MIN_PASSWORD_LENGTH } from '@pantry-pal/shared';
import { ChangePasswordDto, validateDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { useNotices, usePantryStore } from '../../stores/StoreContext';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { authFieldErrors } from './authFieldErrors';
import { SECONDARY_BUTTON } from './AuthPage';

/**
 * The account's password, on the Profile page. Changing it signs out every other
 * device; this one stays signed in.
 */
export const ChangePasswordForm = observer(function ChangePasswordForm(): ReactElement {
  const pantry = usePantryStore();
  const notices = useNotices();
  const titleId = useId();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const result = validateDto(ChangePasswordDto, { currentPassword, newPassword });
    const fieldErrors = result.ok ? {} : authFieldErrors(result.errors, 'chosen');
    // The server refuses it too; saying so here saves the round trip.
    if (newPassword !== '' && newPassword === currentPassword) {
      fieldErrors['newPassword'] = messages.changePassword.sameAsCurrent;
    }
    if (!result.ok || Object.keys(fieldErrors).length > 0) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setFailure(null);
    setSaving(true);
    const message = await pantry.changePassword(result.value);
    setSaving(false);
    if (message !== null) {
      setFailure(message);
      return;
    }

    setCurrentPassword('');
    setNewPassword('');
    notices.info(messages.changePassword.changed);
  }

  return (
    <form
      noValidate
      aria-labelledby={titleId}
      onSubmit={(event) => void submit(event)}
      className="mt-4 flex flex-col gap-3 rounded-xl border border-line bg-surface px-4 py-3"
    >
      <h2 id={titleId} className="text-sm text-ink-muted">
        {messages.changePassword.title}
      </h2>
      <Field label={messages.changePassword.current} error={errors['currentPassword']}>
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            className={FIELD_CONTROL}
          />
        )}
      </Field>
      <Field
        label={messages.changePassword.next}
        hint={messages.auth.passwordHint(MIN_PASSWORD_LENGTH)}
        error={errors['newPassword']}
      >
        {(props) => (
          <input
            {...props}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            className={FIELD_CONTROL}
          />
        )}
      </Field>

      {failure !== null && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}

      <button type="submit" disabled={isSaving} className={`${SECONDARY_BUTTON} self-start`}>
        {isSaving ? messages.changePassword.saving : messages.changePassword.submit}
      </button>
    </form>
  );
});
