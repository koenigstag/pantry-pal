import {
  PANTRY_COMMAND,
  PANTRY_EVENT,
  getExpiryStatus,
  sortByUrgency,
  type ExpiryStatus,
  type PantryItem,
  type PantryItemDeletedPayload,
  type PantryItemPayload,
  type PantrySnapshotPayload,
} from '@pantry-pal/shared';
import type { CreatePantryItemDto } from '@pantry-pal/shared/dto';
import { makeAutoObservable, runInAction } from 'mobx';

import { ApiError, type PantryApi } from '../services/api';
import type { PantrySocket } from '../services/socket';

export type ConnectionState = 'idle' | 'connecting' | 'online' | 'offline';

function toMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message;
  if (error instanceof Error) return error.message;
  return 'Unexpected error';
}

/**
 * Holds the pantry and keeps it in sync over two transports.
 *
 * Writes go out over REST or the socket, but the store never applies them
 * optimistically — every mutation comes back as a server broadcast and is
 * applied in one place. That keeps this client consistent with every other
 * connected client instead of briefly disagreeing with them.
 */
export class PantryStore {
  private readonly api: PantryApi;
  private readonly socket: PantrySocket;

  items: PantryItem[] = [];
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
    this.socket.disconnect();
  }

  /* ------------------------------------------------------------------ reads */

  /** REST fetch, so the list is populated even if the socket never connects. */
  async load(): Promise<void> {
    this.isLoading = true;
    this.error = null;

    try {
      const items = await this.api.list();
      runInAction(() => {
        this.items = items;
      });
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
    this.error = null;
    try {
      await this.api.create(dto);
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
    this.socket.emit(PANTRY_COMMAND.DeleteItem, { id });
  }

  /** Asks the server to re-send the full snapshot. */
  requestSync(): void {
    this.socket.emit(PANTRY_COMMAND.Sync);
  }

  /* --------------------------------------------------------- socket handlers */

  private handleConnect(): void {
    this.connection = 'online';
    this.error = null;
  }

  private handleDisconnect(): void {
    this.connection = 'offline';
  }

  private handleConnectError(error: Error): void {
    this.connection = 'offline';
    this.error = `Socket: ${error.message}`;
  }

  private handleSnapshot(payload: PantrySnapshotPayload): void {
    this.items = payload.items;
  }

  private handleItemUpserted(payload: PantryItemPayload): void {
    const index = this.items.findIndex((candidate) => candidate.id === payload.item.id);
    if (index === -1) {
      this.items.push(payload.item);
    } else {
      this.items[index] = payload.item;
    }
  }

  private handleItemDeleted(payload: PantryItemDeletedPayload): void {
    this.items = this.items.filter((item) => item.id !== payload.id);
  }
}
