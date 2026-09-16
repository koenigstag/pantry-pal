import { UNIT_SYSTEM_PREFERENCES, type UnitSystemPreference } from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import { check, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { inList } from './_sql';

export const users = pgTable(
  'users',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    /** Lowercased by the caller on write, so a plain unique index is enough. */
    email: text('email').notNull().unique(),
    /** Null for accounts that only ever sign in through a provider. */
    passwordHash: text('password_hash'),
    authProvider: text('auth_provider'),
    providerUserId: text('provider_user_id'),
    displayName: text('display_name').notNull(),
    /**
     * Per user rather than per household: two people sharing one fridge can
     * disagree about units, because this renders values, it does not store them.
     */
    unitSystem: text('unit_system').$type<UnitSystemPreference>().notNull().default('metric'),
    timezone: text('timezone').notNull().default('UTC'),
    locale: text('locale').notNull().default('en-GB'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('users_unit_system_check', sql`unit_system in (${inList(UNIT_SYSTEM_PREFERENCES)})`),
    index('users_provider_idx').on(t.authProvider, t.providerUserId),
  ],
);

export const refreshTokens = pgTable(
  'refresh_tokens',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** Only ever the hash: a leaked table must not be replayable. */
    tokenHash: text('token_hash').notNull().unique(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    userAgent: text('user_agent'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('refresh_tokens_user_idx')
      .on(t.userId)
      .where(sql`revoked_at is null`),
  ],
);

export type UserRow = typeof users.$inferSelect;
export type NewUserRow = typeof users.$inferInsert;
export type RefreshTokenRow = typeof refreshTokens.$inferSelect;
