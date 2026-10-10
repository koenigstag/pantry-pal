import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import {
  ItemsRepository,
  LocationsRepository,
  ShoppingListEntriesRepository,
  ShoppingListsRepository,
  Transactional,
} from '@pantry-pal/db';
import {
  ASSISTANT_ACTION,
  ASSISTANT_SOURCE,
  consumeOrder,
  FULL_FILL_PERCENT,
  ITEM_STATUS,
  MAX_ITEM_QUANTITY,
  type AssistantAction,
  type AssistantApplyResult,
  type AssistantUnitGroup,
  type ItemStatus,
  type PantryItem,
  type PantryLocation,
  type ShoppingList,
  type ShoppingListEntry,
} from '@pantry-pal/shared';
import type {
  ApplyAssistantActionsDto,
  NewSubItemDto,
  UpdateSubItemDto,
} from '@pantry-pal/shared/dto';

import type { AuthenticatedUser, Membership } from '../common/request-context';
import { todayIn } from '../common/today';
import type { ImportPlan, PlannedItem, PlannedUnit } from '../data/import-plan';
import { ImportService } from '../data/import.service';
import { toPantryItem } from '../items/item.mapper';
import { ItemsService } from '../items/items.service';
import { toPantryLocation } from '../locations/location.mapper';
import { toShoppingList, toShoppingListEntry } from '../shopping-lists/shopping-list.mapper';
import { ShoppingListsService } from '../shopping-lists/shopping-lists.service';

/** A household as an assistant reads it: what is on its shelves and its lists in use. */
export interface HouseholdSnapshot {
  locations: PantryLocation[];
  /** Active items, with their units. */
  items: PantryItem[];
  /** Lists in use: an archived list is frozen, so nothing is proposed for it. */
  lists: ShoppingList[];
  /** The entries of those lists. */
  entries: ShoppingListEntry[];
  /** Every item an entry names, whatever its status: a used-up one is off the shelf. */
  listedItems: PantryItem[];
}

/** How many units a list of unit groups adds. */
export const total = (groups: readonly AssistantUnitGroup[]): number =>
  groups.reduce((sum, group) => sum + group.count, 0);

/**
 * Changes an assistant asks for, whichever assistant: the built-in one, which
 * proposes them for the user to tick, or one connected over MCP. Reads the
 * household for it, and applies a set of `AssistantAction`s in one
 * transaction, through the same services as the forms — new items as an
 * import adds them, the rest through the items and shopping list services — so
 * history, locks and broadcasts hold, and the offline mirror pulls the result
 * like any change.
 */
@Injectable()
export class ChangesService {
  constructor(
    private readonly locations: LocationsRepository,
    private readonly items: ItemsRepository,
    private readonly lists: ShoppingListsRepository,
    private readonly entries: ShoppingListEntriesRepository,
    private readonly itemsService: ItemsService,
    private readonly shopping: ShoppingListsService,
    private readonly imports: ImportService,
  ) {}

  /**
   * The household as an assistant reads it — storage spaces, active items and
   * their units, lists in use, their entries and the items they name — from one
   * snapshot, so no entry names an item the read missed.
   */
  @Transactional({ isolationLevel: 'repeatable read' })
  async snapshot(membership: Membership): Promise<HouseholdSnapshot> {
    const { householdId } = membership;

    const locations = await this.locations.list(householdId);
    const items = await this.items.list(householdId, { status: ITEM_STATUS.Active });
    const lists = (await this.lists.list(householdId)).filter((list) => list.archivedAt === null);
    const open = new Set(lists.map((list) => list.id));
    const entries = (await this.entries.listForHousehold(householdId)).filter((entry) =>
      open.has(entry.listId),
    );
    const listedItems = await this.items.findByIds(householdId, [
      ...new Set(entries.map((entry) => entry.itemId)),
    ]);

    return {
      locations: locations.map(toPantryLocation),
      items: items.map(toPantryItem),
      lists: lists.map(toShoppingList),
      entries: entries.map(toShoppingListEntry),
      listedItems: listedItems.map(toPantryItem),
    };
  }

