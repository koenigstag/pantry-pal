import {
  ACCESS_TOKEN_HANDSHAKE_KEY,
  PANTRY_WS_NAMESPACE,
  SOCKET_IO_PATH,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@pantry-pal/shared';
import { io, type Socket } from 'socket.io-client';

import { backendOrigin } from './backendOrigin';
import { accessToken, readSession, refreshAccessToken } from './session';

/**
 * `Socket<Listen, Emit>` — the client listens to what the server sends and emits
 * what the server subscribes to, so the two generics are the mirror image of the
 * backend gateway's.
 */
export type PantrySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** A server closing sockets again within this long is not answered with another reconnect. */
const RECONNECT_COOLDOWN_MS = 10_000;

/**
 * Connects to `backendOrigin`: the page's own origin in development, where Vite
 * proxies `/socket.io` through to the backend, and `VITE_BACKEND_URL` in a build.
 *
 * The access token travels in the handshake `auth` payload, because a browser
 * cannot set headers on a WebSocket. `auth` is a function, so every attempt,
 * automatic reconnects included, sends the token current at that moment.
 */
export function createPantrySocket(baseUrl = backendOrigin): PantrySocket {
  const socket: PantrySocket = io(`${baseUrl}${PANTRY_WS_NAMESPACE}`, {
    path: SOCKET_IO_PATH,
    transports: ['websocket'],
    autoConnect: false,
    auth: (send) => {
      accessToken().then(
        (token) => send({ [ACCESS_TOKEN_HANDSHAKE_KEY]: token }),
        () => send({}),
      );
    },
  });

  keepAuthenticated(socket);
  return socket;
}

const isUnauthorized = (error: Error): boolean =>
  (error as Error & { data?: { statusCode?: unknown } }).data?.statusCode === 401;

/**
 * The server checks the access token only at the handshake. It refuses a token
 * that expired while the socket was down, and it closes a socket whose session
 * ended: signed out elsewhere, a changed password. Socket.IO retries neither by
 * itself.
 *
 * Both refresh the token. If the server refuses the refresh, the session is over
 * and the tab signs out; otherwise the socket connects again. After a refused
 * handshake that happens once, and after a closed socket not more than once in
 * `RECONNECT_COOLDOWN_MS`, so a server that keeps refusing is not hammered.
 */
function keepAuthenticated(socket: PantrySocket): void {
  let retriedHandshake = false;
  let lastServerClose = 0;

  async function refreshAndReconnect(): Promise<void> {
    const session = readSession();
    if (session === null) return;

    const token = await refreshAccessToken(session.accessToken).catch(() => null);
    if (token !== null) socket.connect();
  }

  socket.on('connect', () => {
    retriedHandshake = false;
  });

  socket.on('connect_error', (error) => {
    if (retriedHandshake || !isUnauthorized(error)) return;
    retriedHandshake = true;
    void refreshAndReconnect();
  });

  socket.on('disconnect', (reason) => {
    if (reason !== 'io server disconnect') return;
    if (Date.now() - lastServerClose < RECONNECT_COOLDOWN_MS) return;
    lastServerClose = Date.now();
    void refreshAndReconnect();
  });
}
