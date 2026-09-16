/**
 * Values the backend and the frontend must agree on.
 *
 * Anything duplicated between the two apps belongs here: once a literal exists in
 * both `apps/backend` and `apps/frontend` it will eventually drift. The value sets
 * the database CHECK constraints are generated from live here too, so that
 * `@pantry-pal/db` and both apps read one list.
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

/**
 * Development-only identity. With `DEV_AUTH=true` the backend trusts this header
 * (and the same key in the Socket.IO handshake `auth` payload) to name the
 * caller. It is a stand-in for real authentication and refuses to start in
 * production.
 */
export const DEV_USER_HEADER = 'x-dev-user-email';
export const DEV_USER_HANDSHAKE_KEY = 'devUserEmail';

/** Admin routes authenticate with this header rather than a user identity. */
export const ADMIN_API_KEY_HEADER = 'x-admin-api-key';

/**
 * Server -> client events.
 *
 * Every payload carries a `householdId` (directly or on the entity), so a client
 * following several households can route each event without extra lookups.
 */
export const PANTRY_EVENT = {
  Snapshot: 'pantry:snapshot',
  ItemCreated: 'pantry:item-created',
  ItemUpdated: 'pantry:item-updated',
  ItemDeleted: 'pantry:item-deleted',
  LocationCreated: 'pantry:location-created',
  LocationUpdated: 'pantry:location-updated',
  LocationDeleted: 'pantry:location-deleted',
  LocationsReordered: 'pantry:locations-reordered',
  LocationsUpserted: 'pantry:locations-upserted',
  HouseholdUpdated: 'pantry:household-updated',
  HouseholdDeleted: 'pantry:household-deleted',
  MemberAdded: 'pantry:member-added',
  MemberUpdated: 'pantry:member-updated',
  MemberRemoved: 'pantry:member-removed',
} as const;
export type PantryEventName = (typeof PANTRY_EVENT)[keyof typeof PANTRY_EVENT];

/** Client -> server commands. Each names the household it acts on. */
export const PANTRY_COMMAND = {
  Sync: 'pantry:sync',
  CreateItem: 'pantry:create-item',
  DeleteItem: 'pantry:delete-item',
} as const;
export type PantryCommandName = (typeof PANTRY_COMMAND)[keyof typeof PANTRY_COMMAND];

/**
 * Categories themselves are rows in the `categories` table (served by
 * `GET /categories`), so adding one is an INSERT through the admin API.
 *
 * This is the one fixed code: the catch-all a new item starts in. It cannot be
 * deleted.
 */
export const DEFAULT_CATEGORY = 'other';

/**
 * Units themselves are rows in the `units` table (served by `GET /units`), so
 * adding one is an INSERT. Only their classification is fixed here.
 *
 * Conversions never bridge two kinds: `oz` is mass, `fl oz` is volume.
 */
export const UNIT_KINDS = ['mass', 'volume', 'count'] as const;
export const UNIT_SYSTEMS = ['metric', 'imperial', 'both'] as const;

/**
 * The kind of every unit an item is counted in — `pcs`, `bottle`, `can` — as
 * opposed to its size, which may be of any kind: `2 cans × 400 g`. Loose goods
 * are counted too, in what holds them: `1 bag × 2 kg` of rice.
 *
 * The database enforces it: `items.unit` references a unit's code and kind
 * together, with the kind pinned to this value.
 */
export const QUANTITY_UNIT_KIND = 'count' satisfies (typeof UNIT_KINDS)[number];

/**
 * Plain pieces: the unit a new item starts in, and the one count unit with no
 * noun of its own, so `2 × 400 g` needs no `pcs`. It can be neither deleted nor
 * reclassified.
 */
export const COUNT_UNIT = 'pcs';

/** Which units the create/edit picker offers. A display preference, nothing more. */
export const UNIT_SYSTEM_PREFERENCES = ['metric', 'imperial'] as const;

/**
 * The languages the frontend is translated into, as BCP 47 tags: what a user's
 * `locale` may be set to. The frontend picks its message catalog by the
 * language and formats numbers and dates with the whole tag.
 */
export const SUPPORTED_LOCALES = ['en-GB', 'uk-UA', 'ru-RU'] as const;
/** A new user's language, and the one shown until the account's is known. */
export const DEFAULT_LOCALE = 'en-GB' satisfies (typeof SUPPORTED_LOCALES)[number];

export const HOUSEHOLD_ROLE = {
  Owner: 'owner',
  Member: 'member',
} as const;
export const HOUSEHOLD_ROLES = Object.values(HOUSEHOLD_ROLE);

export const ITEM_STATUS = {
  Active: 'active',
  Consumed: 'consumed',
  Discarded: 'discarded',
} as const;
export const ITEM_STATUSES = Object.values(ITEM_STATUS);

export const ITEM_EVENT_TYPE = {
  Added: 'added',
  Updated: 'updated',
  Opened: 'opened',
  Consumed: 'consumed',
  Discarded: 'discarded',
  Restored: 'restored',
  /** A correction, not waste: kept apart from `discarded` so waste reports stay honest. */
  Deleted: 'deleted',
} as const;
export const ITEM_EVENT_TYPES = Object.values(ITEM_EVENT_TYPE);

/**
 * The name of every household's fallback location: the one that can be neither
 * renamed nor deleted, and where a deleted location's items go when nobody says
 * otherwise. A household gets it on creation (see `withFallbackLocation`).
 */
export const FALLBACK_LOCATION_NAME = 'Other';

/**
 * The code-level fallback for the `default-locations` setting (see
 * `APP_SETTING_DEFAULTS`). An admin can override it at runtime; a new household
 * copies whichever is in force.
 *
 * Location (_where_ a thing is) is a separate axis from category (_what_ it is).
 * A jar of paprika is location "Spices", category "spices"; ibuprofen is
 * location "Medicines", category "medicine".
 */
export const DEFAULT_LOCATIONS = [
  'Kitchen',
  'Fridge',
  'Freezer',
  'Pantry',
  'Spices',
  'Bathroom',
  'Medicines',
  /** Last, like the `other` category: the catch-all for anything unplaced. */
  FALLBACK_LOCATION_NAME,
] as const;

/** An item within this many days of its expiry date counts as "expiring soon". */
export const EXPIRY_WARNING_DAYS = 3;

export const MAX_ITEM_NAME_LENGTH = 80;
/** Quantities are whole numbers — how many — so this bounds an integer. */
export const MAX_ITEM_QUANTITY = 10_000;
/**
 * A size is `numeric(10, 3)` (`1.5` kg): anything finer would be silently
 * rounded by Postgres. Quantities are integers and have no decimals.
 */
export const SIZE_DECIMAL_PLACES = 3;
export const MAX_ITEM_NOTES_LENGTH = 2000;
export const MAX_PERIOD_AFTER_OPENING_DAYS = 3650;

export const MAX_HOUSEHOLD_NAME_LENGTH = 80;
export const MAX_EMAIL_LENGTH = 254;

export const MAX_LOCATION_NAME_LENGTH = 40;
export const MAX_LOCATION_ICON_LENGTH = 32;
export const MAX_LOCATIONS_PER_HOUSEHOLD = 50;

export const MAX_UNIT_CODE_LENGTH = 16;
export const MAX_UNIT_LABEL_LENGTH = 16;

export const MAX_CATEGORY_CODE_LENGTH = 32;
export const MAX_CATEGORY_LABEL_LENGTH = 40;
