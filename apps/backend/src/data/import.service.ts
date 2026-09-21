import { ConflictException, Injectable } from '@nestjs/common';
import {
  CategoriesRepository,
  DefaultLocationsRepository,
  HouseholdsRepository,
  ItemEventsRepository,
  ItemsRepository,
  LocationsRepository,
  Transactional,
  UnitsRepository,
  type CategoryRow,
  type CreateItemFieldsInput,
  type ItemRow,
  type LocationRow,
  type NewUnitInput,
  type RecordEventInput,
} from '@pantry-pal/db';
import {
  COUNT_UNIT,
  DEFAULT_CATEGORY,
  ITEM_EVENT_TYPE,
  ITEM_STATUS,
  MAX_ITEM_QUANTITY,
  MAX_LOCATIONS_PER_HOUSEHOLD,
  pickTranslation,
  QUANTITY_UNIT_KIND,
  type ImportSource,
  type ImportSummary,
  type UnitKind,
} from '@pantry-pal/shared';

import type { Membership } from '../common/request-context';
import { toPantryItem } from '../items/item.mapper';
import { toPantryLocation } from '../locations/location.mapper';
import { ChangeFeed } from '../realtime/change-feed';
import {
  nameKey,
  type ImportPlan,
  type PlannedItem,
  type PlannedSpace,
  type PlannedUnit,
} from './import-plan';

/** A default storage space and every name it goes by: English, and each translation. */
interface DefaultSpace {
  name: string;
  icon: string | null;
  isFallback: boolean;
  translations: Record<string, string>;
  names: string[];
}

/**
 * The household's items the import touched, by id and by what happened to
 * them. Items, not rows: two rows of one file can land in one item.
 */
interface ItemOutcomes {
  created: Set<string>;
  updated: Set<string>;
  restored: Set<string>;
  unchanged: Set<string>;
}

/** What one import's writes need to hand, gathered once before the first of them. */
interface ImportContext {
  membership: Membership;
  source: ImportSource;
  summary: ImportSummary;
  outcomes: ItemOutcomes;
  events: RecordEventInput[];
  categories: ReadonlyMap<string, CategoryRow>;
  unitKinds: ReadonlyMap<string, UnitKind>;
  /** The day of the import, which a unit that is partly used but has no opened date takes. */
  today: string;
}

/** An item on a shelf by the name it goes by there. */
const shelfKey = (locationId: string, name: string): string =>
  `${locationId}\u0000${nameKey(name)}`;

/**
 * Writes an import into a household: its storage spaces, items and units join
 * what the household has, and nothing is replaced. One transaction, so a file
 * lands whole or not at all.
 *
 * - **Storage spaces** match the household's own by id (a backup of this
 *   household), then by name, then by any name of the default storage space it
 *   was copied from: KitchenPal's "Fridge" finds "Холодильник". Anything else
 *   is created — named as the file has it, or in the member's language for a
 *   default the household deleted — until the household holds
 *   `MAX_LOCATIONS_PER_HOUSEHOLD`, after which the fallback takes the rest.
 * - **Items** match the household's own by id, a deleted one coming back;
 *   else an active item of the same name in the same space takes the file's
 *   units; else a new item is created.
 * - **Units** keep their own dates and fill: `ItemsRepository.addUnits` and
 *   `createWithUnits` write them as they are. A unit whose id the household
 *   holds already is left out, so importing a backup into the household it came
 *   from a second time adds nothing.
 *
 * Every write is announced as the item and location changes clients already
 * follow, and recorded in the items' history like any other.
 */
@Injectable()
export class ImportService {
  constructor(
    private readonly households: HouseholdsRepository,
    private readonly locations: LocationsRepository,
    private readonly defaults: DefaultLocationsRepository,
    private readonly items: ItemsRepository,
    private readonly events: ItemEventsRepository,
    private readonly categories: CategoriesRepository,
    private readonly units: UnitsRepository,
    private readonly changes: ChangeFeed,
  ) {}

