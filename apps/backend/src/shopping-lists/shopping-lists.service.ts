import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  HouseholdsRepository,
  ItemEventsRepository,
  ItemsRepository,
  ShoppingListEntriesRepository,
  ShoppingListsRepository,
  Transactional,
  type ItemRow,
  type ShoppingListChange,
  type ShoppingListRow,
} from '@pantry-pal/db';
import {
  ITEM_EVENT_TYPE,
  MAX_SHOPPING_LISTS_PER_HOUSEHOLD,
  type PantryItem,
  type ShoppingList,
  type ShoppingListEntriesChange,
  type ShoppingListEntry,
  type ShoppingLists,
} from '@pantry-pal/shared';
import type {
  AddShoppingListEntriesDto,
  CreateShoppingListDto,
  PutAwayShoppingListEntriesDto,
  UpdateShoppingListDto,
  UpdateShoppingListEntryDto,
  UpsertShoppingListsDto,
} from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { toPantryItem } from '../items/item.mapper';
import { ItemsService } from '../items/items.service';
import { ChangeFeed } from '../realtime/change-feed';
import { toShoppingList, toShoppingListEntry } from './shopping-list.mapper';

/** How many of each item an add puts on a list when the request does not say. */
const DEFAULT_ENTRY_QUANTITY = 1;

/**
 * Any member may manage shopping lists and what is on them.
 *
 * An archived list is frozen: every write to its entries is refused (409), and
 * items that run out do not go on it. It can still be renamed, restored or
 * deleted.
 *
 * Locks follow one order: the household, then items, then lists, then entries
 * — the order `ItemsService` takes them in when an item runs out, so the two
 * never wait on each other in a circle.
 */
