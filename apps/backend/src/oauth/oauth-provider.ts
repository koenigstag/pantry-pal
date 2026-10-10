import { createHash, randomBytes, randomUUID } from 'node:crypto';

import type { OAuthRegisteredClientsStore } from '@modelcontextprotocol/sdk/server/auth/clients.js';
import {
  InvalidGrantError,
  InvalidScopeError,
  InvalidTargetError,
  InvalidTokenError,
} from '@modelcontextprotocol/sdk/server/auth/errors.js';
import type {
  AuthorizationParams,
  OAuthServerProvider,
} from '@modelcontextprotocol/sdk/server/auth/provider.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import type {
  OAuthClientInformationFull,
  OAuthTokenRevocationRequest,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OAuthRepository, Transactional, type OAuthGrantRow } from '@pantry-pal/db';
import { MCP_PATH, MCP_SCOPE, OAUTH_CONSENT_ROUTE, OAUTH_REQUEST_PARAM } from '@pantry-pal/shared';
import type { Response } from 'express';

/** The whole round trip: the user signing in, reading the consent page, and the client exchanging the code. */
export const AUTHORIZATION_TTL_MS = 10 * 60_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60_000;
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

/** A secret of 256 random bits, prefixed so a leaked one is recognisable in logs and scanners. */
export const newSecret = (prefix: string): string =>
  `${prefix}_${randomBytes(32).toString('base64url')}`;

/** Codes and tokens are stored only as this. */
export const hashSecret = (secret: string): string =>
  createHash('sha256').update(secret).digest('hex');

/** What `AuthInfo.extra` carries for the MCP server: whose token it is. */
export interface PantryAuthExtra {
  userId: string;
  grantId: string;
}

/**
 * The OAuth 2.1 authorization server behind the MCP endpoint, for the MCP
 * SDK's router, which handles the protocol — metadata, dynamic registration,
 * PKCE, the token endpoint — and calls this for everything stored.
 *
 * The user's consent is not given here: `authorize` records the request and
 * sends the browser to the web app's consent page, where the signed-in user
 * allows or denies it (`OAuthConsentService`), and the page sends the browser
 * on to the client with a code or an error.
 *
 * Every code and token is a random secret stored as its hash. A grant holds an
 * access token (an hour) and a refresh token (30 days), both replaced at each
 * refresh, so a grant is one connection for its whole life and revoking it
 * ends every token it issued.
 */
@Injectable()
export class PantryOAuthProvider implements OAuthServerProvider {
  readonly clientsStore: OAuthRegisteredClientsStore;
  /** The MCP endpoint: the one resource tokens are issued for. */
  readonly resourceUrl: URL;
  private readonly consentUrl: string;

  constructor(
    private readonly oauth: OAuthRepository,
    config: ConfigService,
  ) {
    this.resourceUrl = new URL(MCP_PATH, `${config.getOrThrow<string>('publicUrl')}/`);
    this.consentUrl = `${config.getOrThrow<string>('frontendUrl')}${OAUTH_CONSENT_ROUTE}`;

    this.clientsStore = {
      getClient: async (clientId) => {
        const row = await this.oauth.findClient(clientId);
        return row === undefined ? undefined : (row.information as OAuthClientInformationFull);
      },
      registerClient: async (client) => {
        // The router names it already; a client without an id would be a library change.
        const full = client as OAuthClientInformationFull;
        const id = full.client_id ?? randomUUID();
        const information: OAuthClientInformationFull = { ...full, client_id: id };
        await this.oauth.createClient(id, { ...information });
        return information;
      },
    };
  }

  async authorize(
    client: OAuthClientInformationFull,
    params: AuthorizationParams,
    res: Response,
  ): Promise<void> {
    this.assertResource(params.resource);
    const scopes = this.grantedScopes(params.scopes);

    const request = await this.oauth.createAuthorization({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scopes,
      state: params.state ?? null,
      expiresAt: new Date(Date.now() + AUTHORIZATION_TTL_MS),
    });

    const consent = new URL(this.consentUrl);
    consent.searchParams.set(OAUTH_REQUEST_PARAM, request.id);
    res.redirect(302, consent.href);
  }

