import {
  PUSH_ACTIVITY_TOPICS,
  PUSH_TOPICS,
  type PushActivityTopic,
  type PushTopic,
} from '@pantry-pal/shared';
import { sql } from 'drizzle-orm';
import { bigint, check, date, index, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { inList } from './_sql';
import { households } from './households';
import { refreshTokens, users } from './users';

/**
 * A browser registered for push notifications: one row per push endpoint,
 * which a browser hands out once per profile, so the endpoint is the device.
 *
 * It belongs to the session that registered it, and goes with it: signing out
 * deletes the row (`SessionsService`), and a session past its expiry receives
 * nothing, so notifications reach only devices someone is signed in on. A
 * browser registering again under another account takes the row over.
 *
 * User-owned like `oauth_grants`: it references `users` only, and who hears
 * about a household is decided by `household_members` when a notification goes
 * out.
 */
export const pushDevices = pgTable(
  'push_devices',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    sessionId: uuid('session_id')
      .notNull()
      .references(() => refreshTokens.id, { onDelete: 'cascade' }),
    /** The push service's URL for this browser. Whoever holds it can send to the device: never log it. */
    endpoint: text('endpoint').notNull().unique(),
    /** The browser's P-256 public key and auth secret, base64url: each push is encrypted to them. */
    p256dh: text('p256dh').notNull(),
    auth: text('auth').notNull(),
    topics: text('topics')
      .array()
      .$type<PushTopic[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    /**
     * The day, in the user's time zone, this device was last sent the expiry
     * notification: claiming it is what makes that go out once a day.
     */
    expiryNotifiedOn: date('expiry_notified_on'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    check('push_devices_topics_check', sql`topics <@ array[${inList(PUSH_TOPICS)}]::text[]`),
    index('push_devices_user_idx').on(t.userId),
    index('push_devices_session_idx').on(t.sessionId),
  ],
);

/**
 * What members did that others may want to hear about, waiting to go out.
 *
 * A service writes a row in the transaction of the write itself, so a write
 * that rolls back leaves nothing to announce. A job sends a group — one
 * member, one topic, one list — once that member has paused, and deletes it,
 * so ten things put on a list in a row are one notification.
 *
 * Ids are kept bare, without foreign keys: by the time a row goes out, the item
 * or list it names may be gone, and the notification simply leaves it out.
 */
export const pushOutbox = pgTable(
  'push_outbox',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    /** Who did it: never notified about it. */
    actorId: uuid('actor_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    topic: text('topic').$type<PushActivityTopic>().notNull(),
    /** The list, for the list topics. */
    listId: uuid('list_id'),
    /** The item put on the list or bought. */
    itemId: uuid('item_id'),
    /** The user who joined, for `members`. */
    memberId: uuid('member_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('push_outbox_topic_check', sql`topic in (${inList(PUSH_ACTIVITY_TOPICS)})`),
    index('push_outbox_group_idx').on(t.householdId, t.actorId, t.topic, t.listId),
  ],
);

export type PushDeviceRow = typeof pushDevices.$inferSelect;
export type NewPushDeviceRow = typeof pushDevices.$inferInsert;
export type PushOutboxRow = typeof pushOutbox.$inferSelect;
export type NewPushOutboxRow = typeof pushOutbox.$inferInsert;
