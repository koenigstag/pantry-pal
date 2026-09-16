import { PANTRY_COMMAND, PANTRY_EVENT } from './constants';
import type { CreatePantryItemDto } from './dto';
import type { PantryItemDeletedPayload, PantryItemPayload, PantrySnapshotPayload } from './types';

/**
 * The websocket contract, written once and consumed from both ends.
 *
 * The backend types its `Server`/`Socket` with these, the frontend types its
 * `socket.io-client` instance with them, so a renamed event or a changed payload
 * is a compile error on both sides instead of a silent runtime no-op.
 */
export interface ServerToClientEvents {
  [PANTRY_EVENT.Snapshot]: (payload: PantrySnapshotPayload) => void;
  [PANTRY_EVENT.ItemCreated]: (payload: PantryItemPayload) => void;
  [PANTRY_EVENT.ItemUpdated]: (payload: PantryItemPayload) => void;
  [PANTRY_EVENT.ItemDeleted]: (payload: PantryItemDeletedPayload) => void;
}

export interface ClientToServerEvents {
  [PANTRY_COMMAND.Sync]: () => void;
  [PANTRY_COMMAND.CreateItem]: (payload: CreatePantryItemDto) => void;
  [PANTRY_COMMAND.DeleteItem]: (payload: PantryItemDeletedPayload) => void;
}
