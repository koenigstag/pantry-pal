import { randomBytes } from 'node:crypto';

import { resolveConnectionString } from '@pantry-pal/db';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '@pantry-pal/shared';

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigins: string[];
  /**
   * Express's `trust proxy`: which proxies may name the client in
   * `X-Forwarded-For`. `undefined` trusts none, so the client is the socket's peer.
   */
  trustProxy: boolean | number | string | undefined;
  database: {
    url: string;
    poolMax: number;
  };
  auth: {
    /**
     * Development sign-in: `POST /auth/dev-sign-in` for any email, and the
     * `x-dev-user-email` header as the caller's identity. Never in production.
     */
    devIdentity: boolean;
    /** `JWT_ACCESS_SECRET`: signs and verifies access tokens. */
    accessTokenSecret: string;
    /** `JWT_REFRESH_SECRET`: signs and verifies refresh tokens. Never the access tokens' secret. */
    refreshTokenSecret: string;
    /** The secrets development generated for this process, because none was set. */
    generatedSecrets: JwtSecretName[];
  };
  admin: {
    /** `undefined` disables every `/admin` route. */
    apiKey: string | undefined;
  };
}

/** Long enough that it cannot be a placeholder someone forgot to change. */
const MIN_ADMIN_API_KEY_LENGTH = 16;

/** HS256 needs a key at least as long as its hash, 256 bits (RFC 7518, section 3.2). */
const MIN_JWT_SECRET_BYTES = 32;

const JWT_SECRET_NAMES = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;
export type JwtSecretName = (typeof JWT_SECRET_NAMES)[number];

/**
 * A token secret from the environment. Production refuses to start without one;
 * development generates a random one, which lives only as long as the process.
 */
function tokenSecret(name: JwtSecretName, nodeEnv: string): { value: string; generated: boolean } {
  const configured = process.env[name]?.trim() || undefined;

  if (configured === undefined) {
    if (nodeEnv === 'production') throw new Error(`${name} is required in production.`);
    return { value: randomBytes(MIN_JWT_SECRET_BYTES).toString('base64url'), generated: true };
  }
  if (Buffer.byteLength(configured) < MIN_JWT_SECRET_BYTES) {
    throw new Error(`${name} must be at least ${MIN_JWT_SECRET_BYTES} bytes.`);
  }
  return { value: configured, generated: false };
}

function toBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

function toPositiveInteger(value: string | undefined, fallback: number, max: number): number {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= max ? parsed : fallback;
}

/** `true`/`false`, a hop count, or what Express accepts besides: `loopback`, addresses, subnets. */
function toTrustProxy(value: string | undefined): boolean | number | string | undefined {
  const trimmed = value?.trim();
  if (trimmed === undefined || trimmed === '') return undefined;
  if (trimmed === 'true' || trimmed === 'false') return trimmed === 'true';
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed;
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

  const secrets: Record<JwtSecretName, { value: string; generated: boolean }> = {
    JWT_ACCESS_SECRET: tokenSecret('JWT_ACCESS_SECRET', nodeEnv),
    JWT_REFRESH_SECRET: tokenSecret('JWT_REFRESH_SECRET', nodeEnv),
  };
  if (secrets.JWT_ACCESS_SECRET.value === secrets.JWT_REFRESH_SECRET.value) {
    throw new Error(
      'JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ, or a refresh token would also pass as an access token.',
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
    trustProxy: toTrustProxy(process.env.TRUST_PROXY),
    database: {
      // Same resolution rules as drizzle-kit and `pnpm db:seed`: DATABASE_URL, or
      // the five DATABASE_* parts.
      url: resolveConnectionString(process.env),
      poolMax: toPositiveInteger(process.env.DATABASE_POOL_MAX, 10, 100),
    },
    auth: {
      devIdentity,
      accessTokenSecret: secrets.JWT_ACCESS_SECRET.value,
      refreshTokenSecret: secrets.JWT_REFRESH_SECRET.value,
      generatedSecrets: JWT_SECRET_NAMES.filter((name) => secrets[name].generated),
    },
    admin: { apiKey },
  };
}
