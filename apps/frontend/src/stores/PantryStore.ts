import {
  createId,
  DEFAULT_CATEGORY,
  DEFAULT_SHOPPING_ENTRY_QUANTITY,
  effectiveExpiry,
  ITEM_STATUS,
  MAX_SHOPPING_LISTS_PER_HOUSEHOLD,
  PANTRY_EVENT,
  QUANTITY_UNIT_KIND,
  type Category,
  type CurrentUser,
  type HouseholdDeletedPayload,
  type HouseholdMemberRemovedPayload,
  type HouseholdPayload,
  type PantryItem,
  type PantryLocation,
  type ShoppingList,
  type ShoppingListEntry,
  type SupportedLocale,
  type Unit,
  type UserHousehold,
} from '@pantry-pal/shared';
import type {
  ChangePasswordDto,
  CreatePantryItemDto,
  UpdateMeDto,
  UpdatePantryItemDto,
  UpdateShoppingListEntryDto,
  UpsertLocationsDto,
  UpsertShoppingListsDto,
} from '@pantry-pal/shared/dto';
import { makeAutoObservable, observableRef, when } from 'mobx';
import { Subject, type Subscription } from 'rxjs';

import { nameCollator } from '../i18n/format';
import { switchLocale } from '../i18n/locale';
import { messages } from '../i18n/messages';
import type { Mirror, MirrorRefusal, MirrorTransport } from '../offline/mirror';
import { ApiError, type PantryApi } from '../services/api';
import { backendOrigin } from '../services/backendOrigin';
import type { PantrySocket } from '../services/socket';
import type { NoticeStore } from './NoticeStore';
import { reconcileById } from './reconcile';

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';
export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

/** A write that answers with something: what it made, or the message to show. */
export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NO_ITEMS: readonly PantryItem[] = [];
const NO_ENTRIES: readonly ShoppingListEntry[] = [];

/** How long an online write that reads local changes waits for them to reach the server. */
const PUSH_WAIT_MS = 5_000;

/**
 * How long a local write waits to show. The mirror's queries emit a moment after
 * a write lands; one superseded meanwhile, by a pull say, never shows as written.
 */
const SHOW_WAIT_MS = 1_000;

/**
 * Broadcasts that mean the household's data changed on the server. Each only
 * asks the mirror to pull: the pull brings the change, in order with the rest.
 */
const DATA_EVENTS = [
  PANTRY_EVENT.ItemCreated,
  PANTRY_EVENT.ItemUpdated,
  PANTRY_EVENT.ItemDeleted,
  PANTRY_EVENT.LocationCreated,
  PANTRY_EVENT.LocationUpdated,
  PANTRY_EVENT.LocationDeleted,
  PANTRY_EVENT.LocationsReordered,
  PANTRY_EVENT.LocationsUpserted,
  PANTRY_EVENT.ShoppingListCreated,
  PANTRY_EVENT.ShoppingListUpdated,
  PANTRY_EVENT.ShoppingListDeleted,
  PANTRY_EVENT.ShoppingListsUpserted,
  PANTRY_EVENT.ShoppingListEntriesUpserted,
  PANTRY_EVENT.ShoppingListEntriesDeleted,
] as const;

/**
 * The message for a failed request. `fetch` rejects with a `TypeError` when no
 * response arrives at all — offline, or the server down — and a proxy in front
 * of a server that is down or restarting answers 502 to 504 for it.
 */
function toMessage(error: unknown): string {
  if (error instanceof TypeError) return messages.errors.unreachable;
  if (error instanceof ApiError && error.status >= 502 && error.status <= 504) {
    return messages.errors.unreachable;
  }
  return error instanceof Error ? error.message : messages.errors.loadFailed;
}

const isActive = (item: PantryItem): boolean => item.status === ITEM_STATUS.Active;

/** On the shelf with some left. Running out is leaving this state. */
const inStock = (item: PantryItem): boolean => isActive(item) && item.quantity > 0;

const bySortOrder = (
  a: Pick<PantryLocation, 'sortOrder' | 'name'>,
  b: Pick<PantryLocation, 'sortOrder' | 'name'>,
): number => a.sortOrder - b.sortOrder || nameCollator.compare(a.name, b.name);

/** The order entries were put on their lists. Instants share one format, so they compare as strings. */
const byArrival = (a: ShoppingListEntry, b: ShoppingListEntry): number =>
  a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : a.id < b.id ? -1 : 1;