  async challengeForAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
  ): Promise<string> {
    const row = await this.oauth.findByCodeHash(hashSecret(authorizationCode));
    if (row === undefined || row.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid authorization code');
    }
    return row.codeChallenge;
  }

  /** Spends the code — once, before it expires, by the client it was issued to — for a new grant. */
  @Transactional()
  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull,
    authorizationCode: string,
    _codeVerifier?: string,
    redirectUri?: string,
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.assertResource(resource);

    const row = await this.oauth.consumeCode(hashSecret(authorizationCode));
    if (row === undefined || row.clientId !== client.client_id || row.userId === null) {
      throw new InvalidGrantError('Invalid or expired authorization code');
    }
    if (redirectUri !== undefined && redirectUri !== row.redirectUri) {
      throw new InvalidGrantError('redirect_uri does not match the authorization request');
    }

    const tokens = issueTokens();
    const grant = await this.oauth.createGrant({
      clientId: client.client_id,
      userId: row.userId,
      scopes: row.scopes,
      ...tokens.hashed,
    });
    return toOAuthTokens(tokens.plain, grant);
  }

  /** Replaces both tokens of the grant the refresh token belongs to. */
  @Transactional()
  async exchangeRefreshToken(
    client: OAuthClientInformationFull,
    refreshToken: string,
    scopes?: string[],
    resource?: URL,
  ): Promise<OAuthTokens> {
    this.assertResource(resource);

    const grant = await this.oauth.findByRefreshTokenForUpdate(hashSecret(refreshToken));
    if (grant === undefined || grant.clientId !== client.client_id) {
      throw new InvalidGrantError('Invalid or expired refresh token');
    }
    if (scopes !== undefined && scopes.some((scope) => !grant.scopes.includes(scope))) {
      throw new InvalidScopeError('A refresh cannot add scopes the user did not grant');
    }

    const tokens = issueTokens();
    const rotated = await this.oauth.rotate(grant.id, tokens.hashed);
    if (rotated === undefined) throw new InvalidGrantError('The connection no longer exists');
    return toOAuthTokens(tokens.plain, rotated);
  }

  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const grant = await this.oauth.useAccessToken(hashSecret(token));
    if (grant === undefined) throw new InvalidTokenError('Invalid or expired access token');

    const extra: PantryAuthExtra = { userId: grant.userId, grantId: grant.id };
    return {
      token,
      clientId: grant.clientId,
      scopes: grant.scopes,
      expiresAt: Math.floor(grant.accessExpiresAt.getTime() / 1000),
      resource: this.resourceUrl,
      extra: { ...extra },
    };
  }

  async revokeToken(
    client: OAuthClientInformationFull,
    request: OAuthTokenRevocationRequest,
  ): Promise<void> {
    await this.oauth.revokeByTokenHash(client.client_id, hashSecret(request.token));
  }

  /** Tokens are only ever for the MCP endpoint; a client asking for another resource is refused. */
  private assertResource(resource: URL | undefined): void {
    if (resource === undefined) return;
    if (comparable(resource) !== comparable(this.resourceUrl)) {
      throw new InvalidTargetError(`This server issues tokens for ${this.resourceUrl.href} only`);
    }
  }

  /** The one scope there is, whatever the client asked for, as long as it asked for nothing else. */
  private grantedScopes(requested: string[] | undefined): string[] {
    const unknown = (requested ?? []).filter((scope) => scope !== '' && scope !== MCP_SCOPE);
    if (unknown.length > 0) throw new InvalidScopeError(`Unknown scope: ${unknown.join(' ')}`);
    return [MCP_SCOPE];
  }
}

/** A resource URL as RFC 8707 compares them: without a fragment or a trailing slash. */
const comparable = (url: URL): string => url.href.replace(/#.*$/, '').replace(/\/$/, '');

interface IssuedTokens {
  plain: { accessToken: string; refreshToken: string };
  hashed: Pick<
    OAuthGrantRow,
    'accessTokenHash' | 'accessExpiresAt' | 'refreshTokenHash' | 'refreshExpiresAt'
  >;
}

function issueTokens(): IssuedTokens {
  const accessToken = newSecret('ppa');
  const refreshToken = newSecret('ppr');
  const now = Date.now();
  return {
    plain: { accessToken, refreshToken },
    hashed: {
      accessTokenHash: hashSecret(accessToken),
      accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      refreshTokenHash: hashSecret(refreshToken),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  };
}

function toOAuthTokens(plain: IssuedTokens['plain'], grant: OAuthGrantRow): OAuthTokens {
  return {
    access_token: plain.accessToken,
    token_type: 'bearer',
    expires_in: Math.floor((grant.accessExpiresAt.getTime() - Date.now()) / 1000),
    refresh_token: plain.refreshToken,
    scope: grant.scopes.join(' '),
  };
}
