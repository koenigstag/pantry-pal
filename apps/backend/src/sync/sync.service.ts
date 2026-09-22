import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ItemsRepository,
  LocationsRepository,
  ShoppingListEntriesRepository,
  ShoppingListsRepository,
  type SyncCheckpointRow,
  type WithSyncStamp,
} from '@pantry-pal/db';
import {
  DEFAULT_SYNC_PULL_LIMIT,
  SYNC_COLLECTION,
  type PantryItem,
  type PantryLocation,
  type ShoppingList,
  type ShoppingListEntry,
  type SyncCollection,
  type SyncPullPayload,
} from '@pantry-pal/shared';
import type { SyncPullQueryDto } from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { toItemFields, toPantryItem } from '../items/item.mapper';
import { toPantryLocation } from '../locations/location.mapper';
import { toShoppingList, toShoppingListEntry } from '../shopping-lists/shopping-list.mapper';

/**
 * Any document the offline mirror holds. Mirrors made before items had units
 * hold items without them.
 */
export type SyncedDocument =
  | PantryItem
  | Omit<PantryItem, 'subItems'>
  | PantryLocation
  | ShoppingList
  | ShoppingListEntry;

/**
 * Feeds the frontend's offline mirror: each collection's changes after a
 * checkpoint, in the order they happened, deleted rows included.
 *
 * Read-only, and one query per call, so it needs no transaction: a row written
 * while a pull runs is either in this page or, with a later `updated_at`, in the
 * next one. Writes still go through the domain services, whose rules the mirror
 * never bypasses.
 */
@Injectable()
export class SyncService {
  constructor(
    private readonly items: ItemsRepository,
    private readonly locations: LocationsRepository,
    private readonly lists: ShoppingListsRepository,
    private readonly entries: ShoppingListEntriesRepository,
  ) {}

  async pull(
    membership: Membership,
    collection: SyncCollection,
    query: SyncPullQueryDto,
  ): Promise<SyncPullPayload<SyncedDocument>> {
    const after = checkpointFrom(query);
    const window = { after, limit: query.limit ?? DEFAULT_SYNC_PULL_LIMIT };
    const { householdId } = membership;

    switch (collection) {
      case SYNC_COLLECTION.Items:
        // Only mirrors that know about units get them: see `SyncPullQueryDto.subItems`.
        return page(
          await this.items.changedSince(householdId, window),
          query.subItems === true ? toPantryItem : toItemFields,
          after,
        );
      case SYNC_COLLECTION.Locations:
        return page(
          await this.locations.changedSince(householdId, window),
          toPantryLocation,
          after,
        );
      case SYNC_COLLECTION.ShoppingLists:
        return page(await this.lists.changedSince(householdId, window), toShoppingList, after);
      case SYNC_COLLECTION.ShoppingListEntries:
        return page(
          await this.entries.changedSince(householdId, window),
          toShoppingListEntry,
          after,
        );
    }
  }
}

function checkpointFrom(query: SyncPullQueryDto): SyncCheckpointRow | undefined {
  const { updatedAt, id } = query;
  if (updatedAt === undefined && id === undefined) return undefined;
  if (updatedAt === undefined || id === undefined) {
    throw new BadRequestException('A checkpoint needs both updatedAt and id, or neither.');
  }
  return { updatedAt, id };
}

/**
 * Rows as documents, and where the next pull continues. An empty page hands the
 * caller's checkpoint back, so a client that is up to date stays where it is.
 */
function page<Row extends { id: string; deletedAt: Date | null }, Document>(
  rows: readonly WithSyncStamp<Row>[],
  toDocument: (row: Row) => Document,
  after: SyncCheckpointRow | undefined,
): SyncPullPayload<Document> {
  const last = rows.at(-1);

  return {
    documents: rows.map((row) => ({ ...toDocument(row), _deleted: row.deletedAt !== null })),
    checkpoint:
      last === undefined ? (after ?? null) : { updatedAt: last.syncUpdatedAt, id: last.id },
  };
}
