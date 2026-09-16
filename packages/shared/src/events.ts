import { PANTRY_COMMAND, PANTRY_EVENT } from './constants';
import type { CreatePantryItemCommandDto, DeletePantryItemCommandDto, SyncPantryDto } from './dto';
import type {
  HouseholdDeletedPayload,
  HouseholdMemberPayload,
  HouseholdMemberRemovedPayload,
  HouseholdPayload,
  PantryItemDeletedPayload,
  PantryItemPayload,
  PantryLocationDeletedPayload,
  PantryLocationPayload,
  PantryLocationsReorderedPayload,
  PantrySnapshotPayload,
} from './types';

/**
 * The websocket contract, written once and consumed from both ends.
 *
 * The backend types its `Server`/`Socket` with these, the frontend types its
 * `socket.io-client` instance with them, so a renamed event or a changed payload
 * is a compile error on both sides instead of a silent runtime no-op.
 *
 * A socket receives events only for households its user belongs to: the gateway
 * keeps one room per household and moves sockets between rooms as membership
 * changes.
 */
export interface ServerToClientEvents {
  [PANTRY_EVENT.Snapshot]: (payload: PantrySnapshotPayload) => void;
  [PANTRY_EVENT.ItemCreated]: (payload: PantryItemPayload) => void;
  [PANTRY_EVENT.ItemUpdated]: (payload: PantryItemPayload) => void;
  [PANTRY_EVENT.ItemDeleted]: (payload: PantryItemDeletedPayload) => void;
  [PANTRY_EVENT.LocationCreated]: (payload: PantryLocationPayload) => void;
  [PANTRY_EVENT.LocationUpdated]: (payload: PantryLocationPayload) => void;
  [PANTRY_EVENT.LocationDeleted]: (payload: PantryLocationDeletedPayload) => void;
  [PANTRY_EVENT.LocationsReordered]: (payload: PantryLocationsReorderedPayload) => void;
  [PANTRY_EVENT.HouseholdUpdated]: (payload: HouseholdPayload) => void;
  [PANTRY_EVENT.HouseholdDeleted]: (payload: HouseholdDeletedPayload) => void;
  [PANTRY_EVENT.MemberAdded]: (payload: HouseholdMemberPayload) => void;
  [PANTRY_EVENT.MemberUpdated]: (payload: HouseholdMemberPayload) => void;
  [PANTRY_EVENT.MemberRemoved]: (payload: HouseholdMemberRemovedPayload) => void;
}

export interface ClientToServerEvents {
  [PANTRY_COMMAND.Sync]: (payload: SyncPantryDto) => void;
  [PANTRY_COMMAND.CreateItem]: (payload: CreatePantryItemCommandDto) => void;
  [PANTRY_COMMAND.DeleteItem]: (payload: DeletePantryItemCommandDto) => void;
}
