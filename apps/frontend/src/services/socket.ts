import {
  PANTRY_WS_NAMESPACE,
  SOCKET_IO_PATH,
  type ClientToServerEvents,
  type ServerToClientEvents,
} from '@pantry-pal/shared';
import { io, type Socket } from 'socket.io-client';

/**
 * `Socket<Listen, Emit>` — the client listens to what the server sends and emits
 * what the server subscribes to, so the two generics are the mirror image of the
 * backend gateway's.
 */
export type PantrySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/**
 * Connects to the current origin; in development Vite proxies `/socket.io`
 * through to the backend (see `vite.config.ts`), so no CORS in the browser.
 */
export function createPantrySocket(baseUrl = ''): PantrySocket {
  return io(`${baseUrl}${PANTRY_WS_NAMESPACE}`, {
    path: SOCKET_IO_PATH,
    transports: ['websocket'],
    autoConnect: false,
  });
}