  /**
   * Applies the actions the user kept, all or nothing. The services check
   * every id and rule again, since a proposal is only ever a request: anything
   * they refuse rolls the whole set back.
   *
   * New items come first, in one go, under the household lock the import
   * takes; then every other action, in the order given. A thing to buy the
   * household never had is made as an item that has run out, so it waits on
   * the list rather than standing empty on a shelf.
   */
  @Transactional()
  async apply(
    membership: Membership,
    user: AuthenticatedUser,
    dto: ApplyAssistantActionsDto,
  ): Promise<AssistantApplyResult> {
    const { householdId } = membership;
    const today = todayIn(user.timezone);
    // The discriminated DTOs have checked each action's shape against its type.
    const actions = dto.actions as unknown as AssistantAction[];

    const locations = new Map(
      (await this.locations.list(householdId)).map((location) => [location.id, location]),
    );
    const entries = new Map(
      (await this.entries.listForHousehold(householdId)).map((entry) => [entry.id, entry]),
    );
    const location = (id: string): void => {
      if (!locations.has(id)) {
        throw new BadRequestException('locationId does not name a storage space in this household');
      }
    };
    const entryOf = (id: string): { listId: string; checked: boolean } => {
      const entry = entries.get(id);
      if (entry === undefined) throw new NotFoundException('Shopping list entry not found');
      return { listId: entry.listId, checked: entry.checkedAt !== null };
    };

    // New items, and things to buy the household never had, as one import.
    const planned: Array<{ index: number; item: PlannedItem }> = [];
    for (const [index, action] of actions.entries()) {
      if (action.type === ASSISTANT_ACTION.AddItem) {
        location(action.locationId);
        if (total(action.units) > MAX_ITEM_QUANTITY) {
          throw new BadRequestException(`An item holds at most ${MAX_ITEM_QUANTITY} units`);
        }
        planned.push({
          index,
          item: plannedItem(
            index,
            action,
            action.units.flatMap((group) => plannedUnits(group, today)),
          ),
        });
      } else if (action.type === ASSISTANT_ACTION.AddToList) {
        if ((action.itemId === null) === (action.newItem === null)) {
          throw new BadRequestException('Name either an item (itemId) or a new one (newItem)');
        }
        if (action.newItem !== null) {
          location(action.newItem.locationId);
          planned.push({
            index,
            item: plannedItem(index, { ...action.newItem, sizeValue: null, sizeUnit: null }, []),
          });
        }
      }
    }

    const landed = new Map<number, string>();
    if (planned.length > 0) {
      const plan: ImportPlan = {
        spaces: [...new Set(planned.map(({ item }) => item.spaceKey))].map((id) => ({
          key: id,
          id,
          name: locations.get(id)?.name ?? '',
          icon: null,
          isFallback: false,
        })),
        items: planned.map(({ item }) => item),
        skipped: [],
      };
      const ids = await this.imports.addPlanned(membership, user.locale, plan);
      for (const [position, { index }] of planned.entries()) {
        const id = ids[position];
        if (id !== undefined) landed.set(index, id);
      }
    }

    for (const [index, action] of actions.entries()) {
      // In the order given: a later action may act on what an earlier one did.
      /* oxlint-disable no-await-in-loop */
      switch (action.type) {
        case ASSISTANT_ACTION.AddItem:
          break;

        case ASSISTANT_ACTION.AddUnits:
          await this.itemsService.changeSubItems(membership, action.itemId, {
            add: action.units.flatMap((group) => newSubItems(group, today)),
          });
          break;

        case ASSISTANT_ACTION.SetQuantity:
          await this.itemsService.update(membership, action.itemId, { quantity: action.quantity });
          break;

        case ASSISTANT_ACTION.UseUp:
          await this.take(membership, action.itemId, action.count, ITEM_STATUS.Consumed);
          break;

        case ASSISTANT_ACTION.Discard:
          await this.take(membership, action.itemId, action.count, ITEM_STATUS.Discarded);
          break;

        case ASSISTANT_ACTION.UpdateUnit:
          await this.updateUnit(membership, action, today);
          break;

        case ASSISTANT_ACTION.MoveItem:
          location(action.locationId);
          await this.itemsService.update(membership, action.itemId, {
            locationId: action.locationId,
          });
          break;

        case ASSISTANT_ACTION.AddToList: {
          const itemId = action.itemId ?? landed.get(index);
          if (itemId === undefined) throw new Error('A new item to buy was not created');
          if (action.newItem !== null) await this.offTheShelf(membership, itemId);
          await this.shopping.addEntries(membership, action.listId, {
            itemIds: [itemId],
            quantity: action.quantity,
          });
          break;
        }

        case ASSISTANT_ACTION.CheckEntry: {
          const { listId } = entryOf(action.entryId);
          await this.shopping.updateEntry(membership, listId, action.entryId, {
            checked: action.checked,
          });
          break;
        }

        case ASSISTANT_ACTION.BuyEntry: {
          // Putting away takes ticked-off entries, as the Bought button sends them.
          const { listId, checked } = entryOf(action.entryId);
          if (!checked) {
            await this.shopping.updateEntry(membership, listId, action.entryId, { checked: true });
          }
          await this.shopping.putAway(membership, listId, { entryIds: [action.entryId] });
          entries.delete(action.entryId);
          break;
        }

        case ASSISTANT_ACTION.RemoveEntry: {
          const { listId } = entryOf(action.entryId);
          await this.shopping.removeEntry(membership, listId, action.entryId);
          entries.delete(action.entryId);
          break;
        }
      }
      /* oxlint-enable no-await-in-loop */
    }

    return { applied: actions.length };
  }

