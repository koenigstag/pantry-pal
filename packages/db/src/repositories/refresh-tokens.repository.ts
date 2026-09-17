import { and, eq, isNull, ne, sql } from 'drizzle-orm';

import type { Database } from '../client';
import { refreshTokens, type NewRefreshTokenRow, type RefreshTokenRow } from '../schema';

export type CreateRefreshTokenInput = Pick<
  NewRefreshTokenRow,
  'userId' | 'tokenHash' | 'expiresAt' | 'userAgent'
>;

/**
 * One row per signed-in session, holding the hash of its current refresh token.
 *
 * A refresh rotates the row in place: `token_hash` is replaced and `expires_at`
 * pushed out, so the row's id stays the session's id for its whole life.
 */
export class RefreshTokensRepository {
  constructor(private readonly db: Database) {}

  async create(input: CreateRefreshTokenInput): Promise<RefreshTokenRow> {
    const [row] = await this.db.insert(refreshTokens).values(input).returning();

    if (row === undefined) throw new Error('Insert returned no row');
    return row;
  }

  /**
   * The session, row-locked until the transaction ends. Two refreshes of one
   * session therefore run one after the other, and the second sees the hash the
   * first wrote.
   *
   * `FOR UPDATE` rather than `FOR NO KEY UPDATE`: rotating rewrites `token_hash`,
   * which has a unique index.
   */
  async findForUpdate(id: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await this.db
      .select()
      .from(refreshTokens)
      .where(eq(refreshTokens.id, id))
      .for('update');

    return row;
  }

  async rotate(
    id: string,
    next: Pick<RefreshTokenRow, 'tokenHash' | 'expiresAt'>,
  ): Promise<RefreshTokenRow | undefined> {
    const [row] = await this.db
      .update(refreshTokens)
      .set(next)
      .where(eq(refreshTokens.id, id))
      .returning();

    return row;
  }

  /** Ends every live session of the user, but `exceptId` if given, and returns those it ended. */
  revokeAll(userId: string, exceptId?: string): Promise<RefreshTokenRow[]> {
    return this.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(
        and(
          eq(refreshTokens.userId, userId),
          exceptId === undefined ? undefined : ne(refreshTokens.id, exceptId),
          isNull(refreshTokens.revokedAt),
        ),
      )
      .returning();
  }

  /** Ends a session. `undefined` if it was already ended, or never existed. */
  async revoke(id: string): Promise<RefreshTokenRow | undefined> {
    const [row] = await this.db
      .update(refreshTokens)
      .set({ revokedAt: sql`now()` })
      .where(and(eq(refreshTokens.id, id), isNull(refreshTokens.revokedAt)))
      .returning();

    return row;
  }
}
