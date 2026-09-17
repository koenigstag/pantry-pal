import { SUPPORTED_LOCALES } from '@pantry-pal/shared';
import { Languages } from 'lucide-react';
import { useId, type ReactElement } from 'react';

import { LANGUAGE_NAMES, LOCALE, switchLocale } from '../../i18n/locale';
import { messages } from '../../i18n/messages';

/**
 * The signed-out pages' language: a quiet select under the card, out of the
 * form's way. It changes only this browser's copy and reloads. Signing up gives
 * the new account this language, while signing in to an existing account takes
 * that account's own.
 *
 * With storage blocked the choice cannot be kept, nothing reloads, and the
 * select stays on the page's language.
 */
export function LanguagePicker(): ReactElement {
  const selectId = useId();

  return (
    <div className="flex items-center justify-center gap-1.5 text-xs text-ink-muted">
      <Languages aria-hidden="true" className="size-3.5" />
      <label htmlFor={selectId} className="sr-only">
        {messages.profile.language}
      </label>
      <select
        id={selectId}
        value={LOCALE}
        onChange={(event) => switchLocale(event.target.value)}
        // Sized to the language showing, not the longest name, where supported.
        className="focus-ring field-sizing-content cursor-pointer rounded bg-canvas py-1.5 text-xs text-ink-muted transition-colors hover:text-ink"
      >
        {SUPPORTED_LOCALES.map((locale) => (
          // Each name in its own language, so a screen reader pronounces it as such.
          <option key={locale} value={locale} lang={locale}>
            {LANGUAGE_NAMES[locale]}
          </option>
        ))}
      </select>
    </div>
  );
}