  /** `locale` names what the import creates in the member's language: a deleted default space. */
  @Transactional()
  async apply(
    membership: Membership,
    locale: string,
    source: ImportSource,
    plan: ImportPlan,
  ): Promise<ImportSummary> {
    const { householdId } = membership;

    // Creating spaces counts them and appends after the last, which the
    // locations service does under this same lock.
    await this.households.lock(householdId);

    const summary: ImportSummary = {
      source,
      createdItems: 0,
      updatedItems: 0,
      restoredItems: 0,
      unchangedItems: 0,
      addedUnits: 0,
      createdLocations: [],
      capped: [],
      skipped: [...plan.skipped],
    };
    const outcomes: ItemOutcomes = {
      created: new Set(),
      updated: new Set(),
      restored: new Set(),
      unchanged: new Set(),
    };
    const context: ImportContext = {
      membership,
      source,
      summary,
      outcomes,
      events: [],
      categories: await this.lockCategories(plan.items),
      unitKinds: new Map((await this.units.list()).map((unit) => [unit.code, unit.kind])),
      today: new Date().toISOString().slice(0, 10),
    };

    const spaces = await this.resolveSpaces(householdId, locale, plan.spaces, summary);
    await this.writeItems(context, plan.items, spaces);
    await this.events.recordMany(context.events);

    summary.createdItems = outcomes.created.size;
    summary.updatedItems = outcomes.updated.size;
    summary.restoredItems = outcomes.restored.size;
    // A row can add nothing to an item that another row of the file created,
    // restored or added to: that item is counted as that.
    summary.unchangedItems = [...outcomes.unchanged].filter(
      (id) => !outcomes.created.has(id) && !outcomes.restored.has(id) && !outcomes.updated.has(id),
    ).length;
    return summary;
  }

  /**
   * Every category, with the ones the file uses share-locked, as each item
   * write locks its own: an admin changing a category's `isEdible` waits for
   * this import. In code order, so two imports cannot deadlock on them.
   */
  private async lockCategories(items: readonly PlannedItem[]): Promise<Map<string, CategoryRow>> {
    const all = new Map((await this.categories.list()).map((row) => [row.code, row]));
    const used = new Set(
      items.map((item) => (all.has(item.category) ? item.category : DEFAULT_CATEGORY)),
    );

    const locked = new Map<string, CategoryRow>();
    for (const code of [...used].toSorted()) {
      // One at a time, in order: that order is what keeps two imports from deadlocking.
      // oxlint-disable-next-line no-await-in-loop
      const row = await this.categories.lock(code, 'share');
      if (row !== undefined) locked.set(code, row);
    }
    return locked;
  }

  /** The household's location for each of the file's storage spaces, by the plan's key. */
  private async resolveSpaces(
    householdId: string,
    locale: string,
    planned: readonly PlannedSpace[],
    summary: ImportSummary,
  ): Promise<Map<string, LocationRow>> {
    const live = await this.locations.list(householdId);
    const defaults = await this.defaultSpaces();
    const fallback = live.find((location) => location.isFallback);

    const byId = new Map(live.map((location) => [location.id, location]));
    const byName = new Map<string, LocationRow>();
    for (const location of live) {
      if (!byName.has(nameKey(location.name))) byName.set(nameKey(location.name), location);
    }
    const defaultByName = new Map<string, DefaultSpace>();
    for (const space of defaults) {
      for (const name of space.names) {
        if (!defaultByName.has(nameKey(name))) defaultByName.set(nameKey(name), space);
      }
    }

    let count = live.length;
    let sortOrder = await this.locations.nextSortOrder(householdId);
    const resolved = new Map<string, LocationRow>();

    for (const space of planned) {
      const known =
        (space.id === null ? undefined : byId.get(space.id)) ??
        (space.isFallback ? fallback : undefined) ??
        byName.get(nameKey(space.name));
      if (known !== undefined) {
        resolved.set(space.key, known);
        continue;
      }

      const origin = defaultByName.get(nameKey(space.name));
      const copy =
        origin?.isFallback === true
          ? fallback
          : origin?.names.map((name) => byName.get(nameKey(name))).find((row) => row !== undefined);
      if (copy !== undefined) {
        resolved.set(space.key, copy);
        continue;
      }

      if (count >= MAX_LOCATIONS_PER_HOUSEHOLD) {
        if (fallback === undefined) {
          throw new ConflictException(
            `A household can have at most ${MAX_LOCATIONS_PER_HOUSEHOLD} storage spaces, and this ` +
              'one has no fallback to put the rest in.',
          );
        }
        resolved.set(space.key, fallback);
        continue;
      }

      const name =
        origin === undefined
          ? space.name
          : pickTranslation(origin.translations, locale, origin.name);
      // One at a time: each takes the next position.
      // oxlint-disable-next-line no-await-in-loop
      const created = await this.locations.create(householdId, {
        name,
        icon: space.icon ?? origin?.icon ?? null,
        sortOrder,
      });
      count += 1;
      sortOrder += 1;
      byId.set(created.id, created);
      byName.set(nameKey(created.name), created);
      resolved.set(space.key, created);
      summary.createdLocations.push(created.name);
      this.changes.publish({ type: 'location.created', location: toPantryLocation(created) });
    }

    return resolved;
  }

