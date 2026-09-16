import {
  ITEM_STATUS,
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
  type Unit,
  type UserHousehold,
} from '@pantry-pal/shared';
import type {
  CreatePantryItemDto,
  UpdatePantryItemDto,
  UpsertLocationsDto,
} from '@pantry-pal/shared/dto';
import { makeAutoObservable, observableRef } from 'mobx';

import { nameCollator } from '../i18n/format';
import { messages } from '../i18n/messages';
import { ApiError, type PantryApi } from '../services/api';
import type { PantrySocket } from '../services/socket';
import type { NoticeStore } from './NoticeStore';
import { reconcileById, shallowEqual } from './reconcile';

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';
export type LoadState = 'idle' | 'loading' | 'ready' | 'failed';

const NO_ITEMS: readonly PantryItem[] = [];

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : messages.errors.loadFailed;
}

const isActive = (item: PantryItem): boolean => item.status === ITEM_STATUS.Active;

const bySortOrder = (a: PantryLocation, b: PantryLocation): number =>
  a.sortOrder - b.sortOrder || nameCollator.compare(a.name, b.name);

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
        user: observableRef,
        household: observableRef,
        items: observableRef,
        locations: observableRef,
        units: observableRef,
        categories: observableRef,
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
   * `2 cans`; any other unit is its label, `12 fl oz`.
   */
  unitName(code: string, count: number): string {
    const unit = this.unitsByCode.get(code);
    if (unit === undefined) return code;
    return unit.kind === QUANTITY_UNIT_KIND
      ? messages.units.countNoun(code, count, unit.label)
      : unit.label;
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
    this.socket.disconnect();
  }

  /* ------------------------------------------------------------------ reads */

  /**
   * REST bootstrap, so the page populates even if the socket never connects:
   * the user, their first household (created if they have none), its
   * locations and items, and the unit list.
   */
  async load(): Promise<void> {
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
    await Promise.all([this.refreshLocations(), this.refreshItems()]);
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

  /**
   * Applies items the server just returned — a write's response or a broadcast.
   * Never regresses to an older copy: server timestamps are ISO-8601 strings in
   * one format, so they compare chronologically as strings.
   */
  acceptItem(item: PantryItem): void {
    if (item.householdId !== this.householdId) return;
    this.touch(item.id);

    const index = this.items.findIndex((candidate) => candidate.id === item.id);
    const existing = this.items[index];
    if (
      existing !== undefined &&
      (existing.updatedAt > item.updatedAt || shallowEqual(existing, item))
    ) {
      return;
    }

    // Only active items are listed, so consuming or discarding one removes it.
    if (!isActive(item)) {
      if (existing !== undefined) this.items = this.items.toSpliced(index, 1);
      return;
    }
    this.items = existing === undefined ? [...this.items, item] : this.items.with(index, item);
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
    this.user = loaded.user;
    this.household = loaded.household;
    this.units = loaded.units;
    this.locations = loaded.locations.toSorted(bySortOrder);
    this.items = reconcileById(this.items, loaded.items.filter(isActive));
    this.loadState = 'ready';
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
}
