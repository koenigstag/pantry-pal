import {
  ITEM_STATUS,
  MAX_SHOPPING_LISTS_PER_HOUSEHOLD,
  PANTRY_COMMAND,
  PANTRY_EVENT,
  QUANTITY_UNIT_KIND,
  type Category,
  type CurrentUser,
  type HouseholdDeletedPayload,
  type HouseholdMemberRemovedPayload,
  type HouseholdPayload,
  type PantryItem,
  type PantryItemDeletedPayload,
  type PantryItemPayload,
  type PantryLocation,
  type PantryLocationDeletedPayload,
  type PantryLocationPayload,
  type PantryLocationsReorderedPayload,
  type PantryLocationsUpsertedPayload,
  type PantrySnapshotPayload,
  type ShoppingList,
  type ShoppingListDeletedPayload,
  type ShoppingListEntriesDeletedPayload,
  type ShoppingListEntriesUpsertedPayload,
  type ShoppingListEntry,
  type ShoppingListPayload,
  type ShoppingLists,
  type ShoppingListsUpsertedPayload,
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
import { makeAutoObservable, observableRef } from 'mobx';

import { nameCollator } from '../i18n/format';
import { switchLocale } from '../i18n/locale';
import { messages } from '../i18n/messages';
import { ApiError, type PantryApi } from '../services/api';
import type { PantrySocket } from '../services/socket';
import type { NoticeStore } from './NoticeStore';
import { reconcileById, shallowEqual } from './reconcile';

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';
export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

/** A write that answers with something: what it made, or the message to show. */
export type WriteResult<T> = { ok: true; value: T } | { ok: false; error: string };

const NO_ITEMS: readonly PantryItem[] = [];
const NO_ENTRIES: readonly ShoppingListEntry[] = [];

/**
 * How many times a shopping refetch starts over because changes landed while it
 * was out. Past that, it applies what it got; the next snapshot corrects it.
 */
const MAX_SHOPPING_REFETCHES = 3;

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.errors.loadFailed;
}

const isActive = (item: PantryItem): boolean => item.status === ITEM_STATUS.Active;

const bySortOrder = (
  a: Pick<PantryLocation, 'sortOrder' | 'name'>,
  b: Pick<PantryLocation, 'sortOrder' | 'name'>,
): number => a.sortOrder - b.sortOrder || nameCollator.compare(a.name, b.name);

/**
 * Whether `incoming` should replace `existing`: never an older copy, and not an
 * identical one. Server timestamps are ISO-8601 strings in one format, so they
 * compare chronologically as strings.
 */
const replaces = <T extends { readonly updatedAt: string }>(
  incoming: T,
  existing: T | undefined,
): boolean =>
  existing === undefined ||
  (existing.updatedAt <= incoming.updatedAt && !shallowEqual(existing, incoming));

