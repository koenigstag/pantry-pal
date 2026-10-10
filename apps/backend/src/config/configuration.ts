import { randomBytes } from 'node:crypto';

import { resolveConnectionString } from '@pantry-pal/db';
import { DEFAULT_BACKEND_PORT, DEFAULT_FRONTEND_PORT } from '@pantry-pal/shared';

export interface AppConfig {
  nodeEnv: string;
  host: string;
  port: number;
  corsOrigins: string[];
  /**
   * `PUBLIC_URL`: the backend's own origin as the outside world reaches it. The
   * OAuth issuer and the MCP endpoint's address are built from it, so behind a
   * proxy it must be the public HTTPS origin, not the bind address.
   */
  publicUrl: string;
  /**
   * `FRONTEND_URL`: where the web app is served, base path included
   * (`https://user.github.io/pantry-pal/`). An assistant asking for access sends
   * the user to its consent page. Defaults to the first `CORS_ORIGIN`.
   */
  frontendUrl: string;
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
    /** Development sign-in: `POST /auth/dev-sign-in`, for any email. Never in production. */
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
  assistant: {
    /** `ANTHROPIC_API_KEY`. `undefined` turns the text assistant off: its routes answer 404. */
    apiKey: string | undefined;
    /** `ASSISTANT_MODEL`: the Claude model that reads the text. */
    model: string;
  };
}

/** The model the text assistant uses unless `ASSISTANT_MODEL` names another. */
const DEFAULT_ASSISTANT_MODEL = 'claude-sonnet-5-5';

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

/** An absolute http(s) URL with no query or fragment, without a trailing slash; throws otherwise. */
function toBaseUrl(name: string, value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute URL, such as https://pantry.example.com`);
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.search !== '' || url.hash !== '') {
    throw new Error(`${name} must be an http(s) URL without a query or fragment`);
  }
  return url.href.replace(/\/+$/, '');
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

  const port = toPositiveInteger(process.env.PORT, DEFAULT_BACKEND_PORT, 65_535);
  const corsOrigins = (process.env.CORS_ORIGIN ?? `http://localhost:${DEFAULT_FRONTEND_PORT}`)
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);

  const publicUrl = toBaseUrl(
    'PUBLIC_URL',
    process.env.PUBLIC_URL?.trim() || `http://localhost:${port}`,
  );
  // OAuth refuses a plain-HTTP issuer anywhere but on this machine.
  const { protocol, hostname } = new URL(publicUrl);
  if (protocol !== 'https:' && hostname !== 'localhost' && hostname !== '127.0.0.1') {
    throw new Error('PUBLIC_URL must be https unless it is localhost.');
  }

  return {
    nodeEnv,
    host: process.env.HOST ?? '0.0.0.0',
    port,
    corsOrigins,
    publicUrl,
    frontendUrl: toBaseUrl(
      'FRONTEND_URL',
      process.env.FRONTEND_URL?.trim() ||
        corsOrigins[0] ||
        `http://localhost:${DEFAULT_FRONTEND_PORT}`,
    ),
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
    assistant: {
      apiKey: process.env.ANTHROPIC_API_KEY?.trim() || undefined,
      model: process.env.ASSISTANT_MODEL?.trim() || DEFAULT_ASSISTANT_MODEL,
    },
  };
}
