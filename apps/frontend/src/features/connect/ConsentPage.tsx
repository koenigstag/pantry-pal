import { OAUTH_REQUEST_PARAM, type OAuthConsentRequest } from '@pantry-pal/shared';
import { observer } from 'mobx-react-lite';
import { useEffect, useState, type ReactElement } from 'react';
import { Link, useSearchParams } from 'react-router';

import { messages } from '../../i18n/messages';
import { usePantryStore } from '../../stores/StoreContext';
import { AuthPage, PRIMARY_BUTTON, SECONDARY_BUTTON, TEXT_LINK } from '../auth/AuthPage';
import { ROUTES } from '../shell/navigation';

type State =
  | { kind: 'loading' }
  | { kind: 'failed'; error: string }
  | { kind: 'asking'; request: OAuthConsentRequest }
  | { kind: 'answering'; request: OAuthConsentRequest; allow: boolean }
  | { kind: 'leaving' };

/**
 * Where an assistant elsewhere — claude.ai, ChatGPT — sends the user to ask for
 * access to their pantry over MCP: `/connect?request=…`, opened by the backend's
 * OAuth `/authorize`. Signed in like every page but the sign-in ones, so a
 * signed-out user signs in first and comes back here.
 *
 * It names the assistant and where the answer goes, so a client borrowing a
 * known name is easier to spot, and says what access means. Either answer
 * leaves the app for the assistant's redirect.
 */
export const ConsentPage = observer(function ConsentPage(): ReactElement {
  const pantry = usePantryStore();
  const [params] = useSearchParams();
  const requestId = params.get(OAUTH_REQUEST_PARAM);
  const [state, setState] = useState<State>({ kind: 'loading' });

  useEffect(() => {
    if (requestId === null) {
      setState({ kind: 'failed', error: messages.connect.incomplete });
      return;
    }
    let current = true;
    void (async () => {
      const result = await pantry.oauthRequest(requestId);
      if (!current) return;
      setState(
        result.ok
          ? { kind: 'asking', request: result.value }
          : { kind: 'failed', error: result.error },
      );
    })();
    return () => {
      current = false;
    };
  }, [pantry, requestId]);

  async function answer(request: OAuthConsentRequest, allow: boolean): Promise<void> {
    setState({ kind: 'answering', request, allow });
    const result = await pantry.answerOAuthRequest(request.id, allow);
    if (!result.ok) {
      setState({ kind: 'failed', error: result.error });
      return;
    }
    setState({ kind: 'leaving' });
    window.location.assign(result.value);
  }

  const t = messages.connect;
  if (state.kind === 'loading' || state.kind === 'leaving') {
    return (
      <AuthPage title={t.heading} languagePicker={false}>
        <output className="mt-4 block text-sm text-ink-muted">
          {state.kind === 'loading' ? messages.common.loading : t.leaving}
        </output>
      </AuthPage>
    );
  }

  if (state.kind === 'failed') {
    return (
      <AuthPage title={t.heading} languagePicker={false}>
        <p role="alert" className="mt-4 text-sm text-danger">
          {state.error}
        </p>
        <Link to={ROUTES.storage} className={`${TEXT_LINK} mt-4 inline-block text-sm`}>
          {t.backToApp}
        </Link>
      </AuthPage>
    );
  }

  const { request } = state;
  const busy = state.kind === 'answering';
  return (
    <AuthPage title={t.title(request.clientName)} languagePicker={false}>
      <div className="mt-4 flex flex-col gap-3 text-sm">
        <p>{t.access(request.clientName)}</p>
        <p className="text-ink-muted">{t.redirect(request.redirectHost)}</p>
        <p className="text-ink-muted">{t.revoke}</p>
      </div>
      <div className="mt-6 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(request, true)}
          className={PRIMARY_BUTTON}
        >
          {busy && state.allow ? t.allowing : t.allow}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => void answer(request, false)}
          className={SECONDARY_BUTTON}
        >
          {t.deny}
        </button>
      </div>
    </AuthPage>
  );
});
