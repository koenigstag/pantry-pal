/**
 * The origin REST requests and the socket go to.
 *
 * In development it is the page's own origin: the dev server proxies `/api` and
 * `/socket.io` to `VITE_BACKEND_URL` (see `vite.config.ts`), so the browser never
 * meets CORS. A built bundle has no proxy and calls `VITE_BACKEND_URL` directly,
 * so the backend's `CORS_ORIGIN` must list the site's origin. Unset, a build calls
 * its own origin as well.
 */
export const backendOrigin: string = import.meta.env.DEV
  ? ''
  : (import.meta.env.VITE_BACKEND_URL ?? '').replace(/\/+$/, '');
