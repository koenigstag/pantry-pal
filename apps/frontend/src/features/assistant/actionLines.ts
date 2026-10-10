import {
  ASSISTANT_ACTION,
  FULL_FILL_PERCENT,
  type AssistantAction,
  type AssistantUnitGroup,
  type PantryItem,
} from '@pantry-pal/shared';

import { formatCalendarDate, formatPercent } from '../../i18n/format';
import { messages } from '../../i18n/messages';
import type { PantryStore } from '../../stores/PantryStore';
import { locationName } from '../storage/locationName';

/** What one preview line shows: what changes, and the particulars under it. */
export interface ActionLine {
  title: string;
  details: string[];
}

/**
 * A proposal as its preview line reads, named from what this device holds.
 * The mirror holds items of every status, so an item the assistant names is
 * here unless it changed since; then the line says "an item" rather than
 * nothing, and the server checks it anyway.
 */
export function actionLine(action: AssistantAction, pantry: PantryStore): ActionLine {
  const t = messages.assistant;
  const item = (id: string): PantryItem | undefined =>
    pantry.items.find((candidate) => candidate.id === id) ??
    pantry.offShelfItems.find((candidate) => candidate.id === id);
  const itemName = (id: string): string => item(id)?.name ?? t.someItem;
  const space = (id: string): string => {
    const location = pantry.locations.find((candidate) => candidate.id === id);
    return location === undefined ? t.someItem : locationName(location);
  };
  const list = (id: string): string =>
    pantry.shoppingLists.find((candidate) => candidate.id === id)?.name ?? t.someItem;
  const amount = (count: number, unit: string): string =>
    messages.item.amount(count, pantry.unitName(unit, count));
  const groups = (units: readonly AssistantUnitGroup[], unit: string): string[] =>
    units.map((group) => [amount(group.count, unit), ...unitState(group)].join(', '));

  switch (action.type) {
    case ASSISTANT_ACTION.AddItem:
      return {
        title: t.actions.addItem(action.name, space(action.locationId)),
        details: [pantry.categoryName(action.category), ...groups(action.units, action.unit)],
      };

    case ASSISTANT_ACTION.AddUnits:
      return {
        title: t.actions.addUnits(itemName(action.itemId)),
        details: groups(action.units, item(action.itemId)?.unit ?? 'pcs'),
      };

    case ASSISTANT_ACTION.SetQuantity: {
      const unit = item(action.itemId)?.unit ?? 'pcs';
      return {
        title: t.actions.setQuantity(itemName(action.itemId), amount(action.quantity, unit)),
        details: [],
      };
    }

    case ASSISTANT_ACTION.UseUp:
    case ASSISTANT_ACTION.Discard: {
      const found = item(action.itemId);
      const title = action.type === ASSISTANT_ACTION.UseUp ? t.actions.useUp : t.actions.discard;
      return {
        title: title(itemName(action.itemId)),
        details: [
          action.count === null || found === undefined
            ? t.details.all
            : t.details.some(action.count, found.quantity),
        ],
      };
    }

    case ASSISTANT_ACTION.UpdateUnit:
      return {
        title: t.actions.updateUnit(itemName(action.itemId)),
        details: [
          ...(action.openedAt === null
            ? []
            : [t.details.opened(formatCalendarDate(action.openedAt))]),
          ...(action.fillPercent === null
            ? []
            : [t.details.left(formatPercent(action.fillPercent))]),
          ...(action.expiresAt === null
            ? []
            : [t.details.expires(formatCalendarDate(action.expiresAt))]),
        ],
      };

    case ASSISTANT_ACTION.MoveItem:
      return {
        title: t.actions.moveItem(itemName(action.itemId), space(action.locationId)),
        details: [],
      };

    case ASSISTANT_ACTION.AddToList: {
      const name = action.newItem?.name ?? itemName(action.itemId ?? '');
      const unit = action.newItem?.unit ?? item(action.itemId ?? '')?.unit ?? 'pcs';
      return {
        title: t.actions.addToList(name, list(action.listId)),
        details: [
          t.details.toBuy(amount(action.quantity, unit)),
          ...(action.newItem === null ? [] : [t.details.newItem]),
        ],
      };
    }

    case ASSISTANT_ACTION.CheckEntry:
    case ASSISTANT_ACTION.BuyEntry:
    case ASSISTANT_ACTION.RemoveEntry: {
      const entry = pantry.shoppingEntries.find((candidate) => candidate.id === action.entryId);
      const name = entry === undefined ? t.someItem : itemName(entry.itemId);
      if (action.type === ASSISTANT_ACTION.CheckEntry) {
        return {
          title: action.checked ? t.actions.checkEntry(name) : t.actions.uncheckEntry(name),
          details: [],
        };
      }
      if (action.type === ASSISTANT_ACTION.RemoveEntry) {
        return {
          title: t.actions.removeEntry(name, entry === undefined ? t.someItem : list(entry.listId)),
          details: [],
        };
      }
      const unit = entry === undefined ? undefined : item(entry.itemId)?.unit;
      return {
        title: t.actions.buyEntry(name),
        details:
          entry === undefined ? [] : [t.details.restocked(amount(entry.quantity, unit ?? 'pcs'))],
      };
    }
  }
}

/** How units differ from sealed and full: opened, partly used, a printed date. */
function unitState(group: AssistantUnitGroup): string[] {
  const t = messages.assistant.details;
  return [
    ...(group.openedAt === null ? [] : [t.opened(formatCalendarDate(group.openedAt))]),
    ...(group.fillPercent < FULL_FILL_PERCENT ? [t.left(formatPercent(group.fillPercent))] : []),
    ...(group.expiresAt === null ? [] : [t.expires(formatCalendarDate(group.expiresAt))]),
  ];
}