/** The fields a patch sets: `undefined` means untouched, while `null` clears a field. */
function definedFields<T extends object>(patch: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(patch).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * One household's pantry, as this device holds it: an offline mirror (RxDB, in
 * IndexedDB) that replicates with the server whenever it can be reached.
 *
 * **The UI reads only the mirror.** Its collections flow into the observable
 * fields here, so a change shows the same way whoever made it: this tab, another
 * tab, or another member through the server.
 *
 * **Everyday writes are local first**: adding, editing, using up, moving and
 * deleting items, and everything done to a shopping list's entries. They land in
 * the mirror at once, offline too, and replication pushes them; the server
 * applies each through its own rules, and a change it refuses comes back as a
 * notice. The editors of storage spaces and shopping lists, "Bought", and the
 * account's settings stay online-only REST writes.
 *
 * `items`, `locations`, `units` and `categories` are replaced rather than
 * mutated, and hold plain objects (`observableRef`). An entity that did not
 * change keeps its object identity (`reconcileById`), so a memoised card skips
 * re-rendering.
 *
 * Shopping lists name items rather than copying them, so an entry shows the item
 * it names: an active one from `items`, and one used up or thrown out — off the
 * shelf, so not in `items` — from `offShelfItems`, which holds exactly those
 * that some entry names.
 */
export class PantryStore {
  private readonly api: PantryApi;
  private readonly socket: PantrySocket;
  private readonly notices: NoticeStore;

  user: CurrentUser | null = null;
  /** Set once the mirror holds the household, which is what the pages wait for. */
  household: UserHousehold | null = null;
  items: readonly PantryItem[] = NO_ITEMS;
  locations: readonly PantryLocation[] = [];
  units: readonly Unit[] = [];
  categories: readonly Category[] = [];
  shoppingLists: readonly ShoppingList[] = [];
  shoppingEntries: readonly ShoppingListEntry[] = NO_ENTRIES;
  /** Items that are not active but are on a shopping list: never in `items` at the same time. */
  offShelfItems: readonly PantryItem[] = NO_ITEMS;
  connection: ConnectionState = 'idle';
  loadState: LoadState = 'idle';
  error: string | null = null;

  /* Mirror bookkeeping, deliberately not observable. */
  private mirror: Mirror | null = null;
  /** Whose household the open mirror holds: `userId/householdId`. */
  private mirrorKey: string | null = null;
  private mirrorSubscriptions: Subscription[] = [];
  /** Every item the mirror holds, of any status: `items` and `offShelfItems` come from these. */
  private allItems: readonly PantryItem[] = NO_ITEMS;
  /** Whether the open mirror holds the whole household. */
  private synced = false;
  /** The household the bootstrap found, shown once the mirror has it. */
  private loadedHousehold: UserHousehold | null = null;
  /** Nudges the mirror to pull: a broadcast arrived, or the socket reconnected. */
  private readonly changes = new Subject<void>();
  /** The last sync request that failed, as it failed: RxDB reports it wrapped. */
  private lastSyncError: unknown = null;

  /** The bootstrap running now, which a second `load()` joins instead of repeating. */
  private loadInFlight: Promise<void> | null = null;
  /** Between `connect()` and `dispose()`: a mirror opening after that is closed again at once. */
  private active = false;

  constructor(api: PantryApi, socket: PantrySocket, notices: NoticeStore) {
    this.api = api;
    this.socket = socket;
    this.notices = notices;

    // Collaborators and bookkeeping are excluded: MobX must not try to make the
    // socket, the mirror or RxJS objects deeply observable.
    makeAutoObservable<
      PantryStore,
      | 'api'
      | 'socket'
      | 'notices'
      | 'mirror'
      | 'mirrorKey'
      | 'mirrorSubscriptions'
      | 'allItems'
      | 'synced'
      | 'loadedHousehold'
      | 'changes'
      | 'lastSyncError'
      | 'loadInFlight'
      | 'active'
    >(
      this,
      {
        api: false,
        socket: false,
        notices: false,
        mirror: false,
        mirrorKey: false,
        mirrorSubscriptions: false,
        synced: false,
        loadedHousehold: false,
        changes: false,
        lastSyncError: false,
        loadInFlight: false,
        active: false,
        user: observableRef,
        household: observableRef,
        items: observableRef,
        locations: observableRef,
        units: observableRef,
        categories: observableRef,
        shoppingLists: observableRef,
        shoppingEntries: observableRef,
        offShelfItems: observableRef,
        allItems: observableRef,
      },
      { autoBind: true },
    );
  }

  /* ---------------------------------------------------------------- derived */

  get householdId(): string | null {
    return this.household?.id ?? null;
  }

  get isOnline(): boolean {
    return this.connection === 'online';
  }

