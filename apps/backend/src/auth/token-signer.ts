import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';

import {
  isRefreshTokenClaims,
  JWT_ALGORITHM,
  type AccessTokenClaims,
  type RefreshTokenClaims,
} from './session-tokens';

type TokenKind = 'access' | 'refresh';

const SECRET_CONFIG_KEYS: Readonly<Record<TokenKind, string>> = {
  access: 'auth.accessTokenSecret',
  refresh: 'auth.refreshTokenSecret',
};

/**
 * Signs and verifies both kinds of token, each with its own secret, so neither
 * can pass for the other: an access token sent to `/auth/refresh`, or a refresh
 * token sent as a bearer token, fails its signature check.
 *
 * The secret and algorithm go with every call instead of being `JwtModule`
 * defaults, so no call can fall back on the other kind's secret.
 */
@Injectable()
export class TokenSigner {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  /** @param expiresAt seconds since the epoch, the JWT `exp` claim. */
  signAccessToken(claims: AccessTokenClaims, expiresAt: number): Promise<string> {
    return this.sign('access', { ...claims, exp: expiresAt });
  }

  /** @param expiresAt seconds since the epoch, the JWT `exp` claim. */
  signRefreshToken(claims: RefreshTokenClaims, expiresAt: number): Promise<string> {
    return this.sign('refresh', { ...claims, exp: expiresAt });
  }

  /** Signature and expiry checked, claims not yet. Throws `jsonwebtoken`'s errors. */
  verifyAccessToken(token: string): Promise<object> {
    return this.jwt.verifyAsync<object>(token, {
      secret: this.secret('access'),
      algorithms: [JWT_ALGORITHM],
    });
  }

  /** The claims of an unexpired refresh token this backend signed, else `undefined`. */
  async verifyRefreshToken(token: string): Promise<RefreshTokenClaims | undefined> {
    const secret = this.secret('refresh');

    try {
      const claims = await this.jwt.verifyAsync<object>(token, {
        secret,
        algorithms: [JWT_ALGORITHM],
      });
      return isRefreshTokenClaims(claims) ? claims : undefined;
    } catch {
      return undefined;
    }
  }

  private sign(kind: TokenKind, payload: object): Promise<string> {
    return this.jwt.signAsync(payload, { secret: this.secret(kind), algorithm: JWT_ALGORITHM });
  }

  private secret(kind: TokenKind): string {
    return this.config.getOrThrow<string>(SECRET_CONFIG_KEYS[kind]);
  }
}
