import { Injectable, Logger, type OnApplicationBootstrap } from '@nestjs/common';
import {
  HouseholdMembersRepository,
  HouseholdsRepository,
  ItemsRepository,
  PushDevicesRepository,
  PushOutboxRepository,
  ShoppingListEntriesRepository,
  ShoppingListsRepository,
  SubItemsRepository,
  UsersRepository,
  type ExpiryClaim,
  type PushActivityGroup,
  type PushTarget,
} from '@pantry-pal/db';
import {
  EXPIRY_NOTIFICATION_HOUR,
  PUSH_TOPIC,
  SHOPPING_ROUTE,
  STORAGE_ROUTE,
  type PushPayload,
} from '@pantry-pal/shared';

import { JobsService } from '../jobs/jobs.service';
import { listNames, pushMessages } from './push-messages';
import { PushSender } from './push-sender.service';

/** A member's activity goes out once they have done nothing more for this long. */
const ACTIVITY_QUIET_SECONDS = 90;
/** However busy the member stays, nothing waits longer than this. */
const ACTIVITY_MAX_WAIT_SECONDS = 5 * 60;
/**
 * How long after `EXPIRY_NOTIFICATION_HOUR` the morning notification may still
 * go out, for a server that was down at nine. Past it, the day is skipped.
 */
const EXPIRY_WINDOW_HOURS = 3;

/** The jobs, by name: each ticks in UTC, once across every instance. */
const ACTIVITY_JOB = { name: 'push-activity', cron: '* * * * *' } as const;
const EXPIRY_JOB = { name: 'push-expiry', cron: '*/5 * * * *' } as const;

/**
 * Sends what there is to send, on two pg-boss schedules, while push is on.
 *
 * - **Activity**, every minute: groups from the outbox whose member has paused —
 *   things put on a list, the shopping put away, new members — to the other
 *   members' devices that want that topic.
 * - **Expiry**, every five minutes: each device whose owner's clock has passed
 *   nine and that has not had today's, with the units whose last day is today,
 *   one notification per household that has any.
 *
 * Each notification is worded in its recipient's language. Sending is at most
 * once: rows are claimed before anything is sent, so a crash loses a
 * notification rather than repeating it.
 */
@Injectable()
export class PushNotifier implements OnApplicationBootstrap {
  private readonly logger = new Logger(PushNotifier.name);

  constructor(
    private readonly sender: PushSender,
    private readonly jobs: JobsService,
    private readonly devices: PushDevicesRepository,
    private readonly outbox: PushOutboxRepository,
    private readonly households: HouseholdsRepository,
    private readonly members: HouseholdMembersRepository,
    private readonly users: UsersRepository,
    private readonly lists: ShoppingListsRepository,
    private readonly entries: ShoppingListEntriesRepository,
    private readonly items: ItemsRepository,
    private readonly subItems: SubItemsRepository,
  ) {}

  /**
   * Schedules both jobs. A failure is logged rather than thrown: the pantry
   * itself works without push, so it should not stop the server.
   */
  async onApplicationBootstrap(): Promise<void> {
    if (!this.sender.isEnabled) return;
    try {
      await this.jobs.every(ACTIVITY_JOB.name, ACTIVITY_JOB.cron, () => this.sendActivity());
      await this.jobs.every(EXPIRY_JOB.name, EXPIRY_JOB.cron, () => this.sendExpiry());
    } catch (error) {
      this.logger.error(
        'Push notifications could not be scheduled, so none will go out',
        error instanceof Error ? error.stack : error,
      );
    }
  }

  async sendActivity(): Promise<void> {
    const groups = await this.outbox.claimReady(ACTIVITY_QUIET_SECONDS, ACTIVITY_MAX_WAIT_SECONDS);
    for (const group of groups) {
      try {
        // One group at a time: there are seldom more than a few a minute.
        // oxlint-disable-next-line no-await-in-loop
        await this.sendGroup(group);
      } catch (error) {
        this.logger.error(
          `Push for ${group.topic} in household ${group.householdId} failed`,
          error instanceof Error ? error.stack : error,
        );
      }
    }
  }

