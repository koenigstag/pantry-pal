import {
  ASSISTANT_ACTION,
  COUNT_UNIT,
  DEFAULT_CATEGORY,
  ITEM_STATUS,
  MAX_ASSISTANT_ACTIONS,
  MAX_ITEM_QUANTITY,
  QUANTITY_UNIT_KIND,
  type AssistantAction,
  type AssistantInterpretation,
  type AssistantUnitGroup,
  type AssistantUnresolved,
  type PantryItem,
  type UnitKind,
} from '@pantry-pal/shared';
import { ASSISTANT_ACTION_DTOS, validateDto } from '@pantry-pal/shared/dto';
import type { ClassConstructor } from 'class-transformer';

import type { Aliases } from './household-context';

/** The codes the server has, for normalising what the model picked. */
export interface Reference {
  unitKinds: ReadonlyMap<string, UnitKind>;
  categories: ReadonlySet<string>;
}

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

/** An action, nothing to do (`skip`), or a proposal that cannot be applied (`undefined`). */
type Resolved = AssistantAction | 'skip' | undefined;

/**
 * Reads the model's answer into proposals the client can show: aliases mapped
 * back to the household's ids, codes normalised to ones the server has, and
 * every action checked by the DTO the apply route validates it with.
 *
 * Whatever does not survive goes to `unresolved` with a `null` reason, so the
 * user sees that part of their text was not understood rather than losing it
 * silently. An action that would change nothing — an item already on the list
 * it is to go on — is dropped.
 */
export function readInterpretation(
  answer: unknown,
  aliases: Aliases,
  reference: Reference,
): AssistantInterpretation {
  const raw = isRecord(answer) ? answer : {};
  const actions: AssistantAction[] = [];
  const unresolved: AssistantUnresolved[] = [];

  for (const proposal of Array.isArray(raw.actions) ? raw.actions : []) {
    if (!isRecord(proposal)) continue;
    const quote = text(proposal.quote);

    const resolved =
      actions.length < MAX_ASSISTANT_ACTIONS ? resolve(proposal, aliases, reference) : undefined;
    if (resolved === 'skip') continue;
    if (resolved === undefined || !isValid(resolved)) {
      unresolved.push({ quote, reason: null });
      continue;
    }
    actions.push(resolved);
  }

  for (const part of Array.isArray(raw.unresolved) ? raw.unresolved : []) {
    if (!isRecord(part)) continue;
    const reason = text(part.reason).trim();
    unresolved.push({ quote: text(part.quote), reason: reason === '' ? null : reason });
  }

  return { actions, unresolved };
}

/** Whether the action passes the DTO the apply route will validate it with. */
export function isValid(action: AssistantAction): boolean {
  const dto: ClassConstructor<object> | undefined = ASSISTANT_ACTION_DTOS.find(
    (candidate) => candidate.name === action.type,
  )?.value;
  return dto !== undefined && validateDto(dto, action).ok;
}

