import { Injectable } from '@nestjs/common';
import { PushOutboxRepository } from '@pantry-pal/db';
import { PUSH_TOPIC } from '@pantry-pal/shared';

import type { Membership } from '../common/request-context';
import { PushSender } from './push-sender.service';

/**
 * What the domain services tell push about: a member did something the
 * household's other members may want to hear of.
 *
 * Each call writes to the outbox in the caller's transaction, so a write that
 * rolls back announces nothing, as with `ChangeFeed`. `PushNotifier` sends the
 * rows later, grouped, once the member has paused. With push off, nothing is
 * written.
 */
@Injectable()
export class PushActivity {
  constructor(
    private readonly outbox: PushOutboxRepository,
    private readonly sender: PushSender,
  ) {}

  /** Items put on a list: by hand, by an assistant, offline, or for running out. */
  async listAdded(
    membership: Membership,
    listId: string,
    itemIds: readonly string[],
  ): Promise<void> {
    await this.recordItems(membership, PUSH_TOPIC.ListAdded, listId, itemIds);
  }

  /** The shopping put away: the items bought from a list. */
  async listBought(
    membership: Membership,
    listId: string,
    itemIds: readonly string[],
  ): Promise<void> {
    await this.recordItems(membership, PUSH_TOPIC.ListBought, listId, itemIds);
  }

  /** A user added to the household by `membership`'s member. */
  async memberAdded(membership: Membership, memberId: string): Promise<void> {
    if (!this.sender.isEnabled) return;
    await this.outbox.add([
      {
        householdId: membership.householdId,
        actorId: membership.userId,
        topic: PUSH_TOPIC.Members,
        memberId,
      },
    ]);
  }

  private async recordItems(
    membership: Membership,
    topic: typeof PUSH_TOPIC.ListAdded | typeof PUSH_TOPIC.ListBought,
    listId: string,
    itemIds: readonly string[],
  ): Promise<void> {
    if (!this.sender.isEnabled) return;
    await this.outbox.add(
      itemIds.map((itemId) => ({
        householdId: membership.householdId,
        actorId: membership.userId,
        topic,
        listId,
        itemId,
      })),
    );
  }
}
