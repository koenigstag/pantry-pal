import type { CurrentUser, PantryLocation, UserHousehold } from '@pantry-pal/shared';
import type { UpsertLocationsDto } from '@pantry-pal/shared/dto';
import { observer } from 'mobx-react-lite';
import { useState, type FormEvent, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router';

import { messages } from '../../i18n/messages';
import { useAuthStore, usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import {
  canRenameHousehold,
  detailsChanges,
  detailsDraftOf,
  detailsErrors,
  hasDetailsChanges,
  type DetailsDraft,
} from '../profile/details';
import { DetailsFields } from '../profile/DetailsFields';
import { locationName } from '../storage/locationName';
import { AuthPage, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXT_LINK } from './AuthPage';
import { returnPath } from './sessionRoutes';
import { SIGN_UP_STEPS } from './SignUpPage';

/**
 * Sign-up's last step, once the account exists: optional questions about the
 * user and their first household, whose answers Profile can change later.
 * Finishing saves what changed; skipping saves nothing. Either way the new
 * account goes on to the page it was headed for.
 *
 * The page is signed in, so the pantry loads beneath it, creating the first
 * household with the default storage spaces that the last question trims.
 */
export const WelcomePage = observer(function WelcomePage(): ReactElement {
  const auth = useAuthStore();
  const pantry = usePantryStore();
  const navigate = useNavigate();
  const location = useLocation();

  function goOn(): void {
    auth.finishOnboarding();
    void navigate(returnPath(location.state), { replace: true });
  }

  let content: ReactElement;
  if (pantry.user !== null && pantry.household !== null) {
    content = <WelcomeForm user={pantry.user} household={pantry.household} onDone={goOn} />;
  } else if (pantry.loadState === 'failed') {
    content = (
      <div className="mt-4 flex flex-col items-start gap-3">
        <p role="alert" className="text-sm text-danger">
          {pantry.error ?? messages.errors.loadFailed}
        </p>
        <button type="button" onClick={() => void pantry.load()} className={SECONDARY_BUTTON}>
          {messages.common.retry}
        </button>
      </div>
    );
  } else {
    content = (
      <output className="mt-4 block text-sm text-ink-muted">{messages.common.loading}</output>
    );
  }

  return (
    <AuthPage
      title={messages.welcome.title(messages.app.name)}
      step={{ current: SIGN_UP_STEPS, total: SIGN_UP_STEPS }}
      languagePicker={false}
    >
      {content}
    </AuthPage>
  );
});

interface WelcomeFormProps {
  user: CurrentUser;
  household: UserHousehold;
  onDone: () => void;
}

/** Rendered once the pantry has loaded, so the draft starts from the saved values. */
const WelcomeForm = observer(function WelcomeForm({
  user,
  household,
  onDone,
}: WelcomeFormProps): ReactElement {
  const pantry = usePantryStore();
  const [draft, setDraft] = useState(() => detailsDraftOf(user, household));
  /** The storage spaces unticked, by id. */
  const [dropped, setDropped] = useState<ReadonlySet<string>>(() => new Set());
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);

  // Only while the household holds nothing: removing a space moves its things,
  // which the storage spaces editor explains and this question does not.
  const offerSpaces = pantry.items.length === 0;

  function update(patch: Partial<DetailsDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  function toggle(id: string): void {
    setDropped((current) => {
      const next = new Set(current);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  async function finish(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    // Against the values saved by now, so a retry after a partial failure resends only the rest.
    const changes = detailsChanges(draft, user, household);
    const fieldErrors = detailsErrors(changes);
    if (fieldErrors !== null) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setFailure(null);
    setSaving(true);
    let message = hasDetailsChanges(changes) ? await pantry.saveDetails(changes) : null;
    const spaces = offerSpaces ? keptSpaces(pantry.locations, dropped) : null;
    if (message === null && spaces !== null) message = await pantry.saveLocations(spaces);
    if (message !== null) {
      setFailure(message);
      setSaving(false);
      return;
    }

    onDone();
  }

  return (
    <form noValidate onSubmit={(event) => void finish(event)} className="mt-2 flex flex-col gap-4">
      <p className="text-sm text-ink-muted">{messages.welcome.intro}</p>

      <DetailsFields
        draft={draft}
        errors={errors}
        onChange={update}
        showHouseholdName={canRenameHousehold(household)}
      />

      {offerSpaces && (
        <fieldset className="flex min-w-0 flex-col">
          <legend className="mb-1 text-xs font-medium text-ink-muted">
            {messages.welcome.storageSpaces}
          </legend>
          <div className="grid grid-cols-2 gap-x-3 gap-y-2">
            {pantry.locations.map((space) => (
              <label
                key={space.id}
                className={cn(
                  'flex min-w-0 items-center gap-2 text-sm',
                  space.isFallback ? 'text-ink-muted' : 'cursor-pointer',
                )}
              >
                <input
                  type="checkbox"
                  // The fallback always stays: removed spaces' things go there.
                  disabled={space.isFallback}
                  checked={!dropped.has(space.id)}
                  onChange={() => toggle(space.id)}
                  className="focus-ring size-4.5 shrink-0 cursor-pointer accent-accent disabled:cursor-not-allowed"
                />
                <span className="truncate">{locationName(space)}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            {messages.welcome.storageSpacesHint(messages.storage.fallbackLocation)}
          </p>
        </fieldset>
      )}

      {failure !== null && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}

      <button type="submit" disabled={isSaving} className={cn(PRIMARY_BUTTON, 'w-full')}>
        {isSaving ? messages.welcome.finishing : messages.welcome.finish}
      </button>
      <button
        type="button"
        disabled={isSaving}
        onClick={onDone}
        className={cn(TEXT_LINK, 'cursor-pointer self-center text-sm disabled:opacity-60')}
      >
        {messages.welcome.skip}
      </button>
    </form>
  );
});

/**
 * The locations editor's save for the spaces left ticked: every space in its
 * order, with the unticked ones removed. `null` when every space stays.
 */
function keptSpaces(
  locations: readonly PantryLocation[],
  dropped: ReadonlySet<string>,
): UpsertLocationsDto | null {
  const removed = locations.filter((space) => dropped.has(space.id) && !space.isFallback);
  if (removed.length === 0) return null;

  return {
    locations: locations
      .filter((space) => !removed.includes(space))
      .map((space) => ({ id: space.id, name: space.name })),
    removed: removed.map((space) => ({ id: space.id })),
  };
}