function resolve(raw: Raw, aliases: Aliases, reference: Reference): Resolved {
  const quote = text(raw.quote);
  const shelfItem = (key: string): PantryItem | undefined => {
    const item = aliases.items.get(text(raw[key]));
    return item?.status === ITEM_STATUS.Active ? item : undefined;
  };

  switch (raw.type) {
    case ASSISTANT_ACTION.AddItem: {
      const location = aliases.locations.get(text(raw.locationId));
      const units = unitGroups(raw.units);
      if (location === undefined || units === undefined || total(units) > MAX_ITEM_QUANTITY) {
        return undefined;
      }
      const size = sizeOf(raw, reference);
      return {
        type: ASSISTANT_ACTION.AddItem,
        quote,
        locationId: location.id,
        name: text(raw.name),
        category: categoryOf(raw.category, reference),
        unit: countUnitOf(raw.unit, reference),
        sizeValue: size.value,
        sizeUnit: size.unit,
        units,
      };
    }

    case ASSISTANT_ACTION.AddUnits: {
      const item = shelfItem('itemId');
      const units = unitGroups(raw.units);
      if (item === undefined || units === undefined) return undefined;
      if (item.quantity + total(units) > MAX_ITEM_QUANTITY) return undefined;
      return { type: ASSISTANT_ACTION.AddUnits, quote, itemId: item.id, units };
    }

    case ASSISTANT_ACTION.SetQuantity: {
      const item = shelfItem('itemId');
      if (item === undefined || typeof raw.quantity !== 'number') return undefined;
      if (raw.quantity === item.quantity) return 'skip';
      return { type: ASSISTANT_ACTION.SetQuantity, quote, itemId: item.id, quantity: raw.quantity };
    }

    case ASSISTANT_ACTION.UseUp:
    case ASSISTANT_ACTION.Discard: {
      const item = shelfItem('itemId');
      if (item === undefined) return undefined;
      // As many as it has, or more, is all of it.
      const count = typeof raw.count === 'number' && raw.count < item.quantity ? raw.count : null;
      return { type: raw.type, quote, itemId: item.id, count };
    }

    case ASSISTANT_ACTION.UpdateUnit: {
      const found = aliases.units.get(text(raw.unitId));
      if (found === undefined) return undefined;
      const action = {
        type: ASSISTANT_ACTION.UpdateUnit,
        quote,
        itemId: found.item.id,
        subItemId: found.unit.id,
        expiresAt: dateOrNull(raw.expiresAt),
        openedAt: dateOrNull(raw.openedAt),
        fillPercent: typeof raw.fillPercent === 'number' ? raw.fillPercent : null,
      };
      const changes =
        (action.expiresAt !== null && action.expiresAt !== found.unit.expiresAt) ||
        (action.openedAt !== null && action.openedAt !== found.unit.openedAt) ||
        (action.fillPercent !== null && action.fillPercent !== found.unit.fillPercent);
      return changes ? action : 'skip';
    }

    case ASSISTANT_ACTION.MoveItem: {
      const item = shelfItem('itemId');
      const location = aliases.locations.get(text(raw.locationId));
      if (item === undefined || location === undefined) return undefined;
      if (item.locationId === location.id) return 'skip';
      return { type: ASSISTANT_ACTION.MoveItem, quote, itemId: item.id, locationId: location.id };
    }

    case ASSISTANT_ACTION.AddToList: {
      const list = aliases.lists.get(text(raw.listId));
      if (list === undefined || typeof raw.quantity !== 'number') return undefined;
      const item = aliases.items.get(text(raw.itemId));
      const newItem = isRecord(raw.newItem) ? raw.newItem : null;

      if (item !== undefined) {
        const listed = [...aliases.entries.values()].some(
          (entry) => entry.listId === list.id && entry.itemId === item.id,
        );
        if (listed) return 'skip';
        return {
          type: ASSISTANT_ACTION.AddToList,
          quote,
          listId: list.id,
          itemId: item.id,
          newItem: null,
          quantity: raw.quantity,
        };
      }

      const location =
        newItem === null ? undefined : aliases.locations.get(text(newItem.locationId));
      if (newItem === null || location === undefined) return undefined;
      return {
        type: ASSISTANT_ACTION.AddToList,
        quote,
        listId: list.id,
        itemId: null,
        newItem: {
          name: text(newItem.name),
          category: categoryOf(newItem.category, reference),
          unit: countUnitOf(newItem.unit, reference),
          locationId: location.id,
        },
        quantity: raw.quantity,
      };
    }

    case ASSISTANT_ACTION.CheckEntry: {
      const entry = aliases.entries.get(text(raw.entryId));
      if (entry === undefined || typeof raw.checked !== 'boolean') return undefined;
      if (raw.checked === (entry.checkedAt !== null)) return 'skip';
      return { type: ASSISTANT_ACTION.CheckEntry, quote, entryId: entry.id, checked: raw.checked };
    }

    case ASSISTANT_ACTION.BuyEntry:
    case ASSISTANT_ACTION.RemoveEntry: {
      const entry = aliases.entries.get(text(raw.entryId));
      if (entry === undefined) return undefined;
      return { type: raw.type, quote, entryId: entry.id };
    }

    default:
      return undefined;
  }
}

function unitGroups(value: unknown): AssistantUnitGroup[] | undefined {
  if (!Array.isArray(value) || value.length === 0) return undefined;
  const groups: AssistantUnitGroup[] = [];
  for (const group of value) {
    if (
      !isRecord(group) ||
      typeof group.count !== 'number' ||
      typeof group.fillPercent !== 'number'
    ) {
      return undefined;
    }
    groups.push({
      count: group.count,
      expiresAt: dateOrNull(group.expiresAt),
      openedAt: dateOrNull(group.openedAt),
      periodAfterOpeningDays:
        typeof group.periodAfterOpeningDays === 'number' ? group.periodAfterOpeningDays : null,
      fillPercent: group.fillPercent,
    });
  }
  return groups;
}

export const total = (groups: readonly AssistantUnitGroup[]): number =>
  groups.reduce((sum, group) => sum + group.count, 0);

const dateOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/** A category the server has, else the default one. */
function categoryOf(value: unknown, reference: Reference): string {
  const code = text(value);
  return reference.categories.has(code) ? code : DEFAULT_CATEGORY;
}

/** A count unit the server has, else plain pieces. */
function countUnitOf(value: unknown, reference: Reference): string {
  const code = text(value);
  return reference.unitKinds.get(code) === QUANTITY_UNIT_KIND ? code : COUNT_UNIT;
}

/** Both or neither, in a unit the server has. */
function sizeOf(raw: Raw, reference: Reference): { value: number | null; unit: string | null } {
  const value = typeof raw.sizeValue === 'number' ? raw.sizeValue : undefined;
  const unit = text(raw.sizeUnit);
  return value !== undefined && reference.unitKinds.has(unit)
    ? { value, unit }
    : { value: null, unit: null };
}
