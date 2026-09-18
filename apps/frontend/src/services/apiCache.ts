/**
 * The service worker's cache of API reads. `vite.config.ts` names the same cache
 * when it declares the route, and imports this constant so the two agree.
 */
export const API_CACHE_NAME = 'pantry-api-reads';

/**
 * Forgets every cached read.
 *
 * Called whenever a session starts or ends: the cache is keyed by URL alone, so
 * without this the next account to sign in on this device could be shown the
 * previous one's pantry while offline.
 */
export async function clearApiCache(): Promise<void> {
  if (typeof caches === 'undefined') return;

  try {
    await caches.delete(API_CACHE_NAME);
  } catch {
    // Storage blocked: then nothing was cached either.
  }
}
