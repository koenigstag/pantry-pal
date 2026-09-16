/**
 * Values the backend and the frontend must agree on.
 *
 * Anything duplicated between the two apps belongs here: once a literal exists in
 * both `apps/backend` and `apps/frontend` it will eventually drift.
 */

/** Mounted by the backend via `setGlobalPrefix`, used by the frontend to build URLs. */
export const API_PREFIX = 'api';
export const API_VERSION = 'v1';
export const API_BASE_PATH = `/${API_PREFIX}/${API_VERSION}`;

/** Fallback ports. Real values come from each app's `.env` — see `.env.example`. */
export const DEFAULT_BACKEND_PORT = 3001;
export const DEFAULT_FRONTEND_PORT = 3000;

/** Socket.IO namespace and mount path. */
export const PANTRY_WS_NAMESPACE = '/pantry';
export const SOCKET_IO_PATH = '/socket.io';

/** Server -> client events. */
export const PANTRY_EVENT = {
  Snapshot: 'pantry:snapshot',
  ItemCreated: 'pantry:item-created',
  ItemUpdated: 'pantry:item-updated',
  ItemDeleted: 'pantry:item-deleted',
} as const;
export type PantryEventName = (typeof PANTRY_EVENT)[keyof typeof PANTRY_EVENT];

/** Client -> server commands. */
export const PANTRY_COMMAND = {
  Sync: 'pantry:sync',
  CreateItem: 'pantry:create-item',
  DeleteItem: 'pantry:delete-item',
} as const;
export type PantryCommandName = (typeof PANTRY_COMMAND)[keyof typeof PANTRY_COMMAND];

export const PANTRY_CATEGORIES = [
  'produce',
  'dairy',
  'meat',
  'grains',
  'canned',
  'frozen',
  'spices',
  'beverages',
  'medicine',
  'personal-care',
  'cleaning',
  'other',
] as const;

export const PANTRY_UNITS = ['g', 'kg', 'ml', 'l', 'pcs', 'pack', 'can', 'bottle'] as const;

/** An item within this many days of its expiry date counts as "expiring soon". */
export const EXPIRY_WARNING_DAYS = 3;

export const MAX_ITEM_NAME_LENGTH = 80;
export const MAX_ITEM_QUANTITY = 10_000;
