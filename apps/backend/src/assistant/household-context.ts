import {
  FULL_FILL_PERCENT,
  ITEM_STATUS,
  type PantryItem,
  type PantryLocation,
  type ShoppingList,
  type ShoppingListEntry,
  type SubItem,
} from '@pantry-pal/shared';

/** A household as the assistant reads it: what is on its shelves and its lists in use. */
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

/**
 * The short ids the prompt names things by, and what each stands for. Short ids
 * cost a fraction of a UUID's tokens and are harder to miscopy; they live only
 * as long as one interpretation.
 */
export interface Aliases {
  locations: Map<string, PantryLocation>;
  items: Map<string, PantryItem>;
  units: Map<string, { item: PantryItem; unit: SubItem }>;
  lists: Map<string, ShoppingList>;
  entries: Map<string, ShoppingListEntry>;
}

/**
 * A name as the prompt shows it: a JSON string, so a quote or a newline cannot
 * break out of its line, with `<` escaped too, so no name can close the
 * `<household>` block it sits in.
 */
const quoted = (name: string): string => JSON.stringify(name).replaceAll('<', '\\u003c');

/** The household as the user turn shows it, and the aliases it uses. */
export function describeHousehold(snapshot: HouseholdSnapshot): {
  text: string;
  aliases: Aliases;
} {
  const aliases: Aliases = {
    locations: new Map(),
    items: new Map(),
    units: new Map(),
    lists: new Map(),
    entries: new Map(),
  };
  const locationAlias = new Map<string, string>();
  const itemAlias = new Map<string, string>();
  const listAlias = new Map<string, string>();

  const lines: string[] = ['Storage spaces:'];
  for (const [index, location] of snapshot.locations.entries()) {
    const alias = `L${index + 1}`;
    aliases.locations.set(alias, location);
    locationAlias.set(location.id, alias);
    lines.push(`${alias} ${quoted(location.name)}${location.isFallback ? ' (fallback)' : ''}`);
  }

  for (const [index, list] of snapshot.lists.entries()) {
    const alias = `S${index + 1}`;
    aliases.lists.set(alias, list);
    listAlias.set(list.id, alias);
  }

  // Items on the shelves first, then those only on a list, numbered as one sequence.
  const onShelf = new Set(snapshot.items.map((item) => item.id));
  const items = [
    ...snapshot.items,
    ...snapshot.listedItems.filter((item) => !onShelf.has(item.id)),
  ];
  let unitNumber = 0;

  lines.push('', 'Items:');
  for (const [index, item] of items.entries()) {
    const alias = `I${index + 1}`;
    aliases.items.set(alias, item);
    itemAlias.set(item.id, alias);

    const where = locationAlias.get(item.locationId);
    const size =
      item.sizeValue === null || item.sizeUnit === null
        ? ''
        : ` × ${item.sizeValue} ${item.sizeUnit}`;
    const parts = [
      `${alias} ${quoted(item.name)}`,
      where === undefined ? 'in a deleted space' : `in ${where}`,
      item.category,
      item.status === ITEM_STATUS.Active
        ? `${item.quantity} ${item.unit}${size}`
        : `${item.status}, ${item.unit}${size}`,
    ];
    const defaultList =
      item.defaultShoppingListId === null ? undefined : listAlias.get(item.defaultShoppingListId);
    if (defaultList !== undefined) parts.push(`goes on ${defaultList} when it runs out`);
    lines.push(parts.join(' · '));

    if (item.status !== ITEM_STATUS.Active) continue;
    // Units alike share a line and a range of aliases: ten sealed eggs are one line, not ten.
    const alike = new Map<string, SubItem[]>();
    for (const unit of item.subItems) {
      const state = describeUnit(unit);
      alike.set(state, [...(alike.get(state) ?? []), unit]);
    }
    for (const [state, units] of alike) {
      const first = unitNumber + 1;
      for (const unit of units) {
        unitNumber += 1;
        aliases.units.set(`U${unitNumber}`, { item, unit });
      }
      const range =
        units.length === 1 ? `U${first}` : `U${first}–U${unitNumber} (${units.length} alike)`;
      lines.push(`  ${range} ${state}`);
    }
  }
  if (items.length === 0) lines.push('(none)');

  lines.push('', 'Shopping lists:');
  for (const [alias, list] of aliases.lists) {
    lines.push(`${alias} ${quoted(list.name)}`);
    let entryNumber = aliases.entries.size;
    for (const entry of snapshot.entries.filter((candidate) => candidate.listId === list.id)) {
      entryNumber += 1;
      const entryAlias = `E${entryNumber}`;
      aliases.entries.set(entryAlias, entry);
      const item = itemAlias.get(entry.itemId) ?? 'an unknown item';
      const state = entry.checkedAt === null ? 'to buy' : 'ticked off';
      lines.push(`  ${entryAlias} ${item} × ${entry.quantity}, ${state}`);
    }
  }
  if (aliases.lists.size === 0) lines.push('(none)');

  return { text: lines.join('\n'), aliases };
}

function describeUnit(unit: SubItem): string {
  const parts = [unit.openedAt === null ? 'sealed' : `opened ${unit.openedAt}`];
  if (unit.expiresAt !== null) parts.push(`printed date ${unit.expiresAt}`);
  if (unit.periodAfterOpeningDays !== null) {
    parts.push(`keeps ${unit.periodAfterOpeningDays} days once opened`);
  }
  if (unit.effectiveExpiresAt !== null && unit.effectiveExpiresAt !== unit.expiresAt) {
    parts.push(`expires ${unit.effectiveExpiresAt}`);
  }
  if (unit.fillPercent < FULL_FILL_PERCENT) parts.push(`${unit.fillPercent}% left`);
  return parts.join(', ');
}
