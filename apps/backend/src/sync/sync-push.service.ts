import { HttpException, Injectable, Logger } from '@nestjs/common';
import {
  ItemsRepository,
  ShoppingListEntriesRepository,
  type ItemRow,
  type ShoppingListEntryRow,
} from '@pantry-pal/db';
import {
  DEFAULT_CATEGORY,
  ITEM_STATUS,
  SYNC_COLLECTION,
  type PantryItem,
  type ShoppingListEntry,
  type SubItem,
  type SyncDocument,
  type SyncPushCollection,
  type SyncPushResult,
  type SyncRefusal,
} from '@pantry-pal/shared';
import {
  CreatePantryItemDto,
  NewSubItemDto,
  UpdatePantryItemDto,
  UpdateShoppingListEntryDto,
  UpdateSubItemDto,
  validateDto,
  type FieldError,
  type SyncPushRowDto,
} from '@pantry-pal/shared/dto';

import type { Membership } from '../common/request-context';
import { toItemFields, toPantryItem } from '../items/item.mapper';
import { ItemsService, type ItemChanges, type SubItemChanges } from '../items/items.service';
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

/**
 * The item fields its units decide: how many, and the lead unit's dates. A
 * mirror that sends units changes them there, so these are only read from a
 * mirror made before units existed.
 */
const UNIT_DERIVED_FIELDS = new Set<string>([
  'quantity',
  'expiresAt',
  'openedAt',
  'periodAfterOpeningDays',
]);

/** The item's own fields, beside units that say the rest. */
const OWN_ITEM_FIELDS = ITEM_FIELDS.filter((field) => !UNIT_DERIVED_FIELDS.has(field));

/** What a client may change on one unit. */
const SUB_ITEM_FIELDS = [
  'expiresAt',
  'openedAt',
  'periodAfterOpeningDays',
  'fillPercent',
  'status',
] as const satisfies readonly (keyof SubItem)[];

type ItemDocument = SyncDocument<PantryItem> | SyncDocument<Omit<PantryItem, 'subItems'>>;

type Outcome =
  | { kind: 'applied' }
  | { kind: 'conflict'; master: SyncDocument<SyncedDocument> }
  | { kind: 'refused'; master: SyncDocument<SyncedDocument>; message: string };

const APPLIED: Outcome = { kind: 'applied' };

