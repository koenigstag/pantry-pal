import { and, desc, eq, gt, isNull, lt, or, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  oauthAuthorizations,
  oauthClients,
  oauthGrants,
  type NewOAuthAuthorizationRow,
  type NewOAuthGrantRow,
  type OAuthAuthorizationRow,
  type OAuthClientRow,
  type OAuthGrantRow,
} from '../schema';

export type CreateAuthorizationInput = Pick<
  NewOAuthAuthorizationRow,
  'clientId' | 'redirectUri' | 'codeChallenge' | 'scopes' | 'state' | 'expiresAt'
>;

export type CreateGrantInput = Pick<
  NewOAuthGrantRow,
  | 'clientId'
  | 'userId'
  | 'scopes'
  | 'accessTokenHash'
  | 'accessExpiresAt'
  | 'refreshTokenHash'
  | 'refreshExpiresAt'
>;

export type GrantTokens = Pick<
  OAuthGrantRow,
  'accessTokenHash' | 'accessExpiresAt' | 'refreshTokenHash' | 'refreshExpiresAt'
>;

/** A connection as its user sees it: the grant and the name its client registered. */
export type GrantWithClientRow = OAuthGrantRow & { clientInformation: Record<string, unknown> };

/** How often a connection's `last_used_at` is written: once per window, not per request. */
const LAST_USED_WINDOW = sql`interval '5 minutes'`;

/**
 * The OAuth authorization server's rows: registered clients, authorization
 * requests and the codes they turn into, and the grants that hold tokens.
 * Callers pass hashes, never codes or tokens.
 */
export class OAuthRepository {
  constructor(private readonly db: Database) {}

  async findClient(id: string): Promise<OAuthClientRow | undefined> {
    const [row] = await this.db.select().from(oauthClients).where(eq(oauthClients.id, id));
    return row;
  }

  async createClient(id: string, information: Record<string, unknown>): Promise<OAuthClientRow> {
    const [row] = await this.db.insert(oauthClients).values({ id, information }).returning();
    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  async createAuthorization(input: CreateAuthorizationInput): Promise<OAuthAuthorizationRow> {
    const [row] = await this.db.insert(oauthAuthorizations).values(input).returning();
    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  /** A request still waiting for the user's answer: not answered, not expired. */
  async findPendingAuthorization(id: string): Promise<OAuthAuthorizationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oauthAuthorizations)
      .where(and(eq(oauthAuthorizations.id, id), this.pending()));
    return row;
  }

  /**
   * Records the user's approval and the code's hash, if the request is still
   * pending: of two answers racing, one wins and the other finds nothing.
   */
  async approve(
    id: string,
    userId: string,
    codeHash: string,
  ): Promise<OAuthAuthorizationRow | undefined> {
    const [row] = await this.db
      .update(oauthAuthorizations)
      .set({ userId, codeHash })
      .where(and(eq(oauthAuthorizations.id, id), this.pending()))
      .returning();
    return row;
  }

  /** Ends a pending request the user turned down. */
  async deny(id: string): Promise<OAuthAuthorizationRow | undefined> {
    const [row] = await this.db
      .update(oauthAuthorizations)
      .set({ consumedAt: sql`now()` })
      .where(and(eq(oauthAuthorizations.id, id), this.pending()))
      .returning();
    return row;
  }