  private async defaultSpaces(): Promise<DefaultSpace[]> {
    const rows = await this.defaults.list();
    const translations = await this.defaults.listTranslations();

    return rows.map((row) => {
      const own = Object.fromEntries(
        translations
          .filter((translation) => translation.code === row.code)
          .map((translation) => [translation.locale, translation.name]),
      );
      return {
        name: row.name,
        icon: row.icon,
        isFallback: row.isFallback,
        translations: own,
        names: [row.name, ...Object.values(own)],
      };
    });
  }

  private async writeItems(
    context: ImportContext,
    planned: readonly PlannedItem[],
    spaces: ReadonlyMap<string, LocationRow>,
  ): Promise<void> {
    const { householdId } = context.membership;

    // Every live item, whatever its status: a backup of this household matches them by id.
    const live = await this.items.list(householdId);
    const byId = new Map(live.map((row) => [row.id, row]));
    const onShelf = new Map<string, ItemRow>();
    for (const row of live) {
      const key = shelfKey(row.locationId, row.name);
      if (row.status === ITEM_STATUS.Active && !onShelf.has(key)) onShelf.set(key, row);
    }

    const unknownIds = planned.flatMap((item) =>
      item.id === null || byId.has(item.id) ? [] : [item.id],
    );
    const deleted = new Map(
      (await this.items.findAnyByIds(householdId, unknownIds))
        .filter((row) => row.deletedAt !== null)
        .map((row) => [row.id, row]),
    );
    const heldUnits = await this.items.findUnitIds(
      householdId,
      planned.flatMap((item) => item.units.flatMap((unit) => (unit.id === null ? [] : [unit.id]))),
    );

    for (const item of planned) {
      const location = spaces.get(item.spaceKey);
      if (location === undefined) throw new Error(`No location resolved for "${item.spaceKey}"`);

      const units = item.units
        .filter((unit) => unit.id === null || !heldUnits.has(unit.id))
        .map((unit) => unitInput(unit, context.today));
      const gone = item.id === null ? undefined : deleted.get(item.id);
      const target =
        (item.id === null ? undefined : byId.get(item.id)) ??
        onShelf.get(shelfKey(location.id, item.name));

      // In order, as the file lists them: a later row can add to an item an earlier one created.
      /* oxlint-disable no-await-in-loop */
      let written: ItemRow | undefined;
      if (gone !== undefined) {
        written = await this.restore(context, item, gone.id, location.id, units);
      } else if (target !== undefined) {
        written = await this.addTo(context, item, target.id, units);
        if (written === undefined) context.outcomes.unchanged.add(target.id);
      } else {
        written = await this.create(context, item, location.id, units);
      }
      /* oxlint-enable no-await-in-loop */

      if (written !== undefined) {
        byId.set(written.id, written);
        if (written.status === ITEM_STATUS.Active) {
          onShelf.set(shelfKey(written.locationId, written.name), written);
        }
      }
    }
  }

  private async create(
    context: ImportContext,
    item: PlannedItem,
    locationId: string,
    units: readonly NewUnitInput[],
  ): Promise<ItemRow> {
    const { householdId, userId } = context.membership;
    const fields = this.fieldsOf(context, item, locationId);

    // An item with none on the shelf still comes across, at zero, as it was.
    const row =
      units.length > 0
        ? await this.items.createWithUnits(householdId, fields, units)
        : await this.items.create(householdId, { ...fields, quantity: 0 });

    this.noteCapped(context, item, 0);
    context.outcomes.created.add(row.id);
    context.summary.addedUnits += row.quantity;
    context.events.push({
      householdId,
      itemId: row.id,
      userId,
      type: ITEM_EVENT_TYPE.Added,
      quantityDelta: row.quantity === 0 ? null : row.quantity,
      payload: { source: context.source },
    });
    this.changes.publish({ type: 'item.created', item: toPantryItem(row) });
    return row;
  }

