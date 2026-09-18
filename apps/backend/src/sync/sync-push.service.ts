import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  ItemsRepository,
  ShoppingListEntriesRepository,
  type ItemRow,
  type ShoppingListEntryRow,
} from '@pantry-pal/db';
import {
  SYNC_COLLECTION,
  type PantryItem,
  type ShoppingListEntry,
  type SyncDocument,
  type SyncPushCollection,
  type SyncPushResult,
  type SyncRefusal,
} from '@pantry-pal/shared';
import {
  CreatePantryItemDto,
  UpdatePantryItemDto,
  UpdateShoppingListEntryDto,
  validateDto,
  type FieldError,
  type SyncPushRowDto,
} from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { toPantryItem } from '../items/item.mapper';
import { ItemsService } from '../items/items.service';
import { toShoppingListEntry } from '../shopping-lists/shopping-list.mapper';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';
import type { SyncedDocument } from './sync.service';

/** What a client may change on an item: `CreatePantryItemDto`'s fields, and the status. */
const ITEM_FIELDS = [
  'name',
  'locationId',
  'category',
  'isEdible',
  'quantity',
  'unit',
  'sizeValue',
  'sizeUnit',
  'expiresAt',
  'openedAt',
  'periodAfterOpeningDays',
  'notes',
  'defaultShoppingListId',
] as const satisfies readonly (keyof PantryItem)[];

type Outcome =
  | { kind: 'applied' }
  | { kind: 'conflict'; master: SyncDocument<SyncedDocument> }
  | { kind: 'refused'; master: SyncDocument<SyncedDocument>; message: string };

const APPLIED: Outcome = { kind: 'applied' };

/**
 * Takes the offline mirror's local changes to items and shopping entries.
 *
 * **Every change goes through the domain services**, exactly as a REST write
 * would: the same validation, locks, history and side effects — running out puts
 * an item on its default list — and the same broadcasts. The push only works out
 * what the client changed, and whether it changed it from what the server holds.
 *
 * Per row, independently, oldest first:
 * - **Created** (no assumed state): made under the client's id. A replay of a
 *   create that already landed is recognised and passes.
 * - **Changed or deleted**: applied if the client's base is still current — its
 *   `updatedAt` is the server's — and otherwise answered with the server's
 *   version, for the client's conflict handler to merge and send again.
 * - **Refused** (invalid, or against a rule such as an archived list): answered
 *   with the server's version too, and listed in `refused` with the reason, so
 *   the client can say why instead of retrying forever.
 */
@Injectable()
export class SyncPushService {
  private readonly logger = new Logger(SyncPushService.name);

  constructor(
    private readonly items: ItemsRepository,
    private readonly entries: ShoppingListEntriesRepository,
    private readonly itemsService: ItemsService,
    private readonly shopping: ShoppingListsService,
  ) {}

  async push(
    membership: Membership,
    collection: SyncPushCollection,
    rows: readonly SyncPushRowDto[],
  ): Promise<SyncPushResult<SyncedDocument>> {
    const conflicts: SyncDocument<SyncedDocument>[] = [];
    const refused: SyncRefusal[] = [];

    for (const row of rows) {
      // Row after row, oldest first: a later change can build on an earlier one.
      // oxlint-disable-next-line no-await-in-loop
      const outcome = await this.pushRow(membership, collection, row);

      if (outcome.kind === 'conflict') conflicts.push(outcome.master);
      if (outcome.kind === 'refused') {
        conflicts.push(outcome.master);
        refused.push({ id: outcome.master.id, message: outcome.message });
      }
    }

    return { conflicts, refused };
  }

  private pushRow(
    membership: Membership,
    collection: SyncPushCollection,
    row: SyncPushRowDto,
  ): Promise<Outcome> {
    return collection === SYNC_COLLECTION.Items
      ? this.pushItem(membership, row)
      : this.pushEntry(membership, row);
  }

  private async pushItem(membership: Membership, row: SyncPushRowDto): Promise<Outcome> {
    const next = row.newDocumentState as unknown as SyncDocument<PantryItem>;
    const assumed = row.assumedMasterState as unknown as SyncDocument<PantryItem> | undefined;
    const master = await this.items.findAnyById(membership.householdId, next.id);

    if (assumed === undefined) {
      if (master !== undefined) {
        return sameFields(itemDocument(master), next, ITEM_FIELDS)
          ? APPLIED
          : { kind: 'conflict', master: itemDocument(master) };
      }
      // Made and deleted before it ever reached the server: nothing to do.
      if (next._deleted) return APPLIED;

      const dto = validateDto(CreatePantryItemDto, { id: next.id, ...pick(next, ITEM_FIELDS) });
      if (!dto.ok) return refuseCreate(next, dto.errors);
      return this.attempt(() => this.itemsService.create(membership, dto.value), {
        onRefusal: () => ({ ...next, _deleted: true }),
      });
    }

    if (master === undefined) return refuseCreate(next, 'Item not found');
    const current = itemDocument(master);
    if (current.updatedAt !== assumed.updatedAt) return { kind: 'conflict', master: current };

    if (next._deleted) {
      return this.attempt(() => this.itemsService.remove(membership, next.id), {
        onRefusal: () => this.currentItem(membership, next.id),
      });
    }

    const patch = changedFields(assumed, next, [...ITEM_FIELDS, 'status']);
    if (Object.keys(patch).length === 0) return APPLIED;

    const dto = validateDto(UpdatePantryItemDto, patch);
    if (!dto.ok) return { kind: 'refused', master: current, message: describe(dto.errors) };
    return this.attempt(() => this.itemsService.update(membership, next.id, dto.value), {
      onRefusal: () => this.currentItem(membership, next.id),
    });
  }