  /** An approved request by its code's hash, whether or not the code is still good. */
  async findByCodeHash(codeHash: string): Promise<OAuthAuthorizationRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oauthAuthorizations)
      .where(eq(oauthAuthorizations.codeHash, codeHash));
    return row;
  }

  /**
   * Spends a code: only once, and only before it expires. Answers `undefined`
   * for a code already spent, so two exchanges of one code cannot both succeed.
   */
  async consumeCode(codeHash: string): Promise<OAuthAuthorizationRow | undefined> {
    const [row] = await this.db
      .update(oauthAuthorizations)
      .set({ consumedAt: sql`now()` })
      .where(
        and(
          eq(oauthAuthorizations.codeHash, codeHash),
          isNull(oauthAuthorizations.consumedAt),
          gt(oauthAuthorizations.expiresAt, sql`now()`),
        ),
      )
      .returning();
    return row;
  }

  async createGrant(input: CreateGrantInput): Promise<OAuthGrantRow> {
    const [row] = await this.db.insert(oauthGrants).values(input).returning();
    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  /**
   * The live grant an access token belongs to, its use recorded at most once
   * per window so a busy connection does not write on every request.
   */
  async useAccessToken(accessTokenHash: string): Promise<OAuthGrantRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oauthGrants)
      .where(
        and(
          eq(oauthGrants.accessTokenHash, accessTokenHash),
          isNull(oauthGrants.revokedAt),
          gt(oauthGrants.accessExpiresAt, sql`now()`),
        ),
      );
    if (row === undefined) return undefined;

    await this.db
      .update(oauthGrants)
      .set({ lastUsedAt: sql`now()` })
      .where(
        and(
          eq(oauthGrants.id, row.id),
          or(
            isNull(oauthGrants.lastUsedAt),
            lt(oauthGrants.lastUsedAt, sql`now() - ${LAST_USED_WINDOW}`),
          ),
        ),
      );
    return row;
  }

  /**
   * The live grant a refresh token belongs to, row-locked until the transaction
   * ends, so two refreshes with one token run one after the other and the
   * second finds the hash the first replaced.
   */
  async findByRefreshTokenForUpdate(refreshTokenHash: string): Promise<OAuthGrantRow | undefined> {
    const [row] = await this.db
      .select()
      .from(oauthGrants)
      .where(
        and(
          eq(oauthGrants.refreshTokenHash, refreshTokenHash),
          isNull(oauthGrants.revokedAt),
          gt(oauthGrants.refreshExpiresAt, sql`now()`),
        ),
      )
      .for('update');
    return row;
  }

  /** Replaces both tokens of a grant, in place. */
  async rotate(id: string, next: GrantTokens): Promise<OAuthGrantRow | undefined> {
    const [row] = await this.db
      .update(oauthGrants)
      .set({ ...next, lastUsedAt: sql`now()` })
      .where(eq(oauthGrants.id, id))
      .returning();
    return row;
  }

  /** Revokes the grant either token belongs to, when the client sends one back. */
  async revokeByTokenHash(clientId: string, tokenHash: string): Promise<void> {
    await this.db
      .update(oauthGrants)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(oauthGrants.clientId, clientId),
          isNull(oauthGrants.revokedAt),
          or(
            eq(oauthGrants.accessTokenHash, tokenHash),
            eq(oauthGrants.refreshTokenHash, tokenHash),
          ),
        ),
      );
  }

  /** The user's connections that can still be used or refreshed, newest first. */
  async listLiveGrants(userId: string): Promise<GrantWithClientRow[]> {
    const rows = await this.db
      .select({ grant: oauthGrants, clientInformation: oauthClients.information })
      .from(oauthGrants)
      .innerJoin(oauthClients, eq(oauthClients.id, oauthGrants.clientId))
      .where(
        and(
          eq(oauthGrants.userId, userId),
          isNull(oauthGrants.revokedAt),
          gt(oauthGrants.refreshExpiresAt, sql`now()`),
        ),
      )
      .orderBy(desc(oauthGrants.createdAt));
    return rows.map(({ grant, clientInformation }) => Object.assign(grant, { clientInformation }));
  }

  /** Disconnects one of the user's connections; `undefined` if it is not theirs or not live. */
  async revokeGrant(userId: string, id: string): Promise<OAuthGrantRow | undefined> {
    const [row] = await this.db
      .update(oauthGrants)
      .set({ revokedAt: sql`now()` })
      .where(
        and(eq(oauthGrants.id, id), eq(oauthGrants.userId, userId), isNull(oauthGrants.revokedAt)),
      )
      .returning();
    return row;
  }

  private pending() {
    return and(
      isNull(oauthAuthorizations.userId),
      isNull(oauthAuthorizations.consumedAt),
      gt(oauthAuthorizations.expiresAt, sql`now()`),
    );
  }
}
