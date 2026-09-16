import { resolveConnectionString } from '@pantry-pal/db';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '@pantry-pal/shared';

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigins: string[];
  database: {
    url: string;
    poolMax: number;
  };
  auth: {
    /** Trust the `x-dev-user-email` header as the caller's identity. Never in production. */
    devIdentity: boolean;
  };
  admin: {
    /** `undefined` disables every `/admin` route. */
    apiKey: string | undefined;
  };
}

/** Long enough that it cannot be a placeholder someone forgot to change. */
const MIN_ADMIN_API_KEY_LENGTH = 16;

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function toPositiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

/**
 * The only place that reads `process.env`. Misconfiguration throws here, at
 * boot, rather than surfacing later as a confusing runtime failure.
 */
export function configuration(): AppConfig {
  const nodeEnv = process.env.NODE_ENV ?? 'development';

  const devIdentity = toBoolean(process.env.DEV_AUTH, false);
  if (devIdentity && nodeEnv === 'production') {
    throw new Error(
      'DEV_AUTH=true lets any caller claim any identity and must never run in production.',
    );
  }

  const apiKey = process.env.ADMIN_API_KEY?.trim() || undefined;
  if (apiKey !== undefined && apiKey.length < MIN_ADMIN_API_KEY_LENGTH) {
    throw new Error(`ADMIN_API_KEY must be at least ${MIN_ADMIN_API_KEY_LENGTH} characters.`);
  }

  return {
    nodeEnv,
    host: process.env.HOST ?? '0.0.0.0',
    port: toPositiveInteger(process.env.PORT, DEFAULT_BACKEND_PORT, 65_535),
    corsOrigins: (process.env.CORS_ORIGIN ?? `http://localhost:${DEFAULT_FRONTEND_PORT}`)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    database: {
      // Same resolution rules as drizzle-kit and `pnpm db:seed`: DATABASE_URL, or
      // the five DATABASE_* parts.
      url: resolveConnectionString(process.env),
      poolMax: toPositiveInteger(process.env.DATABASE_POOL_MAX, 10, 100),
    },
    auth: { devIdentity },
    admin: { apiKey },
  };
}
