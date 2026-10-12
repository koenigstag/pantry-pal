/*
 * Notifications, in the service worker.
 *
 * The worker is Workbox's, generated at build time (`generateSW`), and pulls
 * this file in through `workbox.importScripts` in vite.config.ts: the app's
 * part of the worker lives here, in plain JavaScript, rather than in a worker of
 * our own that would have to redo the caching Workbox does.
 *
 * A push arrives here whether or not the app is open. Its payload was encrypted
 * to this browser by the backend (`PushPayload` in @pantry-pal/shared) and is
 * already worded in its recipient's language: a worker has no catalog, and no
 * time to fetch one before the notification has to be on screen.
 *
 * An imported script is fetched through the HTTP cache, not the worker's own
 * update check, so a change here reaches a browser with the next worker update,
 * or as late as GitHub Pages' ten-minute cache allows.
 *
 * `pushsubscriptionchange`, for a browser replacing a subscription by itself,
 * is not handled: registering the new one needs a signed-in request, and a
 * worker holds no session. The Profile page's switch reflects what the server
 * has, so such a device reads as off until it is turned on again.
 */

/* global self, clients */

self.addEventListener('push', (event) => {
  const payload = readPayload(event);
  if (payload === null) return;

  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      tag: typeof payload.tag === 'string' ? payload.tag : undefined,
      // Resolved against the worker's scope, so it holds under /pantry-pal/ on Pages.
      icon: new URL('pwa-192x192.png', self.registration.scope).href,
      data: { path: typeof payload.path === 'string' ? payload.path : '' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // Routes start with a slash; under a project path they are relative to the scope.
  const route = String(event.notification.data?.path ?? '').replace(/^\/+/, '');
  const target = new URL(route, self.registration.scope).href;

  event.waitUntil(
    (async () => {
      // An open window of the app is brought forward and taken to the page,
      // rather than opening a second copy beside it.
      const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
      const open = windows.find((client) => client.url.startsWith(self.registration.scope));
      if (open !== undefined) {
        await open.focus();
        if (route !== '' && 'navigate' in open && open.url !== target) await open.navigate(target);
        return;
      }
      await clients.openWindow(target);
    })(),
  );
});

/** The payload, or null for one this build does not understand: never an empty notification. */
function readPayload(event) {
  if (!event.data) return null;
  try {
    const payload = event.data.json();
    return payload !== null &&
      typeof payload === 'object' &&
      typeof payload.title === 'string' &&
      typeof payload.body === 'string'
      ? payload
      : null;
  } catch {
    return null;
  }
}