  /**
   * Uses up or throws out `count` units, those that should go first — or the
   * whole item when `count` is `null` or covers every unit on the shelf, as
   * the item's own status, so its units come back if it is restored.
   */
  private async take(
    membership: Membership,
    itemId: string,
    count: number | null,
    status: ItemStatus,
  ): Promise<void> {
    const item = await this.itemsService.get(membership, itemId);
    const units = consumeOrder(item.subItems);

    if (count === null || count >= units.length) {
      await this.itemsService.update(membership, itemId, { status });
      return;
    }
    await this.itemsService.changeSubItems(membership, itemId, {
      update: units.slice(0, count).map((unit) => ({ id: unit.id, patch: { status } })),
    });
  }

  /** A unit below full has been opened: today, when it was not and the action does not say. */
  private async updateUnit(
    membership: Membership,
    action: Extract<AssistantAction, { type: typeof ASSISTANT_ACTION.UpdateUnit }>,
    today: string,
  ): Promise<void> {
    const item = await this.itemsService.get(membership, action.itemId);
    const unit = item.subItems.find((candidate) => candidate.id === action.subItemId);
    if (unit === undefined) throw new NotFoundException(`Item has no unit ${action.subItemId}`);

    const patch: UpdateSubItemDto = {};
    if (action.expiresAt !== null) patch.expiresAt = action.expiresAt;
    if (action.openedAt !== null) patch.openedAt = action.openedAt;
    if (action.fillPercent !== null) {
      patch.fillPercent = action.fillPercent;
      if (action.fillPercent < FULL_FILL_PERCENT && (patch.openedAt ?? unit.openedAt) === null) {
        patch.openedAt = today;
      }
    }
    await this.itemsService.changeSubItems(membership, action.itemId, {
      update: [{ id: unit.id, patch }],
    });
  }

  /**
   * A thing to buy that was just made, with nothing on the shelf, as used up:
   * putting the shopping away brings it back as a new batch. One the household
   * had on a shelf already stays as it is.
   */
  private async offTheShelf(membership: Membership, itemId: string): Promise<void> {
    const row = await this.items.findById(membership.householdId, itemId);
    if (row?.status !== ITEM_STATUS.Active || row.quantity > 0) return;
    await this.itemsService.update(
      membership,
      itemId,
      { status: ITEM_STATUS.Consumed },
      { listWhenRunOut: false },
    );
  }
}

/** A planned item for the import, from an `add-item` or a new thing to buy. */
function plannedItem(
  index: number,
  fields: {
    locationId: string;
    name: string;
    category: string;
    unit: string;
    sizeValue: number | null;
    sizeUnit: string | null;
  },
  units: PlannedUnit[],
): PlannedItem {
  return {
    sheet: ASSISTANT_SOURCE,
    row: index + 1,
    id: null,
    spaceKey: fields.locationId,
    name: fields.name,
    category: fields.category,
    isEdible: null,
    unit: fields.unit,
    sizeValue: fields.sizeValue,
    sizeUnit: fields.sizeUnit,
    notes: null,
    units,
    excessUnits: 0,
  };
}

/** A unit below full was opened: today, unless the group says when. */
const openedOn = (group: AssistantUnitGroup, today: string): string | null =>
  group.openedAt ?? (group.fillPercent < FULL_FILL_PERCENT ? today : null);

function plannedUnits(group: AssistantUnitGroup, today: string): PlannedUnit[] {
  return Array.from({ length: group.count }, () => ({
    id: null,
    expiresAt: group.expiresAt,
    openedAt: openedOn(group, today),
    periodAfterOpeningDays: group.periodAfterOpeningDays,
    fillPercent: group.fillPercent,
  }));
}

function newSubItems(group: AssistantUnitGroup, today: string): NewSubItemDto[] {
  return Array.from({ length: group.count }, () => ({
    expiresAt: group.expiresAt,
    openedAt: openedOn(group, today),
    periodAfterOpeningDays: group.periodAfterOpeningDays,
    fillPercent: group.fillPercent,
  }));
}
