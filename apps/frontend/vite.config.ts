import {
  API_BASE_PATH,
  API_PREFIX,
  DEFAULT_BACKEND_PORT,
  DEFAULT_FRONTEND_PORT,
  DEFAULT_LOCALE,
  SOCKET_IO_PATH,
} from '@pantry-pal/shared';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// With the extension: Vite's native config loader, the coming default, needs it.
import { API_CACHE_NAME } from './src/services/apiCache.ts';

/**
 * The API path the service worker answers from its cache, spelled out because
 * Workbox writes this matcher into the worker by turning it into source: a
 * closure over `API_BASE_PATH` would be gone by then. The check below fails the
 * build if the shared constant ever moves.
 */
const API_PATH_PREFIX = '/api/v1/';
if (API_PATH_PREFIX !== `${API_BASE_PATH}/`) {
  throw new Error(`The service worker's API path is stale: ${API_BASE_PATH}/ now.`);
}

const DAY_IN_SECONDS = 24 * 60 * 60;

/**
 * Importing from `@pantry-pal/shared` here is deliberate: the proxy paths and the
 * client's request paths are then guaranteed to come from the same constants.
 * It also means the shared package must be built before Vite starts, which is
 * exactly what Turborepo's `"dependsOn": ["^build"]` guarantees.
 */
export default defineConfig(({ mode }) => {
  // '' as the third argument loads unprefixed vars too (e.g. PORT), which stay
  // server-side; only VITE_* is exposed to client code.
  const env = loadEnv(mode, process.cwd(), '');
  const backendTarget =
    env.VITE_BACKEND_URL ?? `http://localhost:${env.BACKEND_PORT ?? String(DEFAULT_BACKEND_PORT)}`;

  return {
    // The path the app is served under: `/` by default, `/<repo>/` on GitHub
    // Pages. Vite needs the trailing slash, so it is added whether or not
    // BASE_PATH has one; the router reads the result as `import.meta.env.BASE_URL`.
    base: `${(env.BASE_PATH ?? '').replace(/\/+$/, '')}/`,
    plugins: [
      react(),
      tailwindcss(),
      /**
       * Installable, and readable offline.
       *
       * `prompt` keeps the worker from taking over by itself; `services/pwa.ts`
       * decides when, and it only does so while the app is starting, so nothing
       * reloads under someone mid-edit. The worker is built only here: in
       * development the app runs without one, so a stale cache can never
       * explain what you see.
       *
       * `start_url` and `scope` are left out on purpose: the plugin takes them
       * from `base`, which is `/` locally and `/<repo>/` on GitHub Pages.
       */
      VitePWA({
        registerType: 'prompt',
        injectRegister: null,
        manifest: {
          name: 'Pantry Pal',
          short_name: 'Pantry Pal',
          description: 'What your household has at home, what has run out, and what to buy.',
          lang: DEFAULT_LOCALE,
          display: 'standalone',
          theme_color: '#c2410c',
          // The splash screen behind the icon: the dark canvas from index.css.
          // A manifest holds one colour, and a dark start is the quieter one.
          background_color: '#151617',
          icons: [
            { src: 'pwa-64x64.png', sizes: '64x64', type: 'image/png' },
            { src: 'pwa-192x192.png', sizes: '192x192', type: 'image/png' },
            { src: 'pwa-512x512.png', sizes: '512x512', type: 'image/png' },
            {
              src: 'maskable-icon-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          // The built app, so it opens offline. Source maps stay out of it.
          globPatterns: ['**/*.{js,css,html,svg,png,ico,webmanifest}'],
          navigateFallback: 'index.html',
          navigateFallbackDenylist: [new RegExp(API_PATH_PREFIX)],
          cleanupOutdatedCaches: true,
          runtimeCaching: [
            {
              // Reads only: a write reaches the server or fails. Sync pulls stay out
              // too, since the offline mirror keeps its own copy, and a stale page
              // answering for the server would skip changes it has not seen. So
              // does the export: an old backup passed off as today's is worse
              // than none.
              // The path is spelled out again because this function becomes source.
              urlPattern: ({ url, request }) =>
                request.method === 'GET' &&
                url.pathname.startsWith('/api/v1/') &&
                !url.pathname.includes('/sync/') &&
                !url.pathname.endsWith('/export'),
              handler: 'NetworkFirst',
              options: {
                cacheName: API_CACHE_NAME,
                // A flaky connection answers from the cache rather than hanging.
                networkTimeoutSeconds: 5,
                expiration: {
                  maxEntries: 64,
                  maxAgeSeconds: 7 * DAY_IN_SECONDS,
                  purgeOnQuotaError: true,
                },
                cacheableResponse: { statuses: [200] },
              },
            },
          ],
        },
      }),
    ],
    server: {
      port: Number(env.PORT ?? DEFAULT_FRONTEND_PORT),
      strictPort: true,
      proxy: {
        [`/${API_PREFIX}`]: { target: backendTarget, changeOrigin: true },
        [SOCKET_IO_PATH]: { target: backendTarget, changeOrigin: true, ws: true },
      },
    },
    build: {
      outDir: 'dist',
      sourcemap: true,
    },
  };
});
