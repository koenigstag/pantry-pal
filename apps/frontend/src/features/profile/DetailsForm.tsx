import type { CurrentUser, UserHousehold } from '@pantry-pal/shared';
import { observer } from 'mobx-react-lite';
import { useId, useState, type FormEvent, type ReactElement } from 'react';

import { messages } from '../../i18n/messages';
import { useNotices, usePantryStore } from '../../stores/StoreContext';
import { cn } from '../../ui/cn';
import { SECONDARY_BUTTON } from '../auth/AuthPage';
import {
  canRenameHousehold,
  detailsChanges,
  detailsDraftOf,
  detailsErrors,
  hasDetailsChanges,
  type DetailsDraft,
} from './details';
import { DetailsFields } from './DetailsFields';

interface DetailsFormProps {
  user: CurrentUser;
  household: UserHousehold | null;
}

/**
 * The account's details on the Profile page, the same fields the onboarding step
 * asks. Save is enabled once something changed, and sends only what changed.
 */
export const DetailsForm = observer(function DetailsForm({
  user,
  household,
}: DetailsFormProps): ReactElement {
  const pantry = usePantryStore();
  const notices = useNotices();
  const titleId = useId();
  const [draft, setDraft] = useState(() => detailsDraftOf(user, household));
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [isSaving, setSaving] = useState(false);

  const changes = detailsChanges(draft, user, household);

  function update(patch: Partial<DetailsDraft>): void {
    setDraft((current) => ({ ...current, ...patch }));
  }

  async function submit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const fieldErrors = detailsErrors(changes);
    if (fieldErrors !== null) {
      setErrors(fieldErrors);
      return;
    }

    setErrors({});
    setFailure(null);
    setSaving(true);
    const message = await pantry.saveDetails(changes);
    setSaving(false);
    if (message !== null) {
      setFailure(message);
      return;
    }

    // As saved: a name typed with spaces around it reads back trimmed.
    if (pantry.user !== null) setDraft(detailsDraftOf(pantry.user, pantry.household));
    notices.info(messages.details.saved);
  }

  return (
    <form
      noValidate
      aria-labelledby={titleId}
      onSubmit={(event) => void submit(event)}
      className="mt-4 flex flex-col gap-4 rounded-xl border border-line bg-surface px-4 py-3"
    >
      <h2 id={titleId} className="text-sm text-ink-muted">
        {messages.details.title}
      </h2>
      <DetailsFields
        draft={draft}
        errors={errors}
        onChange={update}
        showHouseholdName={canRenameHousehold(household)}
      />

      {failure !== null && (
        <p role="alert" className="text-sm text-danger">
          {failure}
        </p>
      )}

      <button
        type="submit"
        disabled={isSaving || !hasDetailsChanges(changes)}
        className={cn(SECONDARY_BUTTON, 'self-start')}
      >
        {isSaving ? messages.details.saving : messages.details.save}
      </button>
    </form>
  );
});
