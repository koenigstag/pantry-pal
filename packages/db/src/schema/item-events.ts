import { sql } from 'drizzle-orm';
import { check, index, jsonb, numeric, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { inList } from './_sql';
import { households } from './households';
import { items } from './items';
import { users } from './users';

export const ITEM_EVENT_TYPE = {
  Added: 'added',
  Updated: 'updated',
  Opened: 'opened',
  Consumed: 'consumed',
  Discarded: 'discarded',
  Restored: 'restored',
} as const;

export type ItemEventType = (typeof ITEM_EVENT_TYPE)[keyof typeof ITEM_EVENT_TYPE];
export const ITEM_EVENT_TYPES = Object.values(ITEM_EVENT_TYPE);

/** Append-only. Feeds the activity feed, waste statistics and undo. */
export const itemEvents = pgTable(
  'item_events',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    itemId: uuid('item_id')
      .notNull()
      .references(() => items.id, { onDelete: 'cascade' }),
    /** Null survives a member leaving the household; the history stays intact. */
    userId: uuid('user_id').references(() => users.id, { onDelete: 'set null' }),
    type: text('type').$type<ItemEventType>().notNull(),
    /** Negative when consumed or discarded, so waste reports are a plain SUM. */
    quantityDelta: numeric('quantity_delta', { precision: 10, scale: 3, mode: 'number' }),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    check('item_events_type_check', sql`type in (${inList(ITEM_EVENT_TYPES)})`),
    index('item_events_household_idx').on(t.householdId, t.createdAt.desc()),
    index('item_events_item_idx').on(t.itemId, t.createdAt.desc()),
  ],
);

export type ItemEventRow = typeof itemEvents.$inferSelect;
export type NewItemEventRow = typeof itemEvents.$inferInsert;
