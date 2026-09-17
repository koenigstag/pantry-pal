import { SUPPORTED_LOCALES, type SupportedLocale } from '@pantry-pal/shared';
import { CalendarDays, LogOut, ShoppingCart } from 'lucide-react';
import { observer } from 'mobx-react-lite';
import { useId, useState, type ReactElement } from 'react';

import { LANGUAGE_NAMES, LOCALE } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { useAuthStore, usePantryStore } from '../stores/StoreContext';
import { cn } from '../ui/cn';
import { FIELD_CONTROL } from '../ui/Field';
import { SECONDARY_BUTTON } from './auth/AuthPage';
import { ChangePasswordForm } from './auth/ChangePasswordForm';
import { canRenameHousehold } from './profile/details';
import { DetailsForm } from './profile/DetailsForm';
import { ComingSoonPage } from './shell/ComingSoonPage';
import { PageStatus } from './shell/PageStatus';

export function ShoppingPage(): ReactElement {
  return (
    <ComingSoonPage
      title={messages.shopping.title}
      description={messages.shopping.description}
      icon={ShoppingCart}
    />
  );
}

export function PlannerPage(): ReactElement {
  return (
    <ComingSoonPage
      title={messages.planner.title}
      description={messages.planner.description}
      icon={CalendarDays}
    />
  );
}

export const ProfilePage = observer(function ProfilePage(): ReactElement {
  const pantry = usePantryStore();
  const { user, household } = pantry;

  return (
    <div className="mx-auto w-full max-w-3xl px-4 pt-[max(1.5rem,env(safe-area-inset-top))] md:px-8 md:pt-8">
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">
        {messages.profile.title}
      </h1>

      {user === null ? (
        <PageStatus title={messages.common.loading} />
      ) : (
        <>
          <dl className="mt-6 divide-y divide-line rounded-xl border border-line bg-surface">
            <ProfileRow term={messages.profile.email} value={user.email} />
            {/* An owner renames it in the details below. */}
            {household !== null && !canRenameHousehold(household) && (
              <ProfileRow term={messages.profile.household} value={household.name} />
            )}
          </dl>
          <DetailsForm user={user} household={household} />
          <LanguageField />
          {user.hasPassword && <ChangePasswordForm />}
        </>
      )}

      <SignOutButton />
    </div>
  );
});

/** Signing out drops the pantry, and the app returns to the sign-in page. */
const SignOutButton = observer(function SignOutButton(): ReactElement {
  const auth = useAuthStore();
  const [isSigningOut, setSigningOut] = useState(false);

  function signOut(): void {
    setSigningOut(true);
    void auth.signOut();
  }

  return (
    <button
      type="button"
      disabled={isSigningOut}
      onClick={signOut}
      className={cn(SECONDARY_BUTTON, 'mt-6 mb-6')}
    >
      <LogOut aria-hidden="true" className="size-4" />
      {isSigningOut ? messages.auth.signingOut : messages.auth.signOut}
    </button>
  );
});

/**
 * The account's language. Saving it reloads the page, which is what switches the
 * catalog, so the select shows the choice as pending until the reload.
 */
const LanguageField = observer(function LanguageField(): ReactElement {
  const pantry = usePantryStore();
  const selectId = useId();
  const hintId = useId();
  const [pending, setPending] = useState<SupportedLocale | null>(null);
  const [failed, setFailed] = useState(false);

  async function choose(locale: SupportedLocale): Promise<void> {
    setPending(locale);
    setFailed(false);
    if ((await pantry.changeLocale(locale)) === null) return;

    setPending(null);
    setFailed(true);
  }

  return (
    <div className="mt-4 flex flex-col gap-1.5 rounded-xl border border-line bg-surface px-4 py-3">
      <label htmlFor={selectId} className="text-sm text-ink-muted">
        {messages.profile.language}
      </label>
      <select
        id={selectId}
        value={pending ?? LOCALE}
        disabled={pending !== null}
        aria-describedby={hintId}
        onChange={(event) => void choose(event.target.value as SupportedLocale)}
        className={cn(FIELD_CONTROL, 'sm:max-w-64')}
      >
        {SUPPORTED_LOCALES.map((locale) => (
          // Each name in its own language, so a screen reader pronounces it as such.
          <option key={locale} value={locale} lang={locale}>
            {LANGUAGE_NAMES[locale]}
          </option>
        ))}
      </select>
      <p id={hintId} className="text-xs text-ink-muted">
        {messages.profile.languageHint}
      </p>
      {failed && (
        <p role="alert" className="text-sm text-danger">
          {messages.profile.languageFailed}
        </p>
      )}
    </div>
  );
});

function ProfileRow({ term, value }: { term: string; value: string }): ReactElement {
  return (
    <div className="flex flex-col gap-0.5 px-4 py-3">
      <dt className="text-sm text-ink-muted">{term}</dt>
      <dd className="font-medium break-words">{value}</dd>
    </div>
  );
}
