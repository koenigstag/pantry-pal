import { sql } from 'drizzle-orm';
import { check, index, pgTable, primaryKey, text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { inList } from './_sql';
import { users } from './users';

export const HOUSEHOLD_ROLE = {
  Owner: 'owner',
  Member: 'member',
} as const;

export type HouseholdRole = (typeof HOUSEHOLD_ROLE)[keyof typeof HOUSEHOLD_ROLE];
export const HOUSEHOLD_ROLES = Object.values(HOUSEHOLD_ROLE);

/**
 * Tenancy exists from day one even for a single user: every domain row is keyed
 * by household, so sharing a fridge later is an INSERT into `household_members`
 * rather than a migration across every table.
 */
export const households = pgTable('households', {
  id: uuid('id').primaryKey().defaultRandom(),
  name: text('name').notNull(),
  createdBy: uuid('created_by')
    .notNull()
    .references(() => users.id, { onDelete: 'restrict' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** The tenancy join. Every domain read is scoped through a row in here. */
export const householdMembers = pgTable(
  'household_members',
  {
    householdId: uuid('household_id')
      .notNull()
      .references(() => households.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role').$type<HouseholdRole>().notNull().default(HOUSEHOLD_ROLE.Member),
    joinedAt: timestamp('joined_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.householdId, t.userId] }),
    check('household_members_role_check', sql`role in (${inList(HOUSEHOLD_ROLES)})`),
    /** Answers "which households am I in" on every authenticated request. */
    index('household_members_user_idx').on(t.userId),
  ],
);

export type HouseholdRow = typeof households.$inferSelect;
export type HouseholdMemberRow = typeof householdMembers.$inferSelect;
