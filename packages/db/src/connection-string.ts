/**
 * Composes a libpq connection string from discrete parts.
 *
 * Pure on purpose: this package never reads `process.env` under `src/`, so the
 * parts are arguments. Tooling (`drizzle.config.ts`) and the backend's
 * `ConfigService` each read the environment themselves and call this, which
 * keeps one implementation of the escaping rules rather than two.
 */
export interface ConnectionParts {
  host: string;
  port: number | string;
  user: string;
  password: string;
  database: string;
  ssl?: boolean;
}

export function buildConnectionString({
  host,
  port,
  user,
  password,
  database,
  ssl = false,
}: ConnectionParts): string {
  // Percent-encode the credentials: a password containing `@`, `/` or `:` would
  // otherwise silently truncate the URL and point at the wrong host.
  const credentials = `${encodeURIComponent(user)}:${encodeURIComponent(password)}`;

  return `postgres://${credentials}@${host}:${port}/${encodeURIComponent(database)}${
    ssl ? '?sslmode=require' : ''
  }`;
}

/** The discrete variables `resolveConnectionString` composes, in the order it reports them. */
export const CONNECTION_ENV_KEYS = [
  'DATABASE_HOST',
  'DATABASE_PORT',
  'DATABASE_USER',
  'DATABASE_PASSWORD',
  'DATABASE_NAME',
] as const;

/**
 * Resolves a connection string from an environment-shaped record: a complete
 * `DATABASE_URL` wins, otherwise the five discrete variables are composed.
 *
 * The record is an argument, never `process.env` read directly, for the same
 * reason as `buildConnectionString`. `drizzle.config.ts` and the seed CLI both
 * pass `process.env`; the backend can pass whatever its `ConfigService` holds.
 */
export function resolveConnectionString(env: Readonly<Record<string, string | undefined>>): string {
  const read = (key: string): string | undefined => {
    const value = env[key];
    return value === undefined || value === '' ? undefined : value;
  };

  const url = read('DATABASE_URL');
  if (url !== undefined) return url;

  const host = read('DATABASE_HOST');
  const port = read('DATABASE_PORT');
  const user = read('DATABASE_USER');
  const password = read('DATABASE_PASSWORD');
  const database = read('DATABASE_NAME');

  if (
    host === undefined ||
    port === undefined ||
    user === undefined ||
    password === undefined ||
    database === undefined
  ) {
    const missing = CONNECTION_ENV_KEYS.filter((key) => read(key) === undefined);
    throw new Error(
      `No database connection configured. Missing: ${missing.join(', ')}. ` +
        'Set all five DATABASE_* variables, or a single DATABASE_URL.',
    );
  }

  return buildConnectionString({
    host,
    port,
    user,
    password,
    database,
    ssl: read('DATABASE_SSL') === 'true',
  });
}