  /**
   * Adds the file's units to an item the household has, up to the quantity
   * limit. `undefined` when nothing was added: it holds them all already, or
   * has no room for more.
   */
  private async addTo(
    context: ImportContext,
    item: PlannedItem,
    itemId: string,
    units: readonly NewUnitInput[],
  ): Promise<ItemRow | undefined> {
    const { householdId, userId } = context.membership;
    if (units.length === 0) {
      this.noteCapped(context, item, 0);
      return undefined;
    }

    // Locked and read again: an earlier row of this file may have added to it.
    const before = await this.items.lock(householdId, itemId);
    if (before === undefined) throw new Error(`Item ${itemId} vanished during the import`);

    const kept = units.slice(0, Math.max(0, MAX_ITEM_QUANTITY - before.quantity));
    this.noteCapped(context, item, units.length - kept.length);
    if (kept.length === 0) return undefined;

    const after = await this.items.addUnits(householdId, itemId, kept);
    if (after === undefined) throw new Error(`Item ${itemId} vanished during the import`);

    // An item this import created or brought back is counted as that already.
    const { created, restored, updated } = context.outcomes;
    if (!created.has(itemId) && !restored.has(itemId)) updated.add(itemId);
    context.summary.addedUnits += kept.length;
    context.events.push({
      householdId,
      itemId,
      userId,
      type: ITEM_EVENT_TYPE.Updated,
      quantityDelta: kept.length,
      payload: {
        source: context.source,
        changes: { quantity: { from: before.quantity, to: after.quantity } },
      },
    });
    this.changes.publish({ type: 'item.updated', item: toPantryItem(after) });
    return after;
  }

  /**
   * Brings back an item of this household deleted since the backup, on the
   * file's shelf, with the units it had and any of the file's it lacks.
   */
  private async restore(
    context: ImportContext,
    item: PlannedItem,
    itemId: string,
    locationId: string,
    units: readonly NewUnitInput[],
  ): Promise<ItemRow> {
    const { householdId, userId } = context.membership;

    const back = await this.items.undelete(householdId, itemId, {
      locationId,
      status: ITEM_STATUS.Active,
    });
    if (back === undefined) throw new Error(`Item ${itemId} is no longer deleted`);

    const kept = units.slice(0, Math.max(0, MAX_ITEM_QUANTITY - back.quantity));
    this.noteCapped(context, item, units.length - kept.length);
    const after = kept.length === 0 ? back : await this.items.addUnits(householdId, itemId, kept);
    if (after === undefined) throw new Error(`Item ${itemId} vanished during the import`);

    context.outcomes.restored.add(itemId);
    context.summary.addedUnits += kept.length;
    context.events.push({
      householdId,
      itemId,
      userId,
      type: ITEM_EVENT_TYPE.Restored,
      quantityDelta: after.quantity === 0 ? null : after.quantity,
      payload: { source: context.source, undeleted: true },
    });
    this.changes.publish({ type: 'item.updated', item: toPantryItem(after) });
    return after;
  }

  /**
   * A new item's fields, from what the server has: an unknown category is the
   * default one, an unknown or non-count unit is `pcs`, and a size in an
   * unknown unit is left out. `isEdible` follows the category, except in the
   * default one, where the file may say.
   */
  private fieldsOf(
    context: ImportContext,
    item: PlannedItem,
    locationId: string,
  ): CreateItemFieldsInput {
    const category =
      context.categories.get(item.category) ?? context.categories.get(DEFAULT_CATEGORY);
    if (category === undefined) throw new Error(`The "${DEFAULT_CATEGORY}" category is missing`);

    const sized =
      item.sizeValue !== null && item.sizeUnit !== null && context.unitKinds.has(item.sizeUnit);
    return {
      name: item.name,
      locationId,
      category: category.code,
      isEdible:
        category.code === DEFAULT_CATEGORY
          ? (item.isEdible ?? category.isEdible)
          : category.isEdible,
      unit: context.unitKinds.get(item.unit) === QUANTITY_UNIT_KIND ? item.unit : COUNT_UNIT,
      sizeValue: sized ? item.sizeValue : null,
      sizeUnit: sized ? item.sizeUnit : null,
      notes: item.notes,
    };
  }

  /** Units that did not fit: the parser's, which it left out, and those past the limit here. */
  private noteCapped(context: ImportContext, item: PlannedItem, overLimit: number): void {
    const units = item.excessUnits + overLimit;
    if (units === 0) return;

    // Once per name: two rows of one file that land in one item are one line.
    const known = context.summary.capped.find((entry) => entry.name === item.name);
    if (known === undefined) context.summary.capped.push({ name: item.name, units });
    else known.units += units;
  }
}

/** A partly used unit was opened; one without the date takes the day of the import. */
function unitInput(unit: PlannedUnit, today: string): NewUnitInput {
  return {
    expiresAt: unit.expiresAt,
    openedAt: unit.openedAt ?? (unit.fillPercent < 100 ? today : null),
    periodAfterOpeningDays: unit.periodAfterOpeningDays,
    fillPercent: unit.fillPercent,
  };
}
