import { observer } from 'mobx-react-lite';
import { useId, useState, type FormEvent, type ReactElement } from 'react';
import { useNavigate } from 'react-router';

import { messages } from '../../i18n/messages';
import { useNotices, useRecipes } from '../../stores/StoreContext';
import { Dialog } from '../../ui/Dialog';
import { Field, FIELD_CONTROL } from '../../ui/Field';
import { PRIMARY_BUTTON } from '../auth/AuthPage';
import { recipeLink } from './recipeRoutes';

interface ImportRecipeDialogProps {
  open: boolean;
  onClose: () => void;
}

const WEB_LINK = /^https?:\/\/\S+$/i;

/**
 * A link to a recipe site's page in, the household's own recipe out: the server
 * fetches the page and keeps the recipe its site marked up. Online only.
 */
export const ImportRecipeDialog = observer(function ImportRecipeDialog({
  open,
  onClose,
}: ImportRecipeDialogProps): ReactElement {
  const recipes = useRecipes();
  const notices = useNotices();
  const navigate = useNavigate();
  const formId = useId();
  const [url, setUrl] = useState('');
  const [error, setError] = useState<string | undefined>(undefined);
  const [busy, setBusy] = useState(false);

  function close(): void {
    if (busy) return;
    setUrl('');
    setError(undefined);
    onClose();
  }

  async function submit(event: FormEvent): Promise<void> {
    event.preventDefault();
    const link = url.trim();
    if (!WEB_LINK.test(link)) {
      setError(messages.recipes.import.errors.invalidUrl);
      return;
    }

    setBusy(true);
    setError(undefined);
    const result = await recipes.importFromUrl(link);
    setBusy(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }

    setUrl('');
    onClose();
    notices.info(messages.recipes.added(result.value.title));
    void navigate(recipeLink(result.value.id));
  }

  return (
    <Dialog variant="sheet" open={open} onClose={close} title={messages.recipes.import.title}>
      <form
        id={formId}
        noValidate
        onSubmit={(event) => void submit(event)}
        className="flex flex-col gap-4"
      >
        <Field
          label={messages.recipes.import.url}
          hint={messages.recipes.import.hint}
          error={error}
        >
          {(props) => (
            <input
              {...props}
              type="url"
              inputMode="url"
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              placeholder="https://"
              value={url}
              disabled={busy}
              onChange={(event) => setUrl(event.target.value)}
              className={FIELD_CONTROL}
            />
          )}
        </Field>
        <button type="submit" disabled={busy} className={PRIMARY_BUTTON}>
          {busy ? messages.recipes.import.submitting : messages.recipes.import.submit}
        </button>
      </form>
    </Dialog>
  );
});