@Injectable()
export class ShoppingListsService {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly lists: ShoppingListsRepository,
    private readonly entries: ShoppingListEntriesRepository,
    private readonly items: ItemsRepository,
    private readonly events: ItemEventsRepository,
    private readonly itemsService: ItemsService,
    private readonly changes: ChangeFeed,
  ) {}

  /**
   * Every list, entry and item an entry names, read from one snapshot: without
   * it, an entry added between two of the reads could name an item that is not
   * in the answer.
   */
  @Transactional({ isolationLevel: 'repeatable read' })
  async overview(membership: Membership): Promise<ShoppingLists> {
    const { householdId } = membership;

    const lists = await this.lists.list(householdId);
    const entries = await this.entries.listForHousehold(householdId);
    const items = await this.items.findByIds(householdId, [
      ...new Set(entries.map((entry) => entry.itemId)),
    ]);

    return {
      lists: lists.map(toShoppingList),
      entries: entries.map(toShoppingListEntry),
      items: items.map(toPantryItem),
    };
  }

  /** Appended after the last list. */
  @Transactional()
  async create(membership: Membership, dto: CreateShoppingListDto): Promise<ShoppingList> {
    const { householdId } = membership;
    await this.lockHousehold(householdId);

    if ((await this.lists.count(householdId)) >= MAX_SHOPPING_LISTS_PER_HOUSEHOLD) {
      throw new ConflictException(
        `A household can have at most ${MAX_SHOPPING_LISTS_PER_HOUSEHOLD} shopping lists`,
      );
    }

    const row = await this.lists.create(householdId, {
      name: dto.name,
      sortOrder: await this.lists.nextSortOrder(householdId),
    });

    const list = toShoppingList(row);
    this.changes.publish({ type: 'shopping-list.created', list });
    return list;
  }

  async rename(
    membership: Membership,
    id: string,
    dto: UpdateShoppingListDto,
  ): Promise<ShoppingList> {
    const current = await this.findList(membership.householdId, id);
    if (current.name === dto.name) return toShoppingList(current);

    const row = await this.lists.rename(membership.householdId, id, dto.name);
    if (row === undefined) throw new NotFoundException('Shopping list not found');

    const list = toShoppingList(row);
    this.changes.publish({ type: 'shopping-list.updated', list });
    return list;
  }

  /**
   * Deletes a list and everything on it. Items that went on it by default
   * go nowhere from now on: each change is recorded in the item's history and
   * announced before the list's deletion.
   */
  @Transactional()
  async remove(membership: Membership, id: string): Promise<void> {
    const { householdId } = membership;
    await this.lockHousehold(householdId);

    const cleared = await this.deleteList(membership, id);

    for (const item of cleared) {
      this.changes.publish({ type: 'item.updated', item: toPantryItem(item) });
    }
    this.changes.publish({ type: 'shopping-list.deleted', householdId, id });
  }

  /**
   * Saves the shopping lists editor: additions, renames, archiving and
   * restoring, deletions and the order, all or nothing, announced as one set.
   * Returns every list in the new order.
   *
   * `lists` and `removed` together must name every list exactly once, archived
   * ones included. An unknown or repeated id is a 400; a missing one is a 409,
   * because the client edited a set that has changed since it loaded it.
   */
  @Transactional()
  async upsert(membership: Membership, dto: UpsertShoppingListsDto): Promise<ShoppingList[]> {
    const { householdId } = membership;
    await this.lockHousehold(householdId);

    const current = new Map((await this.lists.list(householdId)).map((row) => [row.id, row]));
    const removed = dto.removed ?? [];
    const keptIds = dto.lists.flatMap((list) => (list.id === undefined ? [] : [list.id]));
    const listed = new Set<string>();

    for (const id of [...keptIds, ...removed]) {
      if (listed.has(id)) {
        throw new BadRequestException(`Shopping list ${id} is listed more than once`);
      }
      if (!current.has(id)) {
        throw new BadRequestException(`${id} does not name a shopping list in this household`);
      }
      listed.add(id);
    }

    if (listed.size !== current.size) {
      throw new ConflictException(
        "The household's shopping lists changed after this set was loaded. Reload them and try again.",
      );
    }

    // Deletions first: they free their names for the renames and additions below.
    const cleared: ItemRow[] = [];
    for (const id of removed) {
      // One at a time: every statement shares the transaction's connection anyway.
      // oxlint-disable-next-line no-await-in-loop
      cleared.push(...(await this.deleteList(membership, id)));
    }

    const changes = dto.lists.flatMap((list): ShoppingListChange[] => {
      const row = list.id === undefined ? undefined : current.get(list.id);
      if (row === undefined) return [];

      const name = list.name === row.name ? undefined : list.name;
      const archived = list.archived === (row.archivedAt !== null) ? undefined : list.archived;
      return name === undefined && archived === undefined ? [] : [{ id: row.id, name, archived }];
    });
    await this.lists.updateMany(householdId, changes);

    // New lists get their ids here, so the whole order is known before the insert.
    const ordered = dto.lists.map((list) => ({
      ...list,
      isNew: list.id === undefined,
      id: list.id ?? randomUUID(),
    }));
    await this.lists.createAll(
      householdId,
      ordered.flatMap((list, index) =>
        list.isNew
          ? [{ id: list.id, name: list.name, sortOrder: index, archived: list.archived }]
          : [],
      ),
    );
    await this.lists.setSortOrders(
      householdId,
      ordered.map((list) => list.id),
    );

    const lists = (await this.lists.list(householdId)).map(toShoppingList);
    for (const item of cleared) {
      this.changes.publish({ type: 'item.updated', item: toPantryItem(item) });
    }
    this.changes.publish({ type: 'shopping-lists.upserted', householdId, lists });
    return lists;
  }

  /**
   * Puts items on a list, one of each unless `quantity` says otherwise. Items
   * already on it keep their entries unchanged. Answers with the entries this
   * created, so a client can tell how many were new.
   *
   * Every id must name an item of the household that has not been deleted; if
   * any does not, nothing is added and the answer names the missing ones.
   */
  @Transactional()
  async addEntries(
    membership: Membership,
    listId: string,
    dto: AddShoppingListEntriesDto,
  ): Promise<ShoppingListEntriesChange> {
    const { householdId } = membership;

    // Shared: an item deleted meanwhile waits, then takes its new entry off the list.
    const items = await this.items.lockMany(householdId, dto.itemIds, 'share');
    if (items.length !== dto.itemIds.length) {
      const found = new Set(items.map((item) => item.id));
      const missing = dto.itemIds.filter((itemId) => !found.has(itemId));
      throw new NotFoundException(`Items not found: ${missing.join(', ')}`);
    }

    await this.lockOpenList(householdId, listId);

    const rows = await this.entries.addMissing(
      householdId,
      listId,
      dto.itemIds,
      dto.quantity ?? DEFAULT_ENTRY_QUANTITY,
    );
    const added = new Set(rows.map((row) => row.itemId));
    const change: ShoppingListEntriesChange = {
      entries: rows.map(toShoppingListEntry),
      items: items.filter((item) => added.has(item.id)).map(toPantryItem),
    };

    if (rows.length > 0) {
      this.changes.publish({ type: 'shopping-list-entries.upserted', householdId, ...change });
    }
    return change;
  }

  /** Changes how many to buy, or ticks the entry off; a no-op patch writes nothing. */
  @Transactional()
  async updateEntry(
    membership: Membership,
    listId: string,
    id: string,
    dto: UpdateShoppingListEntryDto,
  ): Promise<ShoppingListEntry> {
    const { householdId } = membership;
    await this.lockOpenList(householdId, listId);

    const [current] = await this.entries.lockMany(householdId, listId, [id]);
    if (current === undefined) throw new NotFoundException('Shopping list entry not found');

    const quantity = dto.quantity === current.quantity ? undefined : dto.quantity;
    const checked = dto.checked === (current.checkedAt !== null) ? undefined : dto.checked;
    if (quantity === undefined && checked === undefined) return toShoppingListEntry(current);

    const row = await this.entries.update(householdId, listId, id, { quantity, checked });
    if (row === undefined) throw new NotFoundException('Shopping list entry not found');

    const entry = toShoppingListEntry(row);
    const item = await this.items.findById(householdId, row.itemId);
    this.changes.publish({
      type: 'shopping-list-entries.upserted',
      householdId,
      entries: [entry],
      items: item === undefined ? [] : [toPantryItem(item)],
    });
    return entry;
  }

  @Transactional()
  async removeEntry(membership: Membership, listId: string, id: string): Promise<void> {
    const { householdId } = membership;
    await this.lockOpenList(householdId, listId);

    const row = await this.entries.delete(householdId, listId, id);
    if (row === undefined) throw new NotFoundException('Shopping list entry not found');

    this.changes.publish({ type: 'shopping-list-entries.deleted', householdId, ids: [row.id] });
  }

  /**
   * Brings ticked-off entries home: restocks each item (see
   * `ItemsService.restock`) and takes the entries off the list, all or nothing.
   * Answers with the restocked items.
   *
   * An id that is not on the list, or no longer ticked off, is a 409: someone
   * changed the list after this client loaded it.
   */
  @Transactional()
  async putAway(
    membership: Membership,
    listId: string,
    dto: PutAwayShoppingListEntriesDto,
  ): Promise<PantryItem[]> {
    const { householdId } = membership;
    await this.findList(householdId, listId);

    // Items, then the list, then entries: a plain read finds the items to lock first.
    const named = await this.entries.findMany(householdId, listId, dto.entryIds);
    await this.items.lockMany(
      householdId,
      named.map((entry) => entry.itemId),
      'update',
    );
    await this.lockOpenList(householdId, listId);

    const entries = await this.entries.lockMany(householdId, listId, dto.entryIds);
    if (
      entries.length !== dto.entryIds.length ||
      entries.some((entry) => entry.checkedAt === null)
    ) {
      throw new ConflictException(
        'The shopping list changed after it was loaded. Reload it, then put the shopping away again.',
      );
    }

    const items: PantryItem[] = [];
    for (const entry of entries) {
      // One at a time on purpose: every statement shares the transaction's connection anyway.
      // oxlint-disable-next-line no-await-in-loop
      items.push(await this.itemsService.restock(membership, entry.itemId, entry.quantity));
    }

    const ids = entries.map((entry) => entry.id);
    await this.entries.deleteMany(householdId, listId, ids);
    this.changes.publish({ type: 'shopping-list-entries.deleted', householdId, ids });
    return items;
  }

  /**
   * Clears the list from the items that have it as their default, recording each
   * in the item's history, then deletes the list with its entries. Returns the
   * live items it changed, for the caller to announce. The caller holds the
   * household lock.
   */
  private async deleteList(membership: Membership, id: string): Promise<ItemRow[]> {
    const { householdId, userId } = membership;

    // Items before the list, the order every write here locks in. Soft-deleted
    // rows are cleared too, since the key counts them, but only live ones are news.
    const cleared = (await this.items.clearDefaultShoppingList(householdId, id)).filter(
      (item) => item.deletedAt === null,
    );
    await this.events.recordMany(
      cleared.map((item) => ({
        householdId,
        itemId: item.id,
        userId,
        type: ITEM_EVENT_TYPE.Updated,
        payload: { changes: { defaultShoppingListId: { from: id, to: null } } },
      })),
    );

    if ((await this.lists.delete(householdId, id)) === undefined) {
      throw new NotFoundException('Shopping list not found');
    }
    // Lists and entries are soft-deleted, so nothing cascades: the entries go
    // here, and a client learns of them through the list's own deletion.
    await this.entries.deleteForList(householdId, id);
    return cleared;
  }

  /**
   * Share-locks a list whose entries are about to change: it must exist and not
   * be archived. Archiving it takes the conflicting lock, so it waits for this
   * write, and a list archived a moment earlier is refused.
   */
  private async lockOpenList(householdId: string, listId: string): Promise<ShoppingListRow> {
    const list = await this.lists.lock(householdId, listId, 'share');
    if (list === undefined) throw new NotFoundException('Shopping list not found');
    if (list.archivedAt !== null) {
      throw new ConflictException(
        `"${list.name}" is archived: restore it before changing what is on it`,
      );
    }
    return list;
  }

  private async lockHousehold(householdId: string): Promise<void> {
    if (!(await this.households.lock(householdId))) {
      throw new NotFoundException('Household not found');
    }
  }

  private async findList(householdId: string, id: string): Promise<ShoppingListRow> {
    const row = await this.lists.findById(householdId, id);
    if (row === undefined) throw new NotFoundException('Shopping list not found');
    return row;
  }
}
