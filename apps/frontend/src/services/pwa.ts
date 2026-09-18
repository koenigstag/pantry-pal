import { registerSW } from 'virtual:pwa-register';

/**
 * How long after startup a newly deployed build is taken into use. The check
 * against the server runs as the app starts, so a waiting build is normally
 * found within a second; the rest of the window covers a slow connection.
 */
const STARTUP_WINDOW_MS = 10_000;

/** Registered once per page load, StrictMode's double render included. */
let registered = false;

/**
 * Registers the service worker, which serves the app offline and answers reads
 * from its cache when the network does not.
 *
 * Called before the app renders, and whether or not anyone signs in, so a
 * visitor who only reaches the sign-in page still has an app that installs and
 * opens offline.
 *
 * **A new build is taken silently, but only while the app is starting.** Nothing
 * is on screen yet and nobody has typed anything, so the reload costs nothing.
 * A build deployed later in the session is left waiting, and the next start
 * picks it up: an app in someone's hands is never reloaded under them.
 *
 * In development there is no worker, so this does nothing.
 */
export function registerServiceWorker(): void {
  if (registered) return;
  registered = true;

  const startedAt = Date.now();
  const updateSW = registerSW({
    onNeedRefresh: () => {
      if (Date.now() - startedAt > STARTUP_WINDOW_MS) return;
      // Activates the waiting worker and reloads, now running the new build.
      void updateSW(true);
    },
  });
}
