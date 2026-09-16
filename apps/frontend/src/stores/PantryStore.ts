import {
  ITEM_STATUS,
  PANTRY_COMMAND,
  PANTRY_EVENT,
  getExpiryStatus,
  sortByUrgency,
  type ExpiryStatus,
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
  type PantrySnapshotPayload,
  type Unit,
  type UserHousehold,
} from '@pantry-pal/shared';
import type { CreatePantryItemDto } from '@pantry-pal/shared/dto';
import { makeAutoObservable, runInAction } from 'mobx';

import { ApiError, type PantryApi } from '../services/api';
import type { PantrySocket } from '../services/socket';

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

/** Created for a user who has no household yet, so there is always one to show. */
const FIRST_HOUSEHOLD_NAME = 'Home';

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

const bySortOrder = (a: PantryLocation, b: PantryLocation): number =>
  a.sortOrder - b.sortOrder || a.name.localeCompare(b.name);

/**
 * Holds one household's pantry and keeps it in sync over two transports.
 *
 * Writes go out over REST or the socket, but the store never applies them
 * optimistically — every mutation comes back as a server broadcast and is
 * applied in one place. That keeps this client consistent with every other
 * connected client instead of briefly disagreeing with them.
 *
 * The socket delivers events for every household the user belongs to; anything
 * for a household other than the one shown is ignored.
 */
export class PantryStore {
  private readonly api: PantryApi;
  private readonly socket: PantrySocket;

  userId: string | null = null;
  household: UserHousehold | null = null;
  items: PantryItem[] = [];
  locations: PantryLocation[] = [];
  units: Unit[] = [];
  connection: ConnectionState = 'idle';
  isLoading = false;
  error: string | null = null;

  constructor(api: PantryApi, socket: PantrySocket) {
    this.api = api;
    this.socket = socket;

    // `api`/`socket` are collaborators, not state: excluded so MobX does not
    // try to make the socket instance deeply observable.
    makeAutoObservable<PantryStore, 'api' | 'socket'>(
      this,
      { api: false, socket: false },
      { autoBind: true },
    );
  }

  /* ---------------------------------------------------------------- derived */

  get all(): PantryItem[] {
    return sortByUrgency(this.items);
  }

  get expiringSoon(): PantryItem[] {
    return this.all.filter((item) => getExpiryStatus(item) === 'expiring-soon');
  }

  get expiredCount(): number {
    return this.items.filter((item) => getExpiryStatus(item) === 'expired').length;
  }

  get isOnline(): boolean {
    return this.connection === 'online';
  }

  statusOf(item: PantryItem): ExpiryStatus {
    return getExpiryStatus(item);
  }

  locationName(id: string): string {
    return this.locations.find((location) => location.id === id)?.name ?? 'Unknown location';
  }

  /** `fl_oz_us` renders as `fl oz`; an unknown code renders as itself. */
  unitLabel(code: string): string {
    return this.units.find((unit) => unit.code === code)?.label ?? code;
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
    this.socket.off(PANTRY_EVENT.HouseholdUpdated, this.handleHouseholdUpdated);
    this.socket.off(PANTRY_EVENT.HouseholdDeleted, this.handleHouseholdDeleted);
    this.socket.off(PANTRY_EVENT.MemberRemoved, this.handleMemberRemoved);
    this.socket.disconnect();
  }

  /* ------------------------------------------------------------------ reads */

