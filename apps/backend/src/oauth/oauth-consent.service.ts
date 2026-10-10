import { Injectable, NotFoundException } from '@nestjs/common';
import { OAuthRepository, type OAuthAuthorizationRow } from '@pantry-pal/db';
import type { OAuthConnections, OAuthConsentRequest, OAuthRedirect } from '@pantry-pal/shared';

import { hashSecret, newSecret, PantryOAuthProvider } from './oauth-provider';

/** What a client registered itself as, for people to recognise it by. */
function clientName(information: Record<string, unknown>, redirectUri: string | undefined): string {
  const name = information.client_name;
  if (typeof name === 'string' && name.trim() !== '') return name.trim();
  if (redirectUri !== undefined) return new URL(redirectUri).host;
  return typeof information.client_id === 'string' ? information.client_id : 'Unknown app';
}

/**
 * The user's side of OAuth: answering an assistant's request for access on the
 * consent page, and the connections they have granted. Every method acts for
 * the signed-in user, so a request id alone grants nothing — it names a request
 * to show, and only its user's answer turns it into a code.
 */
@Injectable()
export class OAuthConsentService {
  constructor(
    private readonly oauth: OAuthRepository,
    private readonly provider: PantryOAuthProvider,
  ) {}

  /** A request still waiting for an answer; 404 once answered or expired. */
  async request(id: string): Promise<OAuthConsentRequest> {
    const row = await this.pending(id);
    const client = await this.oauth.findClient(row.clientId);
    return {
      id: row.id,
      clientName: clientName(client?.information ?? {}, row.redirectUri),
      redirectHost: new URL(row.redirectUri).host,
      scopes: row.scopes,
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  /** The user allowed it: a one-time code for the client, sent with its `state`. */
  async approve(id: string, userId: string): Promise<OAuthRedirect> {
    const code = newSecret('ppc');
    const row = await this.oauth.approve(id, userId, hashSecret(code));
    if (row === undefined) throw notPending();
    return { redirectTo: redirect(row, { code }) };
  }

  /** The user said no: the client hears `access_denied`, as OAuth spells it. */
  async deny(id: string): Promise<OAuthRedirect> {
    const row = await this.oauth.deny(id);
    if (row === undefined) throw notPending();
    return { redirectTo: redirect(row, { error: 'access_denied' }) };
  }

  async connections(userId: string): Promise<OAuthConnections> {
    const rows = await this.oauth.listLiveGrants(userId);
    return {
      mcpUrl: this.provider.resourceUrl.href,
      connections: rows.map((row) => ({
        id: row.id,
        clientName: clientName(row.clientInformation, firstRedirect(row.clientInformation)),
        createdAt: row.createdAt.toISOString(),
        lastUsedAt: row.lastUsedAt?.toISOString() ?? null,
      })),
    };
  }

  /** Ends every token the connection issued: the assistant has to ask again. */
  async disconnect(userId: string, id: string): Promise<void> {
    const row = await this.oauth.revokeGrant(userId, id);
    if (row === undefined) throw new NotFoundException('Connection not found');
  }

  private async pending(id: string): Promise<OAuthAuthorizationRow> {
    const row = await this.oauth.findPendingAuthorization(id);
    if (row === undefined) throw notPending();
    return row;
  }
}

const notPending = (): NotFoundException =>
  new NotFoundException(
    'This request has expired or was answered already. Start connecting again.',
  );

function firstRedirect(information: Record<string, unknown>): string | undefined {
  const uris = information.redirect_uris;
  return Array.isArray(uris) && typeof uris[0] === 'string' ? uris[0] : undefined;
}

/** The client's redirect URI with the answer, and the `state` it sent, as OAuth requires. */
function redirect(row: OAuthAuthorizationRow, answer: Record<string, string>): string {
  const url = new URL(row.redirectUri);
  for (const [key, value] of Object.entries(answer)) url.searchParams.set(key, value);
  if (row.state !== null) url.searchParams.set('state', row.state);
  return url.href;
}
