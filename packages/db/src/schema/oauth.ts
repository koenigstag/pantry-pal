import { sql } from 'drizzle-orm';
import { index, jsonb, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { users } from './users';

/*
 * The OAuth 2.1 authorization server behind the MCP endpoint, which lets an
 * assistant elsewhere — claude.ai, ChatGPT — act for a user on their pantry.
 * Codes and tokens are stored only as their SHA-256, like `refresh_tokens`, so
 * a leaked table replays nothing.
 */

/**
 * A client that registered itself (RFC 7591 dynamic registration): its id is
 * the key, and everything it registered — name, redirect URIs, and the secret
 * of a confidential client, which the MCP SDK compares as given — is kept as
 * it was registered.
 */
export const oauthClients = pgTable('oauth_clients', {
  id: text('id').primaryKey(),
  information: jsonb('information').$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One authorization request, from the client's redirect to the user's answer
 * and the code's exchange. Pending while `user_id` is null; approving it sets
 * the user and the code's hash; exchanging the code, or denying, consumes it.
 * Short-lived: `expires_at` covers the whole round trip.
 */
export const oauthAuthorizations = pgTable('oauth_authorizations', {
  id: uuid('id').primaryKey().defaultRandom(),
  clientId: text('client_id')
    .notNull()
    .references(() => oauthClients.id, { onDelete: 'cascade' }),
  userId: uuid('user_id').references(() => users.id, { onDelete: 'cascade' }),
  redirectUri: text('redirect_uri').notNull(),
  codeChallenge: text('code_challenge').notNull(),
  scopes: text('scopes')
    .array()
    .notNull()
    .default(sql`'{}'::text[]`),
  state: text('state'),
  codeHash: text('code_hash').unique(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  consumedAt: timestamp('consumed_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});

/**
 * What a user granted a client: one row per approval, holding the hashes of
 * its current access and refresh tokens. A refresh rotates both in place, so
 * the row id names the connection for its whole life, and revoking it — the
 * user disconnecting the app — ends every token it issued.
 */
export const oauthGrants = pgTable(
  'oauth_grants',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    clientId: text('client_id')
      .notNull()
      .references(() => oauthClients.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    scopes: text('scopes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    accessTokenHash: text('access_token_hash').notNull().unique(),
    accessExpiresAt: timestamp('access_expires_at', { withTimezone: true }).notNull(),
    refreshTokenHash: text('refresh_token_hash').notNull().unique(),
    refreshExpiresAt: timestamp('refresh_expires_at', { withTimezone: true }).notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('oauth_grants_user_idx')
      .on(t.userId)
      .where(sql`revoked_at is null`),
  ],
);

export type OAuthClientRow = typeof oauthClients.$inferSelect;
export type OAuthAuthorizationRow = typeof oauthAuthorizations.$inferSelect;
export type NewOAuthAuthorizationRow = typeof oauthAuthorizations.$inferInsert;
export type OAuthGrantRow = typeof oauthGrants.$inferSelect;
export type NewOAuthGrantRow = typeof oauthGrants.$inferInsert;
