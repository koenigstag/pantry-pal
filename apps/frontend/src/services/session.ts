import type { AuthSession } from '@pantry-pal/shared';

import { ApiError, send } from './http';

/** The tokens this browser holds. Every tab of the site shares them. */
export type StoredSession = Omit<AuthSession, 'user'>;

type SessionListener = (session: StoredSession | null) => void;

const STORAGE_KEY = 'pantry-pal:session';

/** Held while a tab refreshes or signs out, so tabs take turns spending the refresh token. */
const REFRESH_LOCK = 'pantry-pal:refresh';

/** An access token this close to expiring is refreshed first, so it cannot lapse in flight. */
const EXPIRY_MARGIN_MS = 30_000;

const listeners = new Set<SessionListener>();

/** The session when storage is blocked: this tab stays signed in until it closes. */
let memoryCopy: StoredSession | null = null;

/** A refresh this tab already started, which later callers wait for instead of starting another. */
let refreshInFlight: Promise<string | null> | null = null;

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const fields = value as Record<string, unknown>;
  return ['accessToken', 'accessTokenExpiresAt', 'refreshToken', 'refreshTokenExpiresAt'].every(
    (key) => typeof fields[key] === 'string',
  );
}

export function readSession(): StoredSession | null {
  let raw: string | null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return memoryCopy;
  }
  if (raw === null) return null;

  try {
    const parsed: unknown = JSON.parse(raw);
    return isStoredSession(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function store(session: StoredSession | null): void {
  memoryCopy = session;
  try {
    if (session === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Blocked storage: `memoryCopy` keeps this tab signed in.
  }
  for (const listener of listeners) listener(session);
}

/** Keeps the tokens of a session the server just issued. The user stays with the caller. */
export function saveSession(session: AuthSession): void {
  store({
    accessToken: session.accessToken,
    accessTokenExpiresAt: session.accessTokenExpiresAt,
    refreshToken: session.refreshToken,
    refreshTokenExpiresAt: session.refreshTokenExpiresAt,
  });
}

/**
 * Calls `listener` whenever the session changes: signing in, refreshing or
 * signing out, in this tab or another (which reports through `storage` events).
 * Returns the function that stops it.
 */
export function subscribeSession(listener: SessionListener): () => void {
  const onStorage = (event: StorageEvent): void => {
    if (event.key === STORAGE_KEY || event.key === null) listener(readSession());
  };

  listeners.add(listener);
  window.addEventListener('storage', onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('storage', onStorage);
  };
}

const expiresSoon = (instant: string): boolean =>
  Date.parse(instant) - Date.now() < EXPIRY_MARGIN_MS;

/** An access token to send: the stored one while it has time left, else a refreshed one. `null` when signed out. */
export async function accessToken(): Promise<string | null> {
  const session = readSession();
  if (session === null) return null;
  return expiresSoon(session.accessTokenExpiresAt)
    ? refreshAccessToken(session.accessToken)
    : session.accessToken;
}

/**
 * Exchanges the refresh token for a new pair, and returns the new access token,
 * or `null` if the server refused: the session is over, and every tab signs out.
 * Without a response at all (offline, say) the session stays, and this throws.
 *
 * @param stale the access token that is expiring or was just refused. When
 *   another tab has replaced it meanwhile, that replacement is used instead.
 */
export function refreshAccessToken(stale: string): Promise<string | null> {
  refreshInFlight ??= withRefreshLock(() => refreshUnlessReplaced(stale)).finally(() => {
    refreshInFlight = null;
  });
  return refreshInFlight;
}

async function refreshUnlessReplaced(stale: string): Promise<string | null> {
  const session = readSession();
  if (session === null) return null;
  if (session.accessToken !== stale && !expiresSoon(session.accessTokenExpiresAt)) {
    return session.accessToken;
  }

  try {
    const next = await send<AuthSession>('/auth/refresh', {
      method: 'POST',
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    saveSession(next);
    return next.accessToken;
  } catch (error) {
    // Refused: expired, signed out elsewhere, or already spent.
    if (error instanceof ApiError && error.status === 401) {
      store(null);
      return null;
    }
    throw error;
  }
}

/**
 * Forgets the session in every tab, then ends it on the server. If that request
 * fails, the server's session outlives this browser's copy of it, which is gone.
 */
export function endSession(): Promise<void> {
  return withRefreshLock(async () => {
    const session = readSession();
    store(null);
    if (session === null) return;

    try {
      await send<void>('/auth/sign-out', {
        method: 'POST',
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
    } catch {
      // Signed out here regardless; see above.
    }
  });
}

/**
 * Runs `task` while no other tab refreshes or signs out. The server takes a
 * refresh token spent twice for a stolen one and ends the session, so two tabs
 * must never refresh with the same token.
 *
 * Web Locks exist only in secure contexts (HTTPS, or localhost); elsewhere the
 * task runs unguarded.
 */
function withRefreshLock<T>(task: () => Promise<T>): Promise<T> {
  return 'locks' in navigator ? navigator.locks.request(REFRESH_LOCK, task) : task();
}
