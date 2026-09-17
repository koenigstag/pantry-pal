import { observer } from 'mobx-react-lite';
import type { ReactElement } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router';

import { SessionStoreProvider, useAuthStore } from '../../stores/StoreContext';
import { ROUTES } from '../shell/navigation';

/** Router state the sign-in pages carry: where the visitor was going. */
interface ReturnState {
  from?: unknown;
}

/** An in-app path to return to, else storage. Anything else in the state is ignored. */
export function returnPath(state: unknown): string {
  const from = (state as ReturnState | null)?.from;
  return typeof from === 'string' && from.startsWith('/') && !from.startsWith('//')
    ? from
    : ROUTES.storage;
}

/**
 * The signed-in pages. A signed-out visitor is sent to sign in, remembering the
 * page, and the pantry's stores live only while these pages are mounted.
 */
export const RequireSession = observer(function RequireSession(): ReactElement {
  const auth = useAuthStore();
  const location = useLocation();

  if (!auth.isSignedIn) {
    const from = `${location.pathname}${location.search}${location.hash}`;
    return <Navigate replace to={ROUTES.signIn} state={{ from } satisfies ReturnState} />;
  }

  return (
    <SessionStoreProvider>
      <Outlet />
    </SessionStoreProvider>
  );
});

/**
 * The sign-in and sign-up pages. Once signed in, the visitor goes where they were
 * headed; a new account answers the onboarding questions first, and the
 * onboarding page passes the destination on.
 */
export const GuestOnly = observer(function GuestOnly(): ReactElement {
  const auth = useAuthStore();
  const location = useLocation();

  if (!auth.isSignedIn) return <Outlet />;
  return auth.isOnboarding ? (
    <Navigate replace to={ROUTES.welcome} state={location.state} />
  ) : (
    <Navigate replace to={returnPath(location.state)} />
  );
});