/**
 * Takes the offline mirror's local changes to items and shopping entries.
 *
 * **Every change goes through the domain services**, exactly as a REST write
 * would: the same validation, locks, history and broadcasts. The push only works
 * out what the client changed, and whether it changed it from what the server
 * holds.
 *
 * Two things differ from REST, because the mirror did them itself already: an
 * item that runs out is not put on its default list — the mirror added that
 * entry, and pushes it next — and `isEdible` is left out wherever a category
 * other than the default one decides it, since the mirror's copy is a guess.
 *
 * Per row, independently, oldest first:
 * - **Created** (no assumed state): made under the client's id — with its units
 *   under theirs — then changed as it was changed since, in one transaction. A
 *   replay of a create that already landed is recognised and passes.
 * - **Changed or deleted**: applied if the client's base is still current — its
 *   `updatedAt` is the server's — and otherwise answered with the server's
 *   version, for the client's conflict handler to merge and send again.
 * - **Refused** (invalid, or against a rule such as an archived list): answered
 *   with the server's version too, and listed in `refused` with the reason, so
 *   the client can say why instead of retrying forever.
 *
 * **Units.** A mirror that knows about units sends an item with its
 * `subItems`: the units it added, changed or deleted are worked out by id, and
 * the quantity and dates follow from them. A mirror made before units existed
 * sends none, and its quantity and dates are applied to the item as a whole, as
 * they always were. Each is answered in its own shape.
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
    const next = row.newDocumentState as unknown as ItemDocument;
    const assumed = row.assumedMasterState as unknown as ItemDocument | undefined;
    const master = await this.items.findAnyById(membership.householdId, next.id);
    // Answered in the shape it came in: a mirror made before units takes none.
    const withUnits = subItemsOf(next) !== undefined;

    if (assumed === undefined) {
      if (master !== undefined) {
        const current = itemDocument(master, withUnits);
        return sameCreate(current, next) ? APPLIED : { kind: 'conflict', master: current };
      }
      // Made and deleted before it ever reached the server: nothing to do.
      if (next._deleted) return APPLIED;

      return this.createItem(membership, next);
    }

    if (master === undefined) return refuseCreate(next, 'Item not found');
    const current = itemDocument(master, withUnits);
    if (current.updatedAt !== assumed.updatedAt) return { kind: 'conflict', master: current };

    if (next._deleted) {
      return this.attempt(() => this.itemsService.remove(membership, next.id), {
        onRefusal: () => this.currentItem(membership, next.id, withUnits),
      });
    }

    const assumedUnits = subItemsOf(assumed);
    const nextUnits = subItemsOf(next);
    const unitChanges =
      assumedUnits === undefined || nextUnits === undefined
        ? undefined
        : diffSubItems(assumedUnits, nextUnits);

    const patch = changedFields(assumed, next, [
      ...(unitChanges === undefined ? ITEM_FIELDS : OWN_ITEM_FIELDS),
      'status',
    ]);
    if ('category' in patch && next.category !== DEFAULT_CATEGORY) delete patch['isEdible'];
    if (Object.keys(patch).length === 0 && unitChanges === undefined) return APPLIED;

    const changes = validateChanges(patch, unitChanges);
    if (!changes.ok) return { kind: 'refused', master: current, message: changes.message };
    return this.attempt(
      () =>
        this.itemsService.applyChanges(membership, next.id, changes.value, {
          // The mirror put the item on its default list itself, and pushes that entry next.
          listWhenRunOut: false,
        }),
      { onRefusal: () => this.currentItem(membership, next.id, withUnits) },
    );
  }

  /**
   * An item made offline: created as it was made — with its units, all on the
   * shelf, when it has them — then changed as it was changed since, in one
   * transaction. So a unit used up before the item was ever sent is recorded as
   * used up, and an item used up as a whole arrives used up.
   */
  private createItem(membership: Membership, next: ItemDocument): Promise<Outcome> {
    const units = subItemsOf(next);
    const fields: Record<string, unknown> = pick(
      next,
      units === undefined ? ITEM_FIELDS : OWN_ITEM_FIELDS,
    );
    if (next.category !== DEFAULT_CATEGORY) delete fields['isEdible'];

    const later: { patch: Record<string, unknown>; subItems?: SubItemChanges } = { patch: {} };
    if (units === undefined) {
      // Stepped down to nothing before it was sent: made with one, then used up.
      if (fields['quantity'] === 0) {
        fields['quantity'] = 1;
        later.patch['quantity'] = 0;
      }
    } else {
      fields['quantity'] = units.length;
      fields['subItems'] = units.map(newSubItemFields);
      const retired = units.filter((unit) => unit.status !== ITEM_STATUS.Active);
      if (retired.length > 0) {
        later.subItems = {
          update: retired.map((unit) => ({ id: unit.id, patch: { status: unit.status } })),
        };
      }
    }
    if (next.status !== ITEM_STATUS.Active) later.patch['status'] = next.status;

    const dto = validateDto(CreatePantryItemDto, { id: next.id, ...fields });
    if (!dto.ok) return Promise.resolve(refuseCreate(next, dto.errors));
    const changes = validateChanges(later.patch, later.subItems);
    if (!changes.ok) return Promise.resolve(refuseCreate(next, changes.message));

    return this.attempt(
      () =>
        this.itemsService.createAndApply(membership, dto.value, changes.value, {
          listWhenRunOut: false,
        }),
      { onRefusal: () => ({ ...next, _deleted: true }) },
    );
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
    withUnits: boolean,
  ): Promise<SyncDocument<SyncedDocument>> {
    const row = await this.items.findAnyById(membership.householdId, id);
    if (row === undefined) throw new Error(`Item ${id} vanished during a push`);
    return itemDocument(row, withUnits);
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

function itemDocument(row: ItemRow, withUnits: boolean): ItemDocument {
  const item = withUnits ? toPantryItem(row) : toItemFields(row);
  return { ...item, _deleted: row.deletedAt !== null };
}

function entryDocument(row: ShoppingListEntryRow): SyncDocument<ShoppingListEntry> {
  return { ...toShoppingListEntry(row), _deleted: row.deletedAt !== null };
}

/**
 * Whether a create the client sends again is the one that landed: the same
 * fields, and with units, the same units on the shelf in the same states. Units
 * decide the quantity and dates then, and are compared instead of them: two
 * units expiring the same day can each be the one whose dates an item shows.
 */
function sameCreate(current: ItemDocument, next: ItemDocument): boolean {
  const currentUnits = subItemsOf(current);
  const nextUnits = subItemsOf(next);
  if (currentUnits === undefined || nextUnits === undefined) {
    return sameFields(current, next, ITEM_FIELDS);
  }

  const shelved = nextUnits.filter((unit) => unit.status === ITEM_STATUS.Active);
  const byId = new Map(currentUnits.map((unit) => [unit.id, unit]));
  return (
    sameFields(current, next, OWN_ITEM_FIELDS) &&
    shelved.length === currentUnits.length &&
    shelved.every((unit) => {
      const held = byId.get(unit.id);
      return (
        held !== undefined && Object.keys(changedFields(held, unit, SUB_ITEM_FIELDS)).length === 0
      );
    })
  );
}

/** The units a document holds, or `undefined` from a mirror made before units existed. */
function subItemsOf(document: ItemDocument): readonly SubItem[] | undefined {
  const units: unknown = (document as Partial<PantryItem>).subItems;
  return Array.isArray(units) ? (units as SubItem[]) : undefined;
}

/**
 * What changed among an item's units, by id: those only in `next` were added,
 * those only in `assumed` deleted, and those in both changed where their
 * fields differ. `undefined` when nothing did.
 */
function diffSubItems(
  assumed: readonly SubItem[],
  next: readonly SubItem[],
): SubItemChanges | undefined {
  const before = new Map(assumed.map((unit) => [unit.id, unit]));
  const after = new Set(next.map((unit) => unit.id));

  const add: NewSubItemDto[] = [];
  const update: { id: string; patch: Record<string, unknown> }[] = [];

  for (const unit of next) {
    const was = before.get(unit.id);
    if (was === undefined) {
      add.push(newSubItemFields(unit));
      // Added, then used up or thrown out before it was sent.
      if (unit.status !== ITEM_STATUS.Active) {
        update.push({ id: unit.id, patch: { status: unit.status } });
      }
      continue;
    }
    const patch = changedFields(was, unit, SUB_ITEM_FIELDS);
    if (Object.keys(patch).length > 0) update.push({ id: unit.id, patch });
  }
  const remove = assumed.filter((unit) => !after.has(unit.id)).map((unit) => unit.id);

  if (add.length === 0 && update.length === 0 && remove.length === 0) return undefined;
  return {
    ...(add.length > 0 && { add }),
    ...(update.length > 0 && { update: update as SubItemChanges['update'] }),
    ...(remove.length > 0 && { remove }),
  };
}

/** A unit as a new one is sent: its identity and state, on the shelf. */
function newSubItemFields(unit: SubItem): NewSubItemDto {
  return {
    id: unit.id,
    expiresAt: unit.expiresAt,
    openedAt: unit.openedAt,
    periodAfterOpeningDays: unit.periodAfterOpeningDays,
    fillPercent: unit.fillPercent,
  };
}

/**
 * The item's patch and its units' changes, checked against the same DTOs a
 * REST write is: the first invalid one refuses the whole row.
 */
function validateChanges(
  patch: Record<string, unknown>,
  subItems: SubItemChanges | undefined,
): { ok: true; value: ItemChanges } | { ok: false; message: string } {
  const value: ItemChanges = {};

  if (Object.keys(patch).length > 0) {
    const dto = validateDto(UpdatePantryItemDto, patch);
    if (!dto.ok) return { ok: false, message: describe(dto.errors) };
    value.patch = dto.value;
  }

  if (subItems !== undefined) {
    const add: NewSubItemDto[] = [];
    for (const unit of subItems.add ?? []) {
      const dto = validateDto(NewSubItemDto, unit);
      if (!dto.ok) return { ok: false, message: describe(dto.errors) };
      add.push(dto.value);
    }
    const update: { id: string; patch: UpdateSubItemDto }[] = [];
    for (const { id, patch: unitPatch } of subItems.update ?? []) {
      const dto = validateDto(UpdateSubItemDto, unitPatch);
      if (!dto.ok) return { ok: false, message: describe(dto.errors) };
      update.push({ id, patch: dto.value });
    }
    value.subItems = { add, update, remove: subItems.remove ?? [] };
  }

  return { ok: true, value };
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
