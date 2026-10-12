import type { PushActivityTopic, PushTopic } from '@pantry-pal/shared';
import { and, arrayContains, desc, eq, gt, inArray, isNull, lte, ne, sql } from 'drizzle-orm';

import type { Database } from '../client';
import {
  householdMembers,
  pushDevices,
  pushOutbox,
  refreshTokens,
  users,
  type NewPushDeviceRow,
  type NewPushOutboxRow,
  type PushDeviceRow,
  type PushOutboxRow,
} from '../schema';

export type RegisterPushDeviceInput = Pick<
  NewPushDeviceRow,
  'userId' | 'sessionId' | 'endpoint' | 'p256dh' | 'auth' | 'topics'
>;

/** A device a notification goes to, with the language its owner reads the app in. */
export interface PushTarget {
  id: string;
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  locale: string;
}

/** A device claimed for today's expiry notification: `today` is its owner's, `YYYY-MM-DD`. */
export interface ExpiryClaim extends PushTarget {
  today: string;
}

/**
 * Browsers registered for push notifications, and the devices each
 * notification goes to.
 *
 * Every read of targets keeps to devices whose session is still live: not
 * revoked — signing out deletes the device anyway — and not past its expiry, so
 * a browser nobody has opened the app in for a month stops being sent to.
 */
export class PushDevicesRepository {
  constructor(private readonly db: Database) {}

  /**
   * Registers a browser, or updates the one registered at that endpoint: its
   * keys, its topics, and the account and session it now belongs to. A browser
   * another account takes over starts its own day, so it is not skipped for an
   * expiry notification the previous account had.
   */
  async register(input: RegisterPushDeviceInput): Promise<PushDeviceRow> {
    const [row] = await this.db
      .insert(pushDevices)
      .values(input)
      .onConflictDoUpdate({
        target: pushDevices.endpoint,
        set: {
          userId: sql`excluded.user_id`,
          sessionId: sql`excluded.session_id`,
          p256dh: sql`excluded.p256dh`,
          auth: sql`excluded.auth`,
          topics: sql`excluded.topics`,
          expiryNotifiedOn: sql`case when ${pushDevices.userId} = excluded.user_id then ${pushDevices.expiryNotifiedOn} end`,
          updatedAt: sql`now()`,
        },
      })
      .returning();

    if (row === undefined) throw new Error('Upsert returned no row');
    return row;
  }

  /** The user's devices, newest first. */
  listForUser(userId: string): Promise<PushDeviceRow[]> {
    return this.db
      .select()
      .from(pushDevices)
      .where(eq(pushDevices.userId, userId))
      .orderBy(desc(pushDevices.createdAt), desc(pushDevices.id));
  }

  /** One of the user's devices, removed. `undefined` if it is not theirs, or gone already. */
  async deleteForUser(userId: string, id: string): Promise<PushDeviceRow | undefined> {
    const [row] = await this.db
      .delete(pushDevices)
      .where(and(eq(pushDevices.id, id), eq(pushDevices.userId, userId)))
      .returning();

    return row;
  }

  /** The devices registered from these sessions, which have ended. */
  async deleteForSessions(sessionIds: readonly string[]): Promise<void> {
    if (sessionIds.length === 0) return;
    await this.db.delete(pushDevices).where(inArray(pushDevices.sessionId, [...sessionIds]));
  }

  /** A device its push service says is gone: unsubscribed, or the browser data cleared. */
  async delete(id: string): Promise<void> {
    await this.db.delete(pushDevices).where(eq(pushDevices.id, id));
  }

  /** The devices registered from one session, whatever their topics: where a test goes. */
  targetsForSession(sessionId: string): Promise<PushTarget[]> {
    return this.selectTargets().where(eq(pushDevices.sessionId, sessionId));
  }

  /**
   * The devices of a household's members that want `topic`, but the one who set
   * it off: nobody is told about what they did themselves. Only members who had
   * joined by `joinedBy` — database text, to the microsecond — so someone added
   * a minute ago is not told what was put on a list before they were there.
   */
  targetsInHousehold(
    householdId: string,
    topic: PushTopic,
    exceptUserId: string,
    joinedBy: string,
  ): Promise<PushTarget[]> {
    return this.selectTargets()
      .innerJoin(
        householdMembers,
        and(
          eq(householdMembers.userId, pushDevices.userId),
          eq(householdMembers.householdId, householdId),
          lte(householdMembers.joinedAt, sql`${joinedBy}::timestamptz`),
        ),
      )
      .where(and(arrayContains(pushDevices.topics, [topic]), ne(pushDevices.userId, exceptUserId)));
  }

