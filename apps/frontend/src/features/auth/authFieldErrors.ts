import { MAX_PASSWORD_LENGTH, MIN_PASSWORD_LENGTH } from '@pantry-pal/shared';
import type { FieldError } from '@pantry-pal/shared/dto';

import { messages } from '../../i18n/messages';

/**
 * The messages under the sign-in, sign-up and password fields: one catalog
 * message per field, as `itemFieldErrors` gives the item forms, instead of
 * class-validator's English.
 *
 * `password` is the one field whose rule depends on the form: signing in only
 * needs one typed, while signing up chooses one, which must fit the length rules.
 */
export function authFieldErrors(
  errors: readonly FieldError[],
  password: 'typed' | 'chosen',
): Record<string, string> {
  const t = messages.auth.fieldErrors;
  const chosen = t.password(MIN_PASSWORD_LENGTH, MAX_PASSWORD_LENGTH);
  const byField: Record<string, string> = {
    email: t.email,
    password: password === 'typed' ? t.passwordRequired : chosen,
    currentPassword: messages.changePassword.currentRequired,
    newPassword: chosen,
  };

  return Object.fromEntries(
    errors.map((error) => [
      error.property,
      byField[error.property] ?? error.messages[0] ?? t.email,
    ]),
  );
}