  private async pushEntry(membership: Membership, row: SyncPushRowDto): Promise<Outcome> {
    const next = row.newDocumentState as unknown as SyncDocument<ShoppingListEntry>;
    const assumed = row.assumedMasterState as unknown as
      | SyncDocument<ShoppingListEntry>
      | undefined;
    const master = await this.entries.findAnyById(membership.householdId, next.id);

    if (assumed === undefined) {
      if (master !== undefined) {
        return sameFields(entryDocument(master), next, ['listId', 'itemId'])
          ? APPLIED
          : { kind: 'conflict', master: entryDocument(master) };
      }
      if (next._deleted) return APPLIED;

      let added: ShoppingListEntry | undefined;
      const outcome = await this.attempt(
        async () => {
          added = await this.shopping.addEntry(membership, next.listId, {
            id: next.id,
            itemId: next.itemId,
            quantity: next.quantity,
          });
        },
        { onRefusal: () => ({ ...next, _deleted: true }) },
      );
      if (outcome.kind !== 'applied') return outcome;

      // Already on the list under another entry, which the next pull brings:
      // the client's duplicate goes, quietly — nobody did anything wrong.
      if (added === undefined) return { kind: 'conflict', master: { ...next, _deleted: true } };

      // Ticked before it ever reached the server.
      if (next.checkedAt === null) return APPLIED;
      return this.attempt(
        () => this.shopping.updateEntry(membership, next.listId, next.id, { checked: true }),
        { onRefusal: () => this.currentEntry(membership, next.id) },
      );
    }

    if (master === undefined) return refuseCreate(next, 'Shopping list entry not found');
    const current = entryDocument(master);
    if (current.updatedAt !== assumed.updatedAt) return { kind: 'conflict', master: current };

    if (next._deleted) {
      return this.attempt(() => this.shopping.removeEntry(membership, next.listId, next.id), {
        onRefusal: () => this.currentEntry(membership, next.id),
      });
    }

    const patch: Record<string, unknown> = {};
    if (next.quantity !== assumed.quantity) patch['quantity'] = next.quantity;
    if ((next.checkedAt !== null) !== (assumed.checkedAt !== null)) {
      patch['checked'] = next.checkedAt !== null;
    }
    if (Object.keys(patch).length === 0) return APPLIED;

    const dto = validateDto(UpdateShoppingListEntryDto, patch);
    if (!dto.ok) return { kind: 'refused', master: current, message: describe(dto.errors) };
    return this.attempt(
      () => this.shopping.updateEntry(membership, next.listId, next.id, dto.value),
      { onRefusal: () => this.currentEntry(membership, next.id) },
    );
  }

  /**
   * Runs one change. A refusal the services raise — a 4xx — becomes a refused
   * row answered with `onRefusal()`; anything else is a server fault and fails
   * the whole push, so the client sends it again later.
   */
  private async attempt(
    change: () => Promise<unknown>,
    handlers: {
      onRefusal: () => SyncDocument<SyncedDocument> | Promise<SyncDocument<SyncedDocument>>;
    },
  ): Promise<Outcome> {
    try {
      await change();
      return APPLIED;
    } catch (error) {
      if (!(error instanceof HttpException) || error.getStatus() >= 500) throw error;
      this.logger.debug(`Push refused: ${error.message}`);
      return { kind: 'refused', master: await handlers.onRefusal(), message: error.message };
    }
  }

  private async currentItem(
    membership: Membership,
    id: string,
  ): Promise<SyncDocument<SyncedDocument>> {
    const row = await this.items.findAnyById(membership.householdId, id);
    if (row === undefined) throw new Error(`Item ${id} vanished during a push`);
    return itemDocument(row);
  }

  private async currentEntry(
    membership: Membership,
    id: string,
  ): Promise<SyncDocument<SyncedDocument>> {
    const row = await this.entries.findAnyById(membership.householdId, id);
    if (row === undefined) throw new Error(`Entry ${id} vanished during a push`);
    return entryDocument(row);
  }
}

function itemDocument(row: ItemRow): SyncDocument<PantryItem> {
  return { ...toPantryItem(row), _deleted: row.deletedAt !== null };
}

function entryDocument(row: ShoppingListEntryRow): SyncDocument<ShoppingListEntry> {
  return { ...toShoppingListEntry(row), _deleted: row.deletedAt !== null };
}

/** A create the server cannot take: the client's copy is dropped, and says why. */
function refuseCreate(next: SyncDocument<SyncedDocument>, reason: string | FieldError[]): Outcome {
  return {
    kind: 'refused',
    master: { ...next, _deleted: true },
    message: typeof reason === 'string' ? reason : describe(reason),
  };
}

function describe(errors: readonly FieldError[]): string {
  return errors.flatMap((error) => error.messages).join('; ');
}

function pick<T extends object, K extends keyof T>(source: T, keys: readonly K[]): Pick<T, K> {
  const picked = {} as Pick<T, K>;
  for (const key of keys) {
    if (key in source) picked[key] = source[key];
  }
  return picked;
}

function sameFields<T extends object>(a: T, b: T, keys: readonly (keyof T)[]): boolean {
  return keys.every((key) => a[key] === b[key]);
}

/** The fields among `keys` whose value differs between the two states. */
function changedFields<T extends object>(
  from: T,
  to: T,
  keys: readonly (keyof T)[],
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const key of keys) {
    if (from[key] !== to[key]) patch[key as string] = to[key];
  }
  return patch;
}