  /**
   * Claims the devices due for today's expiry notification and returns them:
   * those that want it, whose owner's clock reads between `fromHour` and
   * `untilHour`, and that have not had today's. Claiming marks them, in the same
   * statement, so a device gets one a day however often this runs — and none at
   * all on a day it is missed, rather than a late one in the evening.
   *
   * A time zone Postgres does not know counts as UTC, as `todayIn` treats it,
   * instead of failing the statement for everyone. `SKIP LOCKED` keeps two runs
   * from claiming the same device.
   */
  async claimExpiryDue(fromHour: number, untilHour: number): Promise<ExpiryClaim[]> {
    const result = await this.db.execute<{
      id: string;
      user_id: string;
      endpoint: string;
      p256dh: string;
      auth: string;
      locale: string;
      today: string;
    }>(sql`
      with zones as materialized (
        select name from pg_timezone_names
      ),
      due as (
        select d.id, (now() at time zone coalesce(z.name, 'UTC'))::date as today
        from push_devices d
        join users u on u.id = d.user_id
        join refresh_tokens s
          on s.id = d.session_id and s.revoked_at is null and s.expires_at > now()
        left join zones z on z.name = u.timezone
        where d.topics @> array['expiry']::text[]
          and extract(hour from now() at time zone coalesce(z.name, 'UTC')) >= ${fromHour}
          and extract(hour from now() at time zone coalesce(z.name, 'UTC')) < ${untilHour}
          and (
            d.expiry_notified_on is null
            or d.expiry_notified_on < (now() at time zone coalesce(z.name, 'UTC'))::date
          )
        for update of d skip locked
      )
      update push_devices d
      set expiry_notified_on = due.today
      from due, users u
      where d.id = due.id and u.id = d.user_id
      returning d.id, d.user_id, d.endpoint, d.p256dh, d.auth, u.locale,
        to_char(due.today, 'YYYY-MM-DD') as today
    `);

    return result.rows.map((row) => ({
      id: row.id,
      userId: row.user_id,
      endpoint: row.endpoint,
      p256dh: row.p256dh,
      auth: row.auth,
      locale: row.locale,
      today: row.today,
    }));
  }

  private selectTargets() {
    return this.db
      .select({
        id: pushDevices.id,
        userId: pushDevices.userId,
        endpoint: pushDevices.endpoint,
        p256dh: pushDevices.p256dh,
        auth: pushDevices.auth,
        locale: users.locale,
      })
      .from(pushDevices)
      .innerJoin(users, eq(users.id, pushDevices.userId))
      .innerJoin(
        refreshTokens,
        and(
          eq(refreshTokens.id, pushDevices.sessionId),
          isNull(refreshTokens.revokedAt),
          gt(refreshTokens.expiresAt, sql`now()`),
        ),
      )
      .$dynamic();
  }
}

/** One member's activity of one topic, on one list for the list topics: what one notification says. */
export interface PushActivityGroup {
  householdId: string;
  actorId: string;
  topic: PushActivityTopic;
  listId: string | null;
  rows: PushOutboxRow[];
  /** When its first and last rows were written: database text, to the microsecond. */
  firstAt: string;
  lastAt: string;
}

/**
 * What members did, waiting to be announced. Services add rows inside their own
 * transaction; a job takes whole groups once their member has paused.
 */
export class PushOutboxRepository {
  constructor(private readonly db: Database) {}

  async add(rows: readonly NewPushOutboxRow[]): Promise<void> {
    if (rows.length === 0) return;
    await this.db.insert(pushOutbox).values([...rows]);
  }

  /**
   * Takes every group that is ready, deleting its rows: groups whose last row is
   * older than `quietSeconds`, so a member still busy on a list is waited for,
   * and groups whose first row is older than `maxWaitSeconds`, so one who never
   * stops is still heard about. Two runs at once take disjoint rows.
   */
  async claimReady(quietSeconds: number, maxWaitSeconds: number): Promise<PushActivityGroup[]> {
    const result = await this.db.execute<{
      /** `bigint`, which the driver hands over as text. */
      id: string;
      household_id: string;
      actor_id: string;
      topic: PushActivityTopic;
      list_id: string | null;
      item_id: string | null;
      member_id: string | null;
      created_at: Date;
      /** `created_at` as the database writes it, which a JS `Date` would cut to milliseconds. */
      created_at_text: string;
    }>(sql`
      with ready as (
        select household_id, actor_id, topic, list_id
        from push_outbox
        group by household_id, actor_id, topic, list_id
        having max(created_at) < now() - make_interval(secs => ${quietSeconds})
          or min(created_at) < now() - make_interval(secs => ${maxWaitSeconds})
      )
      delete from push_outbox o
      using ready r
      where o.household_id = r.household_id
        and o.actor_id = r.actor_id
        and o.topic = r.topic
        and o.list_id is not distinct from r.list_id
      returning o.id, o.household_id, o.actor_id, o.topic, o.list_id, o.item_id, o.member_id,
        o.created_at, o.created_at::text as created_at_text
    `);

    const groups = new Map<string, PushActivityGroup>();
    /** Each group's first and last instants, to pick its texts by. */
    const span = new Map<PushActivityGroup, { first: number; last: number }>();
    for (const row of result.rows) {
      const key = [row.household_id, row.actor_id, row.topic, row.list_id ?? ''].join(':');
      let group = groups.get(key);
      if (group === undefined) {
        group = {
          householdId: row.household_id,
          actorId: row.actor_id,
          topic: row.topic,
          listId: row.list_id,
          rows: [],
          firstAt: row.created_at_text,
          lastAt: row.created_at_text,
        };
        groups.set(key, group);
      }
      const at = new Date(row.created_at).getTime();
      const seen = span.get(group);
      if (seen === undefined) {
        span.set(group, { first: at, last: at });
      } else {
        if (at < seen.first) [seen.first, group.firstAt] = [at, row.created_at_text];
        if (at > seen.last) [seen.last, group.lastAt] = [at, row.created_at_text];
      }
      group.rows.push({
        id: Number(row.id),
        householdId: row.household_id,
        actorId: row.actor_id,
        topic: row.topic,
        listId: row.list_id,
        itemId: row.item_id,
        memberId: row.member_id,
        createdAt: new Date(row.created_at),
      });
    }

    for (const group of groups.values()) group.rows.sort((a, b) => a.id - b.id);
    return [...groups.values()];
  }
}