  /**
   * REST bootstrap, so the page populates even if the socket never connects:
   * the user's first household (created if they have none), then its locations
   * and items, plus the unit list.
   */
  async load(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const [me, households, units] = await Promise.all([
        this.api.me(),
        this.api.listHouseholds(),
        this.api.listUnits(),
      ]);
      const household =
        households[0] ?? (await this.api.createHousehold({ name: FIRST_HOUSEHOLD_NAME }));
      const [locations, items] = await Promise.all([
        this.api.listLocations(household.id),
        this.api.listItems(household.id),
      ]);

      runInAction(() => {
        this.userId = me.id;
        this.household = household;
        this.units = units;
        this.locations = locations;
        this.items = items;
      });

      // A socket that connected before the household was known could not ask
      // for a snapshot yet; ask now.
      this.requestSync();
    } catch (error) {
      runInAction(() => {
        this.error = toMessage(error);
      });
    } finally {
      runInAction(() => {
        this.isLoading = false;
      });
    }
  }

  /* ----------------------------------------------------------------- writes */

  /** Created over REST: the response carries a validation error worth showing. */
  async addItem(dto: CreatePantryItemDto): Promise<boolean> {
    if (this.household === null) return false;

    this.error = null;
    try {
      await this.api.createItem(this.household.id, dto);
      return true;
    } catch (error) {
      runInAction(() => {
        this.error = toMessage(error);
      });
      return false;
    }
  }

  /** Deleted over the socket: fire-and-forget, the broadcast confirms it. */
  removeItem(id: string): void {
    if (this.household === null) return;
    this.socket.emit(PANTRY_COMMAND.DeleteItem, { householdId: this.household.id, id });
  }

  /** Asks the server to re-send the household's snapshot. */
  requestSync(): void {
    if (this.household === null || !this.socket.connected) return;
    this.socket.emit(PANTRY_COMMAND.Sync, { householdId: this.household.id });
  }

  /* --------------------------------------------------------- socket handlers */

  private handleConnect(): void {
    this.connection = 'online';
    this.error = null;
    this.requestSync();
  }

  private handleDisconnect(): void {
    this.connection = 'offline';
  }

  private handleConnectError(error: Error): void {
    this.connection = 'offline';
    this.error = `Socket: ${error.message}`;
  }

  private isCurrent(householdId: string): boolean {
    return this.household !== null && householdId === this.household.id;
  }

  private handleSnapshot(payload: PantrySnapshotPayload): void {
    if (!this.isCurrent(payload.householdId)) return;

    this.items = payload.items;
    this.locations = payload.locations;
  }

  /** Only active items are listed, so consuming or discarding one removes it. */
  private handleItemUpserted({ item }: PantryItemPayload): void {
    if (!this.isCurrent(item.householdId)) return;

    const others = this.items.filter((candidate) => candidate.id !== item.id);
    this.items = item.status === ITEM_STATUS.Active ? [...others, item] : others;
  }

  private handleItemDeleted(payload: PantryItemDeletedPayload): void {
    if (!this.isCurrent(payload.householdId)) return;
    this.items = this.items.filter((item) => item.id !== payload.id);
  }

  private handleLocationUpserted({ location }: PantryLocationPayload): void {
    if (!this.isCurrent(location.householdId)) return;

    const others = this.locations.filter((candidate) => candidate.id !== location.id);
    this.locations = [...others, location].toSorted(bySortOrder);
  }

  private handleLocationDeleted(payload: PantryLocationDeletedPayload): void {
    if (!this.isCurrent(payload.householdId)) return;
    this.locations = this.locations.filter((location) => location.id !== payload.id);
  }

  private handleLocationsReordered(payload: PantryLocationsReorderedPayload): void {
    if (!this.isCurrent(payload.householdId)) return;
    this.locations = payload.locations;
  }

  private handleHouseholdUpdated({ household }: HouseholdPayload): void {
    if (this.household === null || !this.isCurrent(household.id)) return;
    this.household = { ...this.household, ...household };
  }

  /** The household shown is gone: start over with whichever one is left. */
  private handleHouseholdDeleted(payload: HouseholdDeletedPayload): void {
    if (this.isCurrent(payload.householdId)) void this.load();
  }

  /** Removed from the household shown (or left it in another tab): start over. */
  private handleMemberRemoved(payload: HouseholdMemberRemovedPayload): void {
    if (this.isCurrent(payload.householdId) && payload.userId === this.userId) void this.load();
  }
}