  async sendExpiry(): Promise<void> {
    const claims = await this.devices.claimExpiryDue(
      EXPIRY_NOTIFICATION_HOUR,
      EXPIRY_NOTIFICATION_HOUR + EXPIRY_WINDOW_HOURS,
    );

    const byUser = new Map<string, ExpiryClaim[]>();
    for (const claim of claims) {
      byUser.set(claim.userId, [...(byUser.get(claim.userId) ?? []), claim]);
    }

    for (const devices of byUser.values()) {
      try {
        // oxlint-disable-next-line no-await-in-loop
        await this.sendExpiryTo(devices);
      } catch (error) {
        this.logger.error(
          'An expiry notification failed',
          error instanceof Error ? error.stack : error,
        );
      }
    }
  }

  /** One user's devices, all claimed for the same day: theirs. */
  private async sendExpiryTo(devices: readonly ExpiryClaim[]): Promise<void> {
    const [first] = devices;
    if (first === undefined) return;

    const households = await this.households.listForUser(first.userId);
    const expiring = await this.subItems.expiringOn(
      households.map((household) => household.id),
      first.today,
    );

    for (const household of households) {
      const names = expiring
        .filter((item) => item.householdId === household.id)
        .map((item) => (item.units > 1 ? `${item.name} ×${item.units}` : item.name));
      if (names.length === 0) continue;

      // oxlint-disable-next-line no-await-in-loop
      await this.deliver(devices, (target) => ({
        title: household.name,
        body: pushMessages(target.locale).expiry(listNames(names, target.locale)),
        path: STORAGE_ROUTE,
        // Today's replaces yesterday's, should that one still be on the screen.
        tag: `expiry:${household.id}`,
      }));
    }
  }

  private async sendGroup(group: PushActivityGroup): Promise<void> {
    // Members who were there for it: by the first thing done, or for new members,
    // by the last one added, who is among those to tell.
    const targets = await this.devices.targetsInHousehold(
      group.householdId,
      group.topic,
      group.actorId,
      group.topic === PUSH_TOPIC.Members ? group.lastAt : group.firstAt,
    );
    if (targets.length === 0) return;

    const household = await this.households.findById(group.householdId);
    const actor = await this.users.findById(group.actorId);
    if (household === undefined || actor === undefined) return;

    if (group.topic === PUSH_TOPIC.Members) {
      const added = new Set(group.rows.flatMap((row) => row.memberId ?? []));
      // Those still members: someone added and removed again in a minute is not news.
      const joined = (await this.members.list(group.householdId)).filter((member) =>
        added.has(member.userId),
      );
      if (joined.length === 0) return;

      await this.deliver(targets, (target) => {
        const messages = pushMessages(target.locale);
        const names = joined.map((member) => member.displayName);
        return {
          title: household.name,
          body: added.has(target.userId)
            ? messages.addedYou
            : messages.newMembers(listNames(names, target.locale), names.length),
          path: STORAGE_ROUTE,
        };
      });
      return;
    }

    const itemIds = [...new Set(group.rows.flatMap((row) => row.itemId ?? []))];
    let announced = itemIds;
    if (group.topic === PUSH_TOPIC.ListAdded && group.listId !== null) {
      // Those still on the list: one taken off again meanwhile was a slip.
      const onList = new Set(
        (await this.entries.listForHousehold(group.householdId))
          .filter((entry) => entry.listId === group.listId)
          .map((entry) => entry.itemId),
      );
      announced = itemIds.filter((itemId) => onList.has(itemId));
    }

    const names = new Map(
      (await this.items.findByIds(group.householdId, announced)).map((item) => [
        item.id,
        item.name,
      ]),
    );
    const listed = announced.flatMap((itemId) => names.get(itemId) ?? []);
    if (listed.length === 0) return;

    const list =
      group.listId === null
        ? undefined
        : await this.lists.findById(group.householdId, group.listId);
    const title = `${actor.displayName} · ${list?.name ?? household.name}`;

    await this.deliver(targets, (target) => {
      const messages = pushMessages(target.locale);
      const items = listNames(listed, target.locale);
      return {
        title,
        body: group.topic === PUSH_TOPIC.ListAdded ? messages.added(items) : messages.bought(items),
        path: SHOPPING_ROUTE,
      };
    });
  }

  /** Sends to each device at once, and forgets those their push service says are gone. */
  private async deliver(
    targets: readonly PushTarget[],
    compose: (target: PushTarget) => PushPayload,
  ): Promise<void> {
    await Promise.all(
      targets.map(async (target) => {
        if ((await this.sender.send(target, compose(target))) === 'gone') {
          await this.devices.delete(target.id);
        }
      }),
    );
  }
}
