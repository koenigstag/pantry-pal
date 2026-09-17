import { Injectable, UnauthorizedException } from '@nestjs/common';
import {
  PROPAGATION,
  RefreshTokensRepository,
  Transactional,
  UsersRepository,
  type RefreshTokenRow,
  type UserRow,
} from '@pantry-pal/db';
import type { AuthSession } from '@pantry-pal/shared';

import { ChangeFeed } from '../realtime/change-feed';
import { toAuthenticatedUser } from './identity.service';
import {
  ACCESS_TOKEN_TTL_SECONDS,
  hashesEqual,
  hashTokenId,
  newTokenId,
  REFRESH_TOKEN_TTL_MS,
  type RefreshTokenClaims,
} from './session-tokens';
import { TokenSigner } from './token-signer';

/** `refresh_tokens.user_agent` is informational; a longer header is cut, not refused. */
const MAX_USER_AGENT_LENGTH = 512;

/** Decided inside the transaction, acted on after it commits. */
type Rotation =
  | { readonly outcome: 'rotated'; readonly session: RefreshTokenRow; readonly tokenId: string }
  | { readonly outcome: 'refused' };

const refreshExpiry = (): Date => new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

const toSeconds = (date: Date): number => Math.floor(date.getTime() / 1000);

const refused = (): UnauthorizedException =>
  new UnauthorizedException('The refresh token is invalid, expired or already used: sign in again');

/**
 * A session is one `refresh_tokens` row. Both of its tokens are JWTs naming the
 * user (`sub`) and the session (`sid`), each signed with its own secret. The
 * refresh token adds a `jti`, and the row stores only that `jti`'s hash.
 *
 * Every refresh issues a new `jti`. A refresh token this backend signed for a
 * live session, whose `jti` the row no longer holds, has been used already, so it
 * was copied: the session ends for whoever holds either copy.
 */
@Injectable()
export class SessionsService {
  constructor(
    private readonly tokens: TokenSigner,
    private readonly refreshTokens: RefreshTokensRepository,
    private readonly users: UsersRepository,
    private readonly changes: ChangeFeed,
  ) {}

  /** A new session for a user who has just proved who they are. */
  async start(user: UserRow, userAgent: string | undefined): Promise<AuthSession> {
    const tokenId = newTokenId();
    const session = await this.refreshTokens.create({
      userId: user.id,
      tokenHash: hashTokenId(tokenId),
      expiresAt: refreshExpiry(),
      userAgent: userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    });

    return this.issue(user, session, tokenId);
  }

  /** Exchanges a refresh token for a new pair. Anything wrong with it is a 401. */
  async refresh(refreshToken: string): Promise<AuthSession> {
    const claims = await this.tokens.verifyRefreshToken(refreshToken);
    if (claims === undefined) throw refused();

    // The rotation commits before anything is thrown, so a reuse's revocation sticks.
    const rotation = await this.rotate(claims);
    if (rotation.outcome === 'refused') throw refused();

    const user = await this.users.findById(rotation.session.userId);
    if (user === undefined) throw refused();

    return this.issue(user, rotation.session, rotation.tokenId);
  }

  /**
   * Signs out: ends the session the token belongs to. A token that is not the
   * session's current one changes nothing, so a stale copy cannot sign anyone out.
   */
  async end(refreshToken: string): Promise<void> {
    const claims = await this.tokens.verifyRefreshToken(refreshToken);
    if (claims !== undefined) await this.endCurrent(claims);
  }

  /**
   * Locks the session and answers 401 unless it is live and the user's. An access
   * token outlives its session by up to 15 minutes; what it may still do there
   * does not include anything that needs this check.
   */
  @Transactional({ propagation: PROPAGATION.Mandatory })
  async assertLive(sessionId: string, userId: string): Promise<void> {
    const session = await this.refreshTokens.findForUpdate(sessionId);

    if (
      session === undefined ||
      session.userId !== userId ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date()
    ) {
      throw new UnauthorizedException('This session has ended: sign in again');
    }
  }

  /** Ends every session of the user but `exceptSessionId`, and closes the sockets they opened. */
  @Transactional({ propagation: PROPAGATION.Mandatory })
  async endAll(userId: string, exceptSessionId?: string): Promise<void> {
    const ended = await this.refreshTokens.revokeAll(userId, exceptSessionId);
    for (const session of ended) this.announceRevoked(session);
  }

  @Transactional()
  private async endCurrent({ sub, sid, jti }: RefreshTokenClaims): Promise<void> {
    const session = await this.refreshTokens.findForUpdate(sid);
    if (
      session === undefined ||
      session.userId !== sub ||
      !hashesEqual(hashTokenId(jti), session.tokenHash)
    ) {
      return;
    }

    await this.revoke(session);
  }

  @Transactional()
  private async rotate({ sub, sid, jti }: RefreshTokenClaims): Promise<Rotation> {
    const session = await this.refreshTokens.findForUpdate(sid);
    if (
      session === undefined ||
      session.userId !== sub ||
      session.revokedAt !== null ||
      session.expiresAt <= new Date()
    ) {
      return { outcome: 'refused' };
    }

    if (!hashesEqual(hashTokenId(jti), session.tokenHash)) {
      await this.revoke(session);
      return { outcome: 'refused' };
    }

    const next = newTokenId();
    const rotated = await this.refreshTokens.rotate(session.id, {
      tokenHash: hashTokenId(next),
      expiresAt: refreshExpiry(),
    });

    return rotated === undefined
      ? { outcome: 'refused' }
      : { outcome: 'rotated', session: rotated, tokenId: next };
  }

  private async revoke(session: RefreshTokenRow): Promise<void> {
    const revoked = await this.refreshTokens.revoke(session.id);
    if (revoked !== undefined) this.announceRevoked(revoked);
  }

  /**
   * A socket authenticates once, at its handshake, so the gateway closes the ones
   * this session opened. Published on commit, like every change.
   */
  private announceRevoked(session: RefreshTokenRow): void {
    this.changes.publish({
      type: 'session.revoked',
      userId: session.userId,
      sessionId: session.id,
    });
  }

  private async issue(
    user: UserRow,
    session: RefreshTokenRow,
    tokenId: string,
  ): Promise<AuthSession> {
    const claims = { sub: user.id, sid: session.id };
    const accessExpiresAt = toSeconds(new Date()) + ACCESS_TOKEN_TTL_SECONDS;
    const refreshExpiresAt = toSeconds(session.expiresAt);

    const [accessToken, refreshToken] = await Promise.all([
      this.tokens.signAccessToken(claims, accessExpiresAt),
      this.tokens.signRefreshToken({ ...claims, jti: tokenId }, refreshExpiresAt),
    ]);

    return {
      user: toAuthenticatedUser(user),
      accessToken,
      accessTokenExpiresAt: new Date(accessExpiresAt * 1000).toISOString(),
      refreshToken,
      refreshTokenExpiresAt: new Date(refreshExpiresAt * 1000).toISOString(),
    };
  }
}