  get unitsByCode(): ReadonlyMap<string, Unit> {
    return new Map(this.units.map((unit) => [unit.code, unit]));
  }

  /** `fl_oz_us` renders as `fl oz`; an unknown code renders as itself. */
  unitLabel(code: string): string {
    return this.unitsByCode.get(code)?.label ?? code;
  }

  /**
   * A unit as it reads after `count`. A count unit is a noun that agrees with it,
   * `2 cans`; any other unit is its symbol in the page's language, `12 fl oz`.
   */
  unitName(code: string, count: number): string {
    const unit = this.unitsByCode.get(code);
    if (unit === undefined) return code;
    return unit.kind === QUANTITY_UNIT_KIND
      ? messages.units.countNoun(code, count, unit.label)
      : messages.units.symbol(code, unit.label);
  }

  get categoriesByCode(): ReadonlyMap<string, Category> {
    return new Map(this.categories.map((category) => [category.code, category]));
  }

  /** The catalog's name for a seeded code, else the API's label, else the code itself. */
  categoryName(code: string): string {
    return messages.categories.name(code, this.categoriesByCode.get(code)?.label ?? code);
  }

  /** Whether the category's items are food or drink; assumed so until categories load. */
  categoryEdible(code: string): boolean {
    return this.categoriesByCode.get(code)?.isEdible ?? true;
  }

  get itemsByLocation(): ReadonlyMap<string, readonly PantryItem[]> {
    const groups = new Map<string, PantryItem[]>();
    for (const item of this.items) {
      const group = groups.get(item.locationId);
      if (group === undefined) groups.set(item.locationId, [item]);
      else group.push(item);
    }
    return groups;
  }

  itemsIn(locationId: string): readonly PantryItem[] {
    return this.itemsByLocation.get(locationId) ?? NO_ITEMS;
  }

  /** Every item held: the active ones, and those off the shelf that a shopping list names. */
  get itemsById(): ReadonlyMap<string, PantryItem> {
    return new Map([...this.offShelfItems, ...this.items].map((item) => [item.id, item]));
  }

  get shoppingListsById(): ReadonlyMap<string, ShoppingList> {
    return new Map(this.shoppingLists.map((list) => [list.id, list]));
  }

  /**
   * The lists in use, in display order. Archived ones are frozen, so only the
   * shopping lists editor shows them; everywhere else offers these.
   */
  get activeShoppingLists(): readonly ShoppingList[] {
    return this.shoppingLists.filter((list) => list.archivedAt === null);
  }

  /** Each list's entries, in the order they were put on it. */
  get entriesByList(): ReadonlyMap<string, readonly ShoppingListEntry[]> {
    const groups = new Map<string, ShoppingListEntry[]>();
    for (const entry of this.shoppingEntries) {
      const group = groups.get(entry.listId);
      if (group === undefined) groups.set(entry.listId, [entry]);
      else group.push(entry);
    }
    return groups;
  }

  entriesOn(listId: string): readonly ShoppingListEntry[] {
    return this.entriesByList.get(listId) ?? NO_ENTRIES;
  }

  /** The items on at least one shopping list. */
  get listedItemIds(): ReadonlySet<string> {
    return new Set(this.shoppingEntries.map((entry) => entry.itemId));
  }

  /** The lists an item is on, in display order. */
  listsHolding(itemId: string): readonly ShoppingList[] {
    const listIds = new Set(
      this.shoppingEntries.filter((entry) => entry.itemId === itemId).map((entry) => entry.listId),
    );
    return this.shoppingLists.filter((list) => listIds.has(list.id));
  }

  /** Each item's `updatedAt`, whatever its status: how a local write is seen to show. */
  private get itemVersions(): ReadonlyMap<string, string> {
    return new Map(this.allItems.map((item) => [item.id, item.updatedAt]));
  }

  private get entryVersions(): ReadonlyMap<string, string> {
    return new Map(this.shoppingEntries.map((entry) => [entry.id, entry.updatedAt]));
  }

  /* -------------------------------------------------------------- lifecycle */

  connect(): void {
    this.active = true;
    this.connection = 'connecting';

    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('connect_error', this.handleConnectError);
    for (const event of DATA_EVENTS) this.socket.on(event, this.handleDataChanged);
    this.socket.on(PANTRY_EVENT.HouseholdUpdated, this.handleHouseholdUpdated);
    this.socket.on(PANTRY_EVENT.HouseholdDeleted, this.handleHouseholdDeleted);
    this.socket.on(PANTRY_EVENT.MemberRemoved, this.handleMemberRemoved);

    this.socket.connect();
  }

