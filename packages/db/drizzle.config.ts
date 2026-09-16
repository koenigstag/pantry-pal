import { fileURLToPath } from 'node:url';

import { defineConfig } from 'drizzle-kit';

import { resolveConnectionString } from './src/connection-string';

/**
 * drizzle-kit is tooling rather than library code, so reading the environment
 * here is fine — nothing under `src/` does.
 *
 * drizzle-kit does not load dotenv files itself, so Node's built-in loader does
 * it. `.env.local` wins over `.env`, and a shell variable wins over both: a
 * one-off `DATABASE_URL=... pnpm db:migrate` must never be silently retargeted
 * at a different database by a file on disk. (`process.loadEnvFile` overwrites
 * existing keys, hence the snapshot and restore.)
 */
const fromShell = { ...process.env };

for (const file of ['.env', '.env.local']) {
  try {
    process.loadEnvFile(fileURLToPath(new URL(file, import.meta.url)));
  } catch {
    // Both files are optional.
  }
}

Object.assign(process.env, fromShell);

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: resolveConnectionString(process.env) },
  strict: true,
  verbose: true,
});
