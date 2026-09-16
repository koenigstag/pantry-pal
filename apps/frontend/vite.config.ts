import {
  API_PREFIX,
  DEFAULT_BACKEND_PORT,
  DEFAULT_FRONTEND_PORT,
  SOCKET_IO_PATH,
} from '@pantry-pal/shared';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv } from 'vite';

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
    plugins: [react(), tailwindcss()],
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