  dispose(): void {
    this.active = false;

    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('connect_error', this.handleConnectError);
    for (const event of DATA_EVENTS) this.socket.off(event, this.handleDataChanged);
    this.socket.off(PANTRY_EVENT.HouseholdUpdated, this.handleHouseholdUpdated);
    this.socket.off(PANTRY_EVENT.HouseholdDeleted, this.handleHouseholdDeleted);
    this.socket.off(PANTRY_EVENT.MemberRemoved, this.handleMemberRemoved);
    this.socket.disconnect();

    void this.detachMirror()?.close();
  }

  /* ------------------------------------------------------------------ reads */

  /**
   * The bootstrap: the user, their first household (created if they have none)
   * and the units over REST, which the service worker answers from its cache
   * when offline; then the household's mirror. The pages wait until the mirror
   * holds the household: at once when an earlier session synced it, else after
   * a first pull, which needs the server.
   *
   * A call while one runs joins it. StrictMode's development remount calls this
   * twice at once, and two runs for a new account would each create a household.
   */
  load(): Promise<void> {
    this.loadInFlight ??= this.runLoad().finally(() => {
      this.loadInFlight = null;
    });
    return this.loadInFlight;
  }

  private async runLoad(): Promise<void> {
    this.startLoad();
    void this.refreshCategories();

    try {
      const [user, households, units] = await Promise.all([
        this.api.me(),
        this.api.listHouseholds(),
        this.api.listUnits(),
      ]);
      const household =
        households[0] ?? (await this.api.createHousehold({ name: messages.household.defaultName }));

      await this.openMirror(user.id, household.id);
      this.applyBootstrap(user, household, units);
      // The account's language outranks this browser's copy of it — on a new
      // device, say. When they differ, the page reloads in the account's.
      switchLocale(user.locale);
    } catch (error) {
      this.failLoad(toMessage(error));
    }
  }

  /**
   * Categories load beside the bootstrap rather than inside it. Names and the
   * picker degrade without them — to the catalog's names and the item's own
   * category — so a failure, such as a backend that predates `GET /categories`,
   * leaves the page working.
   */
  async refreshCategories(): Promise<void> {
    try {
      this.applyCategories(await this.api.listCategories());
    } catch {
      // Keep whatever loaded before; see above.
    }
  }

  /** Pulls whatever the server has that the mirror does not, in the background. */
  async refresh(): Promise<void> {
    this.mirror?.reSync();
    await this.refreshCategories();
  }

  /* ----------------------------------------------------------------- writes */