/**
 * One household's pantry, kept in sync over REST and the socket.
 *
 * **Server state only.** Writes wait for the server and apply what it returns;
 * the matching broadcast then changes nothing. The UI's one optimistic edit,
 * stepping a quantity, is an overlay kept in `QuantityUpdates` and never
 * written here — so this store never disagrees with the server for longer than
 * a response takes to arrive.
 *
 * `items`, `locations`, `units` and `categories` are replaced rather than mutated, and hold
 * plain objects (`observableRef`). An entity that did not change keeps its
 * object identity across refetches and snapshots (`reconcileById`), so a
 * memoised card skips re-rendering.
 *
 * The socket delivers events for every household the user belongs to; those
 * for any household other than the one shown are ignored.
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
  household: UserHousehold | null = null;
  items: readonly PantryItem[] = NO_ITEMS;
  locations: readonly PantryLocation[] = [];
  units: readonly Unit[] = [];
  categories: readonly Category[] = [];
  shoppingLists: readonly ShoppingList[] = [];
  shoppingEntries: readonly ShoppingListEntry[] = NO_ENTRIES;
  /** Items that are not active but are on a shopping list: never in `items` at the same time. */
  offShelfItems: readonly PantryItem[] = NO_ITEMS;
  /** Shopping lists load beside the bootstrap, so the rest of the app works without them. */
  shoppingLoadState: LoadState = 'idle';
  connection: ConnectionState = 'idle';
  loadState: LoadState = 'idle';
  error: string | null = null;

  /*
   * Refetch bookkeeping, deliberately not observable. A broadcast that lands
   * while an item refetch is in flight is newer than that response, so the
   * response must not overwrite what the broadcast touched; a snapshot makes
   * the whole response stale.
   */
  private refreshInFlight: Promise<void> | null = null;
  private refreshQueued = false;
  private refreshSuperseded = false;
  private readonly touchedDuringRefresh = new Set<string>();

  /** The bootstrap running now, which a second `load()` joins instead of repeating. */
  private loadInFlight: Promise<void> | null = null;

  /*
   * Shopping refetch bookkeeping, not observable either. A refetch that returns
   * after a snapshot is stale and is dropped; one that returns after a broadcast
   * may predate it, so it asks again.
   */
  private shoppingChanges = 0;
  private shoppingSnapshots = 0;

  /** Entries and lists deleted in this session: a late copy of one must not bring it back. */
  private readonly goneShopping = new Set<string>();

  constructor(api: PantryApi, socket: PantrySocket, notices: NoticeStore) {
    this.api = api;
    this.socket = socket;
    this.notices = notices;

    // Collaborators and bookkeeping are excluded: MobX must not try to make the
    // socket instance deeply observable.
    makeAutoObservable<
      PantryStore,
      | 'api'
      | 'socket'
      | 'notices'
      | 'refreshInFlight'
      | 'refreshQueued'
      | 'refreshSuperseded'
      | 'touchedDuringRefresh'
      | 'loadInFlight'
      | 'shoppingChanges'
      | 'shoppingSnapshots'
      | 'goneShopping'
    >(
      this,
      {
        api: false,
        socket: false,
        notices: false,
        refreshInFlight: false,
        refreshQueued: false,
        refreshSuperseded: false,
        touchedDuringRefresh: false,
        loadInFlight: false,
        shoppingChanges: false,
        shoppingSnapshots: false,
        goneShopping: false,
        user: observableRef,
        household: observableRef,
        items: observableRef,
        locations: observableRef,
        units: observableRef,
        categories: observableRef,
        shoppingLists: observableRef,
        shoppingEntries: observableRef,
        offShelfItems: observableRef,
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

  /** Each list's entries, in the order they arrived. */
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

  /* -------------------------------------------------------------- lifecycle */

  connect(): void {
    this.connection = 'connecting';

    this.socket.on('connect', this.handleConnect);
    this.socket.on('disconnect', this.handleDisconnect);
    this.socket.on('connect_error', this.handleConnectError);
    this.socket.on(PANTRY_EVENT.Snapshot, this.handleSnapshot);
    this.socket.on(PANTRY_EVENT.ItemCreated, this.handleItemUpserted);
    this.socket.on(PANTRY_EVENT.ItemUpdated, this.handleItemUpserted);
    this.socket.on(PANTRY_EVENT.ItemDeleted, this.handleItemDeleted);
    this.socket.on(PANTRY_EVENT.LocationCreated, this.handleLocationUpserted);
    this.socket.on(PANTRY_EVENT.LocationUpdated, this.handleLocationUpserted);
    this.socket.on(PANTRY_EVENT.LocationDeleted, this.handleLocationDeleted);
    this.socket.on(PANTRY_EVENT.LocationsReordered, this.handleLocationsReordered);
    this.socket.on(PANTRY_EVENT.LocationsUpserted, this.handleLocationsUpserted);
    this.socket.on(PANTRY_EVENT.HouseholdUpdated, this.handleHouseholdUpdated);
    this.socket.on(PANTRY_EVENT.HouseholdDeleted, this.handleHouseholdDeleted);
    this.socket.on(PANTRY_EVENT.MemberRemoved, this.handleMemberRemoved);
    this.socket.on(PANTRY_EVENT.ShoppingListCreated, this.handleShoppingListUpserted);
    this.socket.on(PANTRY_EVENT.ShoppingListUpdated, this.handleShoppingListUpserted);
    this.socket.on(PANTRY_EVENT.ShoppingListDeleted, this.handleShoppingListDeleted);
    this.socket.on(PANTRY_EVENT.ShoppingListsUpserted, this.handleShoppingListsUpserted);
    this.socket.on(PANTRY_EVENT.ShoppingListEntriesUpserted, this.handleShoppingEntriesUpserted);
    this.socket.on(PANTRY_EVENT.ShoppingListEntriesDeleted, this.handleShoppingEntriesDeleted);

    this.socket.connect();
  }

  dispose(): void {
    this.socket.off('connect', this.handleConnect);
    this.socket.off('disconnect', this.handleDisconnect);
    this.socket.off('connect_error', this.handleConnectError);
    this.socket.off(PANTRY_EVENT.Snapshot, this.handleSnapshot);
    this.socket.off(PANTRY_EVENT.ItemCreated, this.handleItemUpserted);
    this.socket.off(PANTRY_EVENT.ItemUpdated, this.handleItemUpserted);
    this.socket.off(PANTRY_EVENT.ItemDeleted, this.handleItemDeleted);
    this.socket.off(PANTRY_EVENT.LocationCreated, this.handleLocationUpserted);
    this.socket.off(PANTRY_EVENT.LocationUpdated, this.handleLocationUpserted);
    this.socket.off(PANTRY_EVENT.LocationDeleted, this.handleLocationDeleted);
    this.socket.off(PANTRY_EVENT.LocationsReordered, this.handleLocationsReordered);
    this.socket.off(PANTRY_EVENT.LocationsUpserted, this.handleLocationsUpserted);
    this.socket.off(PANTRY_EVENT.HouseholdUpdated, this.handleHouseholdUpdated);
    this.socket.off(PANTRY_EVENT.HouseholdDeleted, this.handleHouseholdDeleted);
    this.socket.off(PANTRY_EVENT.MemberRemoved, this.handleMemberRemoved);
    this.socket.off(PANTRY_EVENT.ShoppingListCreated, this.handleShoppingListUpserted);
    this.socket.off(PANTRY_EVENT.ShoppingListUpdated, this.handleShoppingListUpserted);
    this.socket.off(PANTRY_EVENT.ShoppingListDeleted, this.handleShoppingListDeleted);
    this.socket.off(PANTRY_EVENT.ShoppingListsUpserted, this.handleShoppingListsUpserted);
    this.socket.off(PANTRY_EVENT.ShoppingListEntriesUpserted, this.handleShoppingEntriesUpserted);
    this.socket.off(PANTRY_EVENT.ShoppingListEntriesDeleted, this.handleShoppingEntriesDeleted);
    this.socket.disconnect();
  }

  /* ------------------------------------------------------------------ reads */

  /**
   * REST bootstrap, so the page populates even if the socket never connects:
   * the user, their first household (created if they have none), its
   * locations and items, and the unit list.
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
    this.loadState = 'loading';
    this.error = null;
    void this.refreshCategories();

    try {
      const [user, households, units] = await Promise.all([
        this.api.me(),
        this.api.listHouseholds(),
        this.api.listUnits(),
      ]);
      const household =
        households[0] ?? (await this.api.createHousehold({ name: messages.household.defaultName }));
      const [locations, items] = await Promise.all([
        this.api.listLocations(household.id),
        this.api.listItems(household.id),
      ]);

      this.applyLoaded({ user, household, units, locations, items });
      void this.refreshShopping();
      // The account's language outranks this browser's copy of it — on a new
      // device, say. When they differ, the page reloads in the account's.
      switchLocale(user.locale);
      // A socket that connected before the household was known could not ask
      // for a snapshot yet; ask now.
      this.requestSync();
    } catch (error) {
      this.failLoad(error);
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

  /** Background refetch of everything shown: no loading state, and only what changed repaints. */
  async refresh(): Promise<void> {
    await Promise.all([this.refreshLocations(), this.refreshItems(), this.refreshShopping()]);
  }

  /**
   * Fetches the shopping lists, their entries and the items those name. Like
   * categories, beside the bootstrap: a failure — a backend older than shopping
   * lists, say — leaves everything else working. Only the first load shows a
   * loading state; later ones repaint what changed.
   *
   * A snapshot that arrives meanwhile is newer and complete, so the response is
   * dropped. A broadcast that arrives meanwhile may be newer than the response
   * but is only a part, so the fetch starts over, a few times at most.
   */
  async refreshShopping(attempt = 1): Promise<void> {
    const householdId = this.householdId;
    if (householdId === null) return;

    const changes = this.shoppingChanges;
    const snapshots = this.shoppingSnapshots;
    if (this.shoppingLoadState !== 'ready') this.setShoppingLoadState('loading');

    let shopping: ShoppingLists;
    try {
      shopping = await this.api.listShoppingLists(householdId);
    } catch {
      if (this.shoppingLoadState === 'ready') this.notices.error(messages.errors.refreshFailed);
      else this.setShoppingLoadState('failed');
      return;
    }

    if (this.shoppingSnapshots !== snapshots) return;
    if (this.shoppingChanges !== changes && attempt < MAX_SHOPPING_REFETCHES) {
      await this.refreshShopping(attempt + 1);
      return;
    }
    this.applyShopping(householdId, shopping);
  }

  async refreshLocations(): Promise<void> {
    const householdId = this.householdId;
    if (householdId === null) return;

    try {
      this.applyLocations(householdId, await this.api.listLocations(householdId));
    } catch {
      this.notices.error(messages.errors.refreshFailed);
    }
  }

  /**
   * Refetches the household's items in the background. Calls made while one
   * is in flight collapse into a single follow-up request.
   */
  refreshItems(): Promise<void> {
    if (this.refreshInFlight !== null) {
      this.refreshQueued = true;
      return this.refreshInFlight;
    }

    const run = this.runItemRefreshes().finally(() => {
      this.refreshInFlight = null;
    });
    this.refreshInFlight = run;
    return run;
  }

  /** Asks the server to re-send the household's snapshot over the socket. */
  requestSync(): void {
    const householdId = this.householdId;
    if (householdId === null || !this.socket.connected) return;
    this.socket.emit(PANTRY_COMMAND.Sync, { householdId });
  }

  /* ----------------------------------------------------------------- writes */

  /** Returns the server's error message, or `null` once the item exists. */
  async addItem(dto: CreatePantryItemDto): Promise<string | null> {
    const householdId = this.householdId;
    if (householdId === null) return messages.errors.loadFailed;

    try {
      this.acceptItem(await this.api.createItem(householdId, dto));
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  /**
   * Applies a partial update once the server accepts it. Returns the server's
   * error message, or `null`: callers inside a modal dialog show it there, where
   * a notice would be hidden behind the dialog.
   */
  async updateItem(id: string, dto: UpdatePantryItemDto): Promise<string | null> {
    const householdId = this.householdId;
    if (householdId === null) return messages.errors.loadFailed;

    try {
      this.acceptItem(await this.api.updateItem(householdId, id, dto));
      return null;
    } catch (error) {
      return toMessage(error);
    }
  }

  /**
   * One DELETE per item, until the bulk endpoint from the backend spec
   * (`POST .../items/bulk-delete`) replaces this loop with a single call.
   */
  async deleteItems(ids: readonly string[]): Promise<void> {
    const householdId = this.householdId;
    if (householdId === null || ids.length === 0) return;

    const results = await Promise.allSettled(ids.map((id) => this.api.removeItem(householdId, id)));
    this.forgetItems(
      householdId,
      ids.filter((_, index) => results[index]?.status === 'fulfilled'),
    );
    this.reportFailures(results, messages.errors.deleteFailed);
  }

  /**
   * One PATCH per item, until the bulk endpoint from the backend spec
   * (`POST .../items/bulk-move`) replaces this loop with a single call.
   */
  async moveItems(ids: readonly string[], locationId: string): Promise<void> {
    const householdId = this.householdId;
    if (householdId === null || ids.length === 0) return;

    const results = await Promise.allSettled(
      ids.map((id) => this.api.updateItem(householdId, id, { locationId })),
    );
    this.acceptItems(
      results.flatMap((result) => (result.status === 'fulfilled' ? [result.value] : [])),
    );
    this.reportFailures(results, messages.errors.moveFailed);
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
   * Saves the locations editor in one request: renames, additions, deletions
   * and order. Returns `null` once saved, or the message the editor shows.
   *
   * A 409 means the list changed on the server while the user edited it. The
   * latest data is fetched before this returns, the editor's draft rebases onto
   * it, and the user saves again.
   */
  async saveLocations(dto: UpsertLocationsDto): Promise<string | null> {
    const householdId = this.householdId;
    if (householdId === null) return messages.errors.loadFailed;

    try {
      this.applyLocations(householdId, await this.api.upsertLocations(householdId, dto));
      // Items moved out of deleted locations. Broadcasts announce them too, but
      // the socket may be down.
      if ((dto.removed?.length ?? 0) > 0) void this.refreshItems();
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.refresh();
        return messages.locationEditor.changedElsewhere;
      }
      return toMessage(error);
    }
  }

  /** Creates a shopping list, appended after the others. */
  async createShoppingList(name: string): Promise<WriteResult<ShoppingList>> {
    const householdId = this.householdId;
    if (householdId === null) return { ok: false, error: messages.errors.loadFailed };

    try {
      const list = await this.api.createShoppingList(householdId, { name });
      this.acceptShoppingList(list);
      return { ok: true, value: list };
    } catch (error) {
      return { ok: false, error: this.shoppingListError(error) };
    }
  }

  /**
   * Saves the shopping lists editor in one request: additions, renames,
   * archiving, deletions and order. Returns `null` once saved, or the message
   * the editor shows.
   *
   * A 409 means the lists changed on the server while the user edited them. The
   * latest are fetched before this returns, the editor's draft rebases onto
   * them, and the user saves again.
   */
  async saveShoppingLists(dto: UpsertShoppingListsDto): Promise<string | null> {
    const householdId = this.householdId;
    if (householdId === null) return messages.errors.loadFailed;

    try {
      this.applyShoppingLists(householdId, await this.api.upsertShoppingLists(householdId, dto));
      // Items lose a deleted list as their default. Broadcasts announce them too,
      // but the socket may be down.
      if ((dto.removed?.length ?? 0) > 0) void this.refreshItems();
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.refreshShopping();
        return messages.shoppingListEditor.changedElsewhere;
      }
      return toMessage(error);
    }
  }

  /** Puts items on a list; those already on it stay as they are. Answers how many were added. */
  async addToShoppingList(
    listId: string,
    itemIds: readonly string[],
  ): Promise<WriteResult<number>> {
    const householdId = this.householdId;
    if (householdId === null) return { ok: false, error: messages.errors.loadFailed };

    try {
      const change = await this.api.addShoppingListEntries(householdId, listId, {
        itemIds: [...itemIds],
      });
      this.acceptShoppingEntries(householdId, change.entries, change.items);
      return { ok: true, value: change.entries.length };
    } catch (error) {
      return { ok: false, error: toMessage(error) };
    }
  }

  /** How many to buy, or ticked off. Returns `null` once saved, or the message to show. */
  async updateShoppingEntry(
    entry: ShoppingListEntry,
    dto: UpdateShoppingListEntryDto,
  ): Promise<string | null> {
    const householdId = this.householdId;
    if (householdId === null) return messages.errors.loadFailed;

    try {
      const saved = await this.api.updateShoppingListEntry(
        householdId,
        entry.listId,
        entry.id,
        dto,
      );
      this.acceptShoppingEntries(householdId, [saved], []);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        // Taken off the list elsewhere meanwhile.
        this.forgetShoppingEntries(householdId, [entry.id]);
      }
      return toMessage(error);
    }
  }

  async removeShoppingEntry(entry: ShoppingListEntry): Promise<string | null> {
    const householdId = this.householdId;
    if (householdId === null) return messages.errors.loadFailed;

    try {
      await this.api.removeShoppingListEntry(householdId, entry.listId, entry.id);
      this.forgetShoppingEntries(householdId, [entry.id]);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 404) {
        this.forgetShoppingEntries(householdId, [entry.id]);
        return null;
      }
      return toMessage(error);
    }
  }

  /**
   * Puts ticked-off entries away: the server restocks their items and takes the
   * entries off the list, all or nothing. A 409 means the list changed while it
   * was shown; the latest is fetched before this returns, for the user to check.
   */
  async putAwayShopping(listId: string, entryIds: readonly string[]): Promise<string | null> {
    const householdId = this.householdId;
    if (householdId === null) return messages.errors.loadFailed;

    try {
      const items = await this.api.putAwayShoppingListEntries(householdId, listId, {
        entryIds: [...entryIds],
      });
      this.forgetShoppingEntries(householdId, entryIds);
      this.acceptItems(items);
      return null;
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) {
        await this.refreshShopping();
        return messages.shopping.changedElsewhere;
      }
      return toMessage(error);
    }
  }

  /**
   * Applies items the server just returned — a write's response or a broadcast.
   * Never regresses to an older copy (`replaces`).
   *
   * Only active items are listed, so consuming or discarding one takes it out
   * of `items`; if a shopping list names it, it moves to `offShelfItems`, and
   * restocking brings it back.
   */
  acceptItem(item: PantryItem): void {
    if (item.householdId !== this.householdId) return;
    this.touch(item.id);

    const index = this.items.findIndex((candidate) => candidate.id === item.id);
    const offShelfIndex = this.offShelfItems.findIndex((candidate) => candidate.id === item.id);
    const existing = this.items[index] ?? this.offShelfItems[offShelfIndex];
    if (!replaces(item, existing)) return;

    if (isActive(item)) {
      if (offShelfIndex !== -1) this.offShelfItems = this.offShelfItems.toSpliced(offShelfIndex, 1);
      this.items = index === -1 ? [...this.items, item] : this.items.with(index, item);
      return;
    }

    if (index !== -1) this.items = this.items.toSpliced(index, 1);
    if (offShelfIndex !== -1) {
      this.offShelfItems = this.offShelfItems.with(offShelfIndex, item);
    } else if (this.listedItemIds.has(item.id)) {
      this.offShelfItems = [...this.offShelfItems, item];
    }
  }

  acceptItems(items: readonly PantryItem[]): void {
    for (const item of items) this.acceptItem(item);
  }

  /* --------------------------------------------------------------- internal */

  private applyLoaded(loaded: {
    user: CurrentUser;
    household: UserHousehold;
    units: Unit[];
    locations: PantryLocation[];
    items: PantryItem[];
  }): void {
    // Another household than before (the last one was deleted): its lists are not this one's.
    if (this.household !== null && this.household.id !== loaded.household.id) {
      this.shoppingLists = [];
      this.shoppingEntries = NO_ENTRIES;
      this.offShelfItems = NO_ITEMS;
      this.shoppingLoadState = 'idle';
    }
    this.user = loaded.user;
    this.household = loaded.household;
    this.units = loaded.units;
    this.locations = loaded.locations.toSorted(bySortOrder);
    this.items = reconcileById(this.items, loaded.items.filter(isActive));
    this.loadState = 'ready';
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

  private failLoad(error: unknown): void {
    this.error = toMessage(error);
    this.loadState = 'failed';
  }

  private applyLocations(householdId: string, locations: readonly PantryLocation[]): void {
    if (householdId !== this.householdId) return;
    this.locations = reconcileById(this.locations, locations.toSorted(bySortOrder));
  }

  private setShoppingLoadState(state: LoadState): void {
    this.shoppingLoadState = state;
  }

  /** Replaces every list, entry and off-shelf item with a complete copy: a refetch or a snapshot. */
  private applyShopping(householdId: string, shopping: ShoppingLists): void {
    if (householdId !== this.householdId) return;

    // Ids never come back, so anything deleted here since is left out even of a late copy.
    const gone = this.goneShopping;
    this.shoppingLists = reconcileById(
      this.shoppingLists,
      shopping.lists.filter((list) => !gone.has(list.id)).toSorted(bySortOrder),
    );
    this.shoppingEntries = reconcileById(
      this.shoppingEntries,
      shopping.entries.filter((entry) => !gone.has(entry.id) && !gone.has(entry.listId)),
    );
    const listed = this.listedItemIds;
    this.offShelfItems = reconcileById(
      this.offShelfItems,
      shopping.items.filter((item) => !isActive(item) && listed.has(item.id)),
    );
    // Active ones may be newer than the copies in `items`, never older.
    this.acceptItems(shopping.items.filter(isActive));
    this.shoppingLoadState = 'ready';
  }

  private acceptShoppingList(list: ShoppingList): void {
    if (list.householdId !== this.householdId || this.goneShopping.has(list.id)) return;
    this.shoppingChanges += 1;

    const index = this.shoppingLists.findIndex((candidate) => candidate.id === list.id);
    if (!replaces(list, this.shoppingLists[index])) return;

    const others = index === -1 ? this.shoppingLists : this.shoppingLists.toSpliced(index, 1);
    this.shoppingLists = [...others, list].toSorted(bySortOrder);
  }

  /**
   * Replaces the lists with the complete set the editor saved, and drops the
   * entries of every list missing from it, which it deleted.
   */
  private applyShoppingLists(householdId: string, lists: readonly ShoppingList[]): void {
    if (householdId !== this.householdId) return;
    this.shoppingChanges += 1;

    const kept = new Set(lists.map((list) => list.id));
    for (const list of this.shoppingLists) {
      if (!kept.has(list.id)) this.goneShopping.add(list.id);
    }
    this.shoppingLists = reconcileById(this.shoppingLists, lists.toSorted(bySortOrder));
    this.forgetShoppingEntries(
      householdId,
      this.shoppingEntries.filter((entry) => !kept.has(entry.listId)).map((entry) => entry.id),
    );
  }

  /** Drops a deleted list with everything on it. */
  private forgetShoppingList(householdId: string, listId: string): void {
    if (householdId !== this.householdId) return;
    this.shoppingChanges += 1;
    this.goneShopping.add(listId);

    this.shoppingLists = this.shoppingLists.filter((list) => list.id !== listId);
    this.forgetShoppingEntries(
      householdId,
      this.entriesOn(listId).map((entry) => entry.id),
    );
  }

  /**
   * Applies entries a write created or changed, with the items they name. The
   * entries go first, so an item that is off the shelf is known to be listed
   * when it arrives.
   */
  private acceptShoppingEntries(
    householdId: string,
    entries: readonly ShoppingListEntry[],
    items: readonly PantryItem[],
  ): void {
    if (householdId !== this.householdId) return;
    this.shoppingChanges += 1;

    let next = this.shoppingEntries;
    for (const entry of entries) {
      if (this.goneShopping.has(entry.id) || this.goneShopping.has(entry.listId)) continue;
      const index = next.findIndex((candidate) => candidate.id === entry.id);
      if (!replaces(entry, next[index])) continue;
      next = index === -1 ? [...next, entry] : next.with(index, entry);
    }
    this.shoppingEntries = next;

    this.acceptItems(items);
  }

  /** Drops entries taken off their lists, and any off-shelf item no list names any more. */
  private forgetShoppingEntries(householdId: string, ids: readonly string[]): void {
    if (householdId !== this.householdId || ids.length === 0) return;
    this.shoppingChanges += 1;

    const gone = new Set(ids);
    for (const id of ids) this.goneShopping.add(id);
    this.shoppingEntries = this.shoppingEntries.filter((entry) => !gone.has(entry.id));

    const listed = this.listedItemIds;
    const offShelf = this.offShelfItems.filter((item) => listed.has(item.id));
    if (offShelf.length !== this.offShelfItems.length) this.offShelfItems = offShelf;
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

  private async runItemRefreshes(): Promise<void> {
    do {
      this.refreshQueued = false;
      this.refreshSuperseded = false;
      this.touchedDuringRefresh.clear();

      const householdId = this.householdId;
      if (householdId === null) return;

      try {
        // Sequential on purpose: a queued refetch must start after the previous
        // response is applied, or it could finish first and be overwritten.
        // oxlint-disable-next-line no-await-in-loop
        this.applyRefreshedItems(householdId, await this.api.listItems(householdId));
      } catch {
        this.notices.error(messages.errors.refreshFailed);
        return;
      }
    } while (this.refreshQueued);
  }

  private applyRefreshedItems(householdId: string, fetched: readonly PantryItem[]): void {
    if (householdId !== this.householdId || this.refreshSuperseded) return;

    const touched = this.touchedDuringRefresh;
    const next = fetched.filter((item) => isActive(item) && !touched.has(item.id));
    for (const item of this.items) {
      if (touched.has(item.id)) next.push(item);
    }
    this.items = reconcileById(this.items, next);

    // A listed item that left the shelf without its broadcast reaching this tab
    // is in neither list now; the shopping lists' refetch brings it back.
    const held = this.itemsById;
    if ([...this.listedItemIds].some((id) => !held.has(id))) void this.refreshShopping();
  }

  private forgetItems(householdId: string, ids: readonly string[]): void {
    if (householdId !== this.householdId || ids.length === 0) return;

    for (const id of ids) this.touch(id);
    const gone = new Set(ids);
    this.items = this.items.filter((item) => !gone.has(item.id));
  }

  private touch(id: string): void {
    if (this.refreshInFlight !== null) this.touchedDuringRefresh.add(id);
  }

  private reportFailures(
    results: readonly PromiseSettledResult<unknown>[],
    message: (count: number) => string,
  ): void {
    const failed = results.filter((result) => result.status === 'rejected').length;
    if (failed === 0) return;

    this.notices.error(message(failed));
    // Some of those may have succeeded after all (a timeout, say): trust the server.
    void this.refreshItems();
  }

  /* --------------------------------------------------------- socket handlers */

  private handleConnect(): void {
    this.connection = 'online';
    this.requestSync();
  }

  private handleDisconnect(): void {
    this.connection = 'offline';
  }

  private handleConnectError(): void {
    this.connection = 'offline';
  }

  /** In order with the broadcasts, so it is current — and any REST response still in flight is not. */
  private handleSnapshot(payload: PantrySnapshotPayload): void {
    if (payload.householdId !== this.householdId) return;

    if (this.refreshInFlight !== null) this.refreshSuperseded = true;
    this.items = reconcileById(this.items, payload.items.filter(isActive));
    this.locations = reconcileById(this.locations, payload.locations.toSorted(bySortOrder));

    // A backend older than shopping lists sends snapshots without them.
    if (payload.shopping !== undefined) {
      this.shoppingSnapshots += 1;
      this.applyShopping(payload.householdId, payload.shopping);
    }
  }

  private handleItemUpserted({ item }: PantryItemPayload): void {
    this.acceptItem(item);
  }

  private handleItemDeleted({ householdId, id }: PantryItemDeletedPayload): void {
    this.forgetItems(householdId, [id]);
  }

  private handleLocationUpserted({ location }: PantryLocationPayload): void {
    if (location.householdId !== this.householdId) return;

    const others = this.locations.filter((candidate) => candidate.id !== location.id);
    this.locations = [...others, location].toSorted(bySortOrder);
  }

  private handleLocationDeleted(payload: PantryLocationDeletedPayload): void {
    if (payload.householdId !== this.householdId) return;
    this.locations = this.locations.filter((location) => location.id !== payload.id);
  }

  private handleLocationsReordered(payload: PantryLocationsReorderedPayload): void {
    this.applyLocations(payload.householdId, payload.locations);
  }

  private handleLocationsUpserted(payload: PantryLocationsUpsertedPayload): void {
    this.applyLocations(payload.householdId, payload.locations);
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

  private handleShoppingListUpserted({ list }: ShoppingListPayload): void {
    this.acceptShoppingList(list);
  }

  private handleShoppingListDeleted({ householdId, id }: ShoppingListDeletedPayload): void {
    this.forgetShoppingList(householdId, id);
  }

  private handleShoppingListsUpserted({ householdId, lists }: ShoppingListsUpsertedPayload): void {
    this.applyShoppingLists(householdId, lists);
  }

  private handleShoppingEntriesUpserted(payload: ShoppingListEntriesUpsertedPayload): void {
    this.acceptShoppingEntries(payload.householdId, payload.entries, payload.items);
  }

  private handleShoppingEntriesDeleted({
    householdId,
    ids,
  }: ShoppingListEntriesDeletedPayload): void {
    this.forgetShoppingEntries(householdId, ids);
  }
}
