import { defineConfig } from 'drizzle-kit';

/**
 * drizzle-kit is tooling rather than library code, so reading the environment
 * here is fine — nothing under `src/` does.
 */
const connectionString = process.env['DATABASE_URL'];

if (connectionString === undefined || connectionString === '') {
  throw new Error('DATABASE_URL is required by drizzle-kit. See .env.example.');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  dbCredentials: { url: connectionString },
  strict: true,
  verbose: true,
});