  /**
   * Adds an item on this device, under an id made here; the server gets it once
   * it can be reached. Returns the message to show, or `null`.
   */
  async addItem(dto: CreatePantryItemDto): Promise<string | null> {
    const mirror = this.mirror;
    const householdId = this.householdId;
    if (mirror === null || householdId === null) return messages.errors.loadFailed;

    const id = createId();
    const now = new Date().toISOString();
    const fields = {
      expiresAt: dto.expiresAt ?? null,
      openedAt: dto.openedAt ?? null,
      periodAfterOpeningDays: dto.periodAfterOpeningDays ?? null,
    };
    try {
      await mirror.insertItem({
        id,
        householdId,
        locationId: dto.locationId,
        productId: null,
        name: dto.name,
        category: dto.category,
        isEdible: this.edibleFor(dto.category, dto.isEdible),
        quantity: dto.quantity,
        unit: dto.unit,
        sizeValue: dto.sizeValue ?? null,
        sizeUnit: dto.sizeUnit ?? null,
        ...fields,
        effectiveExpiresAt: effectiveExpiry(fields),
        notes: dto.notes ?? null,
        status: ITEM_STATUS.Active,
        defaultShoppingListId: dto.defaultShoppingListId ?? null,
        createdAt: now,
        updatedAt: now,
      });
      await this.shown(() => this.itemVersions.has(id));
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  /**
   * Changes an item on this device; the server gets the change once it can be
   * reached. An item that runs out goes on its default shopping list, as the
   * server would put it. Returns the message to show, or `null`: callers inside
   * a modal dialog show it there, where a notice would be hidden behind it.
   */
  async updateItem(id: string, dto: UpdatePantryItemDto): Promise<string | null> {
    const mirror = this.mirror;
    if (mirror === null) return messages.errors.loadFailed;

    try {
      const change = await mirror.patchItem(id, (item) => this.itemPatch(item, dto));
      if (change === undefined) return messages.errors.itemGone;
      const entryId =
        inStock(change.before) && !inStock(change.after)
          ? await this.putOnDefaultList(mirror, change.after)
          : undefined;
      await this.shown(
        () =>
          this.itemVersions.get(id) === change.after.updatedAt &&
          (entryId === undefined || this.entryVersions.has(entryId)),
      );
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  /** Deletes items on this device, taking them off every list, as the server does. */
  async deleteItems(ids: readonly string[]): Promise<void> {
    const mirror = this.mirror;
    if (mirror === null || ids.length === 0) return;

    try {
      await mirror.removeItems(ids);
      const entries = await mirror.entriesNaming(ids);
      await mirror.removeEntries(entries.map((entry) => entry.id));
      await this.shown(() => ids.every((id) => !this.itemVersions.has(id)));
    } catch {
      this.notices.error(messages.errors.deleteFailed(ids.length));
    }
  }

  async moveItems(ids: readonly string[], locationId: string): Promise<void> {
    const mirror = this.mirror;
    if (mirror === null || ids.length === 0) return;

    const updatedAt = new Date().toISOString();
    const results = await Promise.allSettled(
      ids.map((id) => mirror.patchItem(id, () => ({ locationId, updatedAt }))),
    );
    await this.shown(() => ids.every((id) => this.itemVersions.get(id) === updatedAt));
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed > 0) this.notices.error(messages.errors.moveFailed(failed));
  }

  /**
   * Saves the caller's details and the household's name, the name only when
   * given: owners rename, members cannot. Returns `null` once both are saved, or
   * the message to show; a change saved before a later one failed stays saved.
   */
  async saveDetails(changes: { me: UpdateMeDto; householdName?: string }): Promise<string | null> {
    const householdId = this.householdId;

    try {
      if (Object.keys(changes.me).length > 0) {
        this.applyUser(await this.api.updateMe(changes.me));
      }
      if (changes.householdName !== undefined && householdId !== null) {
        this.applyHousehold(
          await this.api.updateHousehold(householdId, { name: changes.householdName }),
        );
      }
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  /**
   * Saves the account's language, then reloads the page in it: the catalog is
   * fixed per page load. Returns the error message, or `null` — and then the
   * page is already on its way out.
   */
  async changeLocale(locale: SupportedLocale): Promise<string | null> {
    try {
      const user = await this.api.updateMe({ locale });
      this.applyUser(user);
      switchLocale(user.locale);
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  /**
   * Replaces the account's password. Returns `null` once changed, or the message
   * to show. The server ends the account's other sessions; this one stays.
   */
  async changePassword(dto: ChangePasswordDto): Promise<string | null> {
    try {
      await this.api.changePassword(dto);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 403)
        return messages.changePassword.incorrect;
      if (error instanceof ApiError && error.status === 429) return messages.auth.tooManyAttempts;
      return toMessage(error);
    }
  }

  /**
   * Saves the locations editor in one request, online: renames, additions,
   * deletions and order. Returns `null` once saved, or the message the editor
   * shows.
   *
   * A 409 means the list changed on the server while the user edited it. The
   * latest is fetched before this returns, the editor's draft rebases onto it,
   * and the user saves again.
   */
  async saveLocations(dto: UpsertLocationsDto): Promise<string | null> {
    const mirror = this.mirror;
    const householdId = this.householdId;
    if (mirror === null || householdId === null) return messages.errors.loadFailed;

    try {
      await mirror.acceptLocations(await this.api.upsertLocations(householdId, dto), true);
      // Items moved out of deleted locations: the pull brings them.
      mirror.reSync();
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.fetchLocations(mirror, householdId);
        return messages.locationEditor.changedElsewhere;
      }
      return toMessage(error);
    }
  }

  /** Creates a shopping list, online, appended after the others. */
  async createShoppingList(name: string): Promise<WriteResult<ShoppingList>> {
    const mirror = this.mirror;
    const householdId = this.householdId;
    if (mirror === null || householdId === null) {
      return { ok: false, error: messages.errors.loadFailed };
    }

    try {
      const list = await this.api.createShoppingList(householdId, { name });
      await mirror.acceptShoppingLists([list], false);
      return { ok: true, value: list };
    } catch (error) {
      return { ok: false, error: this.shoppingListError(error) };
    }
  }

  /**
   * Saves the shopping lists editor in one request, online: additions, renames,
   * archiving, deletions and order. Returns `null` once saved, or the message
   * the editor shows.
   *
   * A 409 means the lists changed on the server while the user edited them. The
   * latest are fetched before this returns, the editor's draft rebases onto
   * them, and the user saves again.
   */
  async saveShoppingLists(dto: UpsertShoppingListsDto): Promise<string | null> {
    const mirror = this.mirror;
    const householdId = this.householdId;
    if (mirror === null || householdId === null) return messages.errors.loadFailed;

    try {
      await mirror.acceptShoppingLists(await this.api.upsertShoppingLists(householdId, dto), true);
      // A deleted list's entries went with it, and its items lost it as their
      // default: the pull brings both.
      mirror.reSync();
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.fetchShoppingLists(mirror, householdId);
        return messages.shoppingListEditor.changedElsewhere;
      }
      return toMessage(error);
    }
  }

  /**
   * Puts items on a list, on this device; those already on it stay as they
   * are. Answers how many were added.
   */
  async addToShoppingList(
    listId: string,
    itemIds: readonly string[],
  ): Promise<WriteResult<number>> {
    const mirror = this.mirror;
    const householdId = this.householdId;
    if (mirror === null || householdId === null) {
      return { ok: false, error: messages.errors.loadFailed };
    }

    try {
      const onIt = new Set((await mirror.entriesOn(listId)).map((entry) => entry.itemId));
      const entries = [...new Set(itemIds)]
        .filter((itemId) => !onIt.has(itemId))
        .map((itemId) => newEntry(householdId, listId, itemId));
      await mirror.insertEntries(entries);
      await this.shown(() => entries.every((entry) => this.entryVersions.has(entry.id)));
      return { ok: true, value: entries.length };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  }

  /** How many to buy, or ticked off, on this device. Returns `null` once saved, or the message to show. */
  async updateShoppingEntry(
    entry: ShoppingListEntry,
    dto: UpdateShoppingListEntryDto,
  ): Promise<string | null> {
    const mirror = this.mirror;
    if (mirror === null) return messages.errors.loadFailed;

    const now = new Date().toISOString();
    try {
      const found = await mirror.patchEntry(entry.id, (current) => ({
        ...(dto.quantity === undefined ? {} : { quantity: dto.quantity }),
        ...(dto.checked === undefined
          ? {}
          : { checkedAt: dto.checked ? (current.checkedAt ?? now) : null }),
        updatedAt: now,
      }));
      // One taken off the list meanwhile is gone from the page too: nothing to say.
      if (found) await this.shown(() => this.entryVersions.get(entry.id) === now);
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  async removeShoppingEntry(entry: ShoppingListEntry): Promise<string | null> {
    const mirror = this.mirror;
    if (mirror === null) return messages.errors.loadFailed;

    try {
      await mirror.removeEntries([entry.id]);
      await this.shown(() => !this.entryVersions.has(entry.id));
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  /**
   * Puts ticked-off entries away, online: the server restocks their items and
   * takes the entries off the list, all or nothing. A 409 means the list changed
   * while it was shown; the latest is pulled before this returns, for the user
   * to check.
   *
   * The entries leave the mirror at once, so the list empties without waiting
   * for the pull; the pushes that follow find them gone already, and change
   * nothing.
   */
  async putAwayShopping(listId: string, entryIds: readonly string[]): Promise<string | null> {
    const mirror = this.mirror;
    const householdId = this.householdId;
    if (mirror === null || householdId === null) return messages.errors.loadFailed;

    try {
      // The server checks the ticks, and ticks made here may still be on their way.
      if (this.isOnline) await mirror.pushed(PUSH_WAIT_MS);
      await this.api.putAwayShoppingListEntries(householdId, listId, {
        entryIds: [...entryIds],
      });
      await mirror.removeEntries(entryIds);
      mirror.reSync();
      await this.shown(() => entryIds.every((id) => !this.entryVersions.has(id)));
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        mirror.reSync();
        return messages.shopping.changedElsewhere;
      }
      return toMessage(error);
    }
  }

  /* --------------------------------------------------------------- internal */

  /** What `dto` changes on `item`, with what the server would work out from it. */
  private itemPatch(item: PantryItem, dto: UpdatePantryItemDto): Partial<PantryItem> {
    const patch: Partial<PantryItem> = definedFields(dto);
    const next = { ...item, ...patch };

    if (dto.category !== undefined || dto.isEdible !== undefined) {
      patch.isEdible = this.edibleFor(next.category, dto.isEdible ?? item.isEdible);
    }
    if (
      dto.expiresAt !== undefined ||
      dto.openedAt !== undefined ||
      dto.periodAfterOpeningDays !== undefined
    ) {
      patch.effectiveExpiresAt = effectiveExpiry(next);
    }
    patch.updatedAt = new Date().toISOString();
    return patch;
  }

  /**
   * An item's `isEdible`: its category's, except in the default category, where
   * the item decides. The server resolves it the same way, so this is its value
   * as soon as categories have loaded.
   */
  private edibleFor(category: string, requested: boolean | undefined): boolean {
    if (category === DEFAULT_CATEGORY) return requested ?? this.categoryEdible(category);
    return this.categoryEdible(category);
  }

  /**
   * Puts an item that just ran out on its default list, unless it is on it
   * already or the list is archived — the server's rule, applied here so it
   * holds offline. The server leaves it to the entry pushed from here.
   */
  private async putOnDefaultList(mirror: Mirror, item: PantryItem): Promise<string | undefined> {
    const listId = item.defaultShoppingListId;
    if (listId === null) return undefined;

    const list = await mirror.shoppingList(listId);
    if (list === undefined || list.archivedAt !== null) return undefined;
    if ((await mirror.entriesOn(listId, item.id)).length > 0) return undefined;

    const entry = newEntry(item.householdId, listId, item.id);
    await mirror.insertEntries([entry]);
    return entry.id;
  }

  /** Resolves once `condition` holds, or after `SHOW_WAIT_MS`: a local write, seen by the pages. */
  private async shown(condition: () => boolean): Promise<void> {
    try {
      await when(condition, { timeout: SHOW_WAIT_MS });
    } catch {
      // Superseded meanwhile: what shows now is newer.
    }
  }

  /** The storage spaces as the server has them now, after the editor's save was refused. */
  private async fetchLocations(mirror: Mirror, householdId: string): Promise<void> {
    try {
      await mirror.acceptLocations(await this.api.listLocations(householdId), true);
    } catch {
      mirror.reSync();
    }
  }

  /** The shopping lists as the server has them now; see `fetchLocations`. */
  private async fetchShoppingLists(mirror: Mirror, householdId: string): Promise<void> {
    try {
      const { lists } = await this.api.listShoppingLists(householdId);
      await mirror.acceptShoppingLists(lists, true);
    } catch {
      // The pull below still brings them.
    }
    mirror.reSync();
  }

  /**
   * A 409 is a name another list has, or one list too many; the catalog says
   * either better than the server's English.
   */
  private shoppingListError(error: unknown): string {
    if (!(error instanceof ApiError) || error.status !== 409) return toMessage(error);
    return this.shoppingLists.length >= MAX_SHOPPING_LISTS_PER_HOUSEHOLD
      ? messages.shopping.limitReached(MAX_SHOPPING_LISTS_PER_HOUSEHOLD)
      : messages.shopping.nameTaken;
  }

  /**
   * Opens the household's mirror, unless it is open already. Another household
   * than before means the last one is gone for this user — deleted, or they
   * left it — so its mirror is deleted from the device.
   */
  private async openMirror(userId: string, householdId: string): Promise<void> {
    const key = `${userId}/${householdId}`;
    if (this.mirror !== null && this.mirrorKey === key) return;

    const previous = this.detachMirror();
    if (previous !== null) {
      try {
        await previous.remove();
      } catch {
        // Left on the device, where nothing opens it again: its user lost access.
      }
    }

    const { Mirror } = await import('../offline/mirror');
    const mirror = await Mirror.open({
      userId,
      householdId,
      origin: backendOrigin || window.location.origin,
      transport: this.transportFor(householdId),
      changes$: this.changes,
    });
    // Signed out, or unmounted, while it opened.
    if (!this.active) {
      await mirror.close();
      return;
    }
    this.attachMirror(key, mirror);
  }

  private transportFor(householdId: string): MirrorTransport {
    const recorded = <T>(request: Promise<T>): Promise<T> =>
      request.catch((error: unknown) => {
        this.lastSyncError = error;
        throw error;
      });

    return {
      pull: (collection, checkpoint, limit) =>
        recorded(this.api.syncPull(householdId, collection, checkpoint, limit)),
      push: (collection, rows) => recorded(this.api.syncPush(householdId, collection, rows)),
    };
  }

  private attachMirror(key: string, mirror: Mirror): void {
    this.mirror = mirror;
    this.mirrorKey = key;
    this.synced = false;
    this.mirrorSubscriptions = [
      mirror.items$.subscribe(this.applyItems),
      mirror.locations$.subscribe(this.applyLocations),
      mirror.shoppingLists$.subscribe(this.applyShoppingLists),
      mirror.shoppingEntries$.subscribe(this.applyShoppingEntries),
      mirror.synced$.subscribe(this.applySynced),
      mirror.errors$.subscribe(this.handleSyncError),
      mirror.refused$.subscribe(this.handleRefusal),
    ];
  }

  /**
   * Stops showing the open mirror, and hands it over to be closed or removed.
   * The pages wait again until another mirror holds a household.
   */
  private detachMirror(): Mirror | null {
    const mirror = this.mirror;
    for (const subscription of this.mirrorSubscriptions) subscription.unsubscribe();
    this.mirrorSubscriptions = [];
    this.mirror = null;
    this.mirrorKey = null;
    this.synced = false;
    this.household = null;
    return mirror;
  }

  private startLoad(): void {
    this.loadState = 'loading';
    this.error = null;
  }

  private applyBootstrap(user: CurrentUser, household: UserHousehold, units: Unit[]): void {
    this.user = user;
    this.units = units;
    this.loadedHousehold = household;
    this.showIfSynced();
  }

  /** Shows the household once both the bootstrap and the mirror have it. */
  private showIfSynced(): void {
    if (!this.synced || this.loadedHousehold === null) return;
    this.household = this.loadedHousehold;
    this.loadState = 'ready';
    this.error = null;
  }

  private applySynced(synced: boolean): void {
    this.synced = synced;
    this.showIfSynced();
  }

  private applyUser(user: CurrentUser): void {
    this.user = user;
  }

  private applyHousehold(household: UserHousehold): void {
    if (household.id === this.householdId) this.household = household;
  }

  private applyCategories(categories: readonly Category[]): void {
    this.categories = categories;
  }

  private failLoad(message: string): void {
    this.error = message;
    this.loadState = 'failed';
  }

  private applyItems(all: readonly PantryItem[]): void {
    this.allItems = all;
    this.items = reconcileById(this.items, all.filter(isActive));
    this.applyOffShelf();
  }

  private applyLocations(locations: readonly PantryLocation[]): void {
    this.locations = reconcileById(this.locations, locations.toSorted(bySortOrder));
  }

  private applyShoppingLists(lists: readonly ShoppingList[]): void {
    this.shoppingLists = reconcileById(this.shoppingLists, lists.toSorted(bySortOrder));
  }

  private applyShoppingEntries(entries: readonly ShoppingListEntry[]): void {
    this.shoppingEntries = reconcileById(this.shoppingEntries, entries.toSorted(byArrival));
    this.applyOffShelf();
  }

  /** The items off the shelf that some entry names: they change with either. */
  private applyOffShelf(): void {
    const listed = this.listedItemIds;
    this.offShelfItems = reconcileById(
      this.offShelfItems,
      this.allItems.filter((item) => !isActive(item) && listed.has(item.id)),
    );
  }

  /* ------------------------------------------------- mirror and socket events */

  /** Before the first sync, a failure means there is nothing to show; after it, replication retries quietly. */
  private handleSyncError(error: unknown): void {
    if (import.meta.env.DEV) console.warn('Offline mirror: replication failed', error);
    if (!this.synced) this.failLoad(toMessage(this.lastSyncError ?? error));
  }

  private handleRefusal(refusal: MirrorRefusal): void {
    this.notices.error(messages.errors.changeRefused(refusal.message));
  }

  private handleConnect(): void {
    this.connection = 'online';
    // Whatever changed while the socket was down.
    this.changes.next();
  }

  private handleDisconnect(): void {
    this.connection = 'offline';
  }

  private handleConnectError(): void {
    this.connection = 'offline';
  }

  /**
   * Any household's: the socket follows all of the user's, and a pull for this
   * one that finds nothing new costs one small request.
   */
  private handleDataChanged(): void {
    this.changes.next();
  }

  private handleHouseholdUpdated({ household }: HouseholdPayload): void {
    if (this.household === null || household.id !== this.household.id) return;
    this.household = { ...this.household, ...household };
  }

  /** The household shown is gone: start over with whichever one is left. */
  private handleHouseholdDeleted(payload: HouseholdDeletedPayload): void {
    if (payload.householdId === this.householdId) void this.load();
  }

  /** Removed from the household shown (or left it in another tab): start over. */
  private handleMemberRemoved(payload: HouseholdMemberRemovedPayload): void {
    if (payload.householdId === this.householdId && payload.userId === this.user?.id) {
      void this.load();
    }
  }
}

/** A new entry, made on this device: one of the item, still to buy. */
function newEntry(householdId: string, listId: string, itemId: string): ShoppingListEntry {
  const now = new Date().toISOString();
  return {
    id: createId(),
    householdId,
    listId,
    itemId,
    quantity: DEFAULT_SHOPPING_ENTRY_QUANTITY,
    checkedAt: null,
    createdAt: now,
    updatedAt: now,
  };
}
