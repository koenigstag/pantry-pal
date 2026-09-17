import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { isUUID } from 'class-validator';

/** HMAC-SHA256: this process both signs its tokens and verifies them. */
export const JWT_ALGORITHM = 'HS256';

/** Short, because a signed-out session's access token stays valid until it expires. */
export const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;

/** From the last refresh, so a session in use never expires. */
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** What an access token asserts: the user, and the session it was issued to. */
export interface AccessTokenClaims {
  sub: string;
  sid: string;
}

/**
 * What a refresh token asserts. `jti` is new at every refresh, and the session's
 * row keeps only its hash: a token whose `jti` the row no longer holds is spent.
 */
export interface RefreshTokenClaims extends AccessTokenClaims {
  jti: string;
}

export function isAccessTokenClaims(value: unknown): value is AccessTokenClaims {
  if (typeof value !== 'object' || value === null) return false;
  const { sub, sid } = value as Record<string, unknown>;
  return typeof sub === 'string' && isUUID(sub) && typeof sid === 'string' && isUUID(sid);
}

export function isRefreshTokenClaims(value: unknown): value is RefreshTokenClaims {
  if (!isAccessTokenClaims(value)) return false;
  const { jti } = value as unknown as Record<string, unknown>;
  return typeof jti === 'string' && jti.length > 0;
}

/**
 * Why an access token was refused, from the error `jsonwebtoken` raised.
 * Passport hands the same errors to `AccessGuard` as `info`, and reports a
 * missing token as a plain `Error`.
 */
export function describeAccessTokenError(error: unknown): string {
  const name = error instanceof Error ? error.name : undefined;

  if (name === 'TokenExpiredError') return 'The access token has expired: refresh it';
  if (name === 'JsonWebTokenError' || name === 'NotBeforeError') {
    return 'The access token is invalid';
  }
  return 'Sign in first: send an access token as `Authorization: Bearer <token>`';
}

/** A refresh token's `jti`: 256 random bits. */
export const newTokenId = (): string => randomBytes(32).toString('base64url');

export const hashTokenId = (tokenId: string): string =>
  createHash('sha256').update(tokenId).digest('base64url');

/** Constant-time, so response timing reveals nothing about a stored hash. */
export function hashesEqual(presented: string, stored: string): boolean {
  const left = Buffer.from(presented);
  const right = Buffer.from(stored);
  return left.length === right.length && timingSafeEqual(left, right);
}
