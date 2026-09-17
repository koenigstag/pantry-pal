import type {
  HOUSEHOLD_ROLE,
  ITEM_EVENT_TYPE,
  ITEM_STATUS,
  SUPPORTED_LOCALES,
  UNIT_KINDS,
  UNIT_SYSTEM_PREFERENCES,
  UNIT_SYSTEMS,
} from './constants';

export type UnitKind = (typeof UNIT_KINDS)[number];
export type UnitSystem = (typeof UNIT_SYSTEMS)[number];
export type UnitSystemPreference = (typeof UNIT_SYSTEM_PREFERENCES)[number];
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export type HouseholdRole = (typeof HOUSEHOLD_ROLE)[keyof typeof HOUSEHOLD_ROLE];
export type ItemStatus = (typeof ITEM_STATUS)[keyof typeof ITEM_STATUS];
export type ItemEventType = (typeof ITEM_EVENT_TYPE)[keyof typeof ITEM_EVENT_TYPE];

/*
 * Wire types.
 *
 * Instants are ISO-8601 strings rather than `Date`: JSON has no date type, so a
 * `Date` here would be a lie on the frontend after `JSON.parse`. Calendar dates
 * (expiry, opened) are plain `YYYY-MM-DD` strings — a carton expires on a day,
 * not at an instant, so they carry no time zone to misread.
 */

/** The caller, as `GET /me` reports it. */
export interface CurrentUser {
  id: string;
  email: string;
  displayName: string;
  unitSystem: UnitSystemPreference;
  timezone: string;
  /** A BCP 47 tag, such as `en-GB`: the UI language when it is one of `SUPPORTED_LOCALES`. */
  locale: string;
}

/**
 * What sign-up, sign-in and refresh answer with.
 *
 * The access token is a short-lived JWT, sent as `Authorization: Bearer` and in
 * the socket handshake. The refresh token is a JWT too, signed with a different
 * secret, but clients should treat both as opaque. The refresh token is single-use:
 * each refresh replaces it, and presenting a replaced one ends the session.
 */
export interface AuthSession {
  user: CurrentUser;
  accessToken: string;
  accessTokenExpiresAt: string;
  refreshToken: string;
  /** Pushed out by every refresh, so a session in use does not expire. */
  refreshTokenExpiresAt: string;
}

/** A row of the `units` lookup table. */
export interface Unit {
  /** Unambiguous by design: `fl_oz_us` and `fl_oz_uk` differ by 4%. */
  code: string;
  /** Rendered verbatim: `ml`, `fl oz`. */
  label: string;
  kind: UnitKind;
  system: UnitSystem;
  /** To the base unit of its kind (g, ml, pcs). Nothing converts with it yet. */
  factor: number;
}

/** A row of the `categories` lookup table: _what_ a thing is, as a location is where. */
export interface Category {
  /** Stable, since items reference it. Lowercase words joined by hyphens: `personal-care`. */
  code: string;
  /** English. The frontend shows its catalog's name for a code it knows, and this otherwise. */
  label: string;
  /** Ascending: the order pickers list categories in. */
  sortOrder: number;
  /**
   * Food or drink. Items in the category are the same, except in the default
   * category (`other`), where this is only where a new item starts.
   */
  isEdible: boolean;
}

export interface Household {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * A household as one member sees it. The role differs per member, which is why
 * broadcasts carry a plain `Household` instead.
 */
export interface UserHousehold extends Household {
  role: HouseholdRole;
}

export interface HouseholdMember {
  householdId: string;
  userId: string;
  email: string;
  displayName: string;
  role: HouseholdRole;
  joinedAt: string;
}

/**
 * Named `PantryLocation` rather than `Location`, which would shadow the DOM's
 * `window.location` type in the frontend.
 */
export interface PantryLocation {
  id: string;
  householdId: string;
  name: string;
  icon: string | null;
  /** Ascending. Dense (0..n-1) after a reorder; new locations append. */
  sortOrder: number;
  /**
   * The household's one fallback location ("Other"): it cannot be renamed or
   * deleted, and a deleted location's items move to it unless told otherwise.
   */
  isFallback: boolean;
  createdAt: string;
  updatedAt: string;
}

/** One physical package on a shelf, with its own expiry. */
export interface PantryItem {
  id: string;
  householdId: string;
  locationId: string;
  /** The catalog product this batch is an instance of, if any. */
  productId: string | null;
  name: string;
  /** A `Category.code`. */
  category: string;
  /**
   * Food or drink: the category's `isEdible`, except in the default category
   * (`other`), where each item is set on its own.
   */
  isEdible: boolean;
  /** How many, as a whole number. A fractional amount is a size: `1 × 1.5 kg`. */
  quantity: number;
  /** The `Unit.code` of a count unit: what is counted, such as `pcs`, `bottle` or `can`. */
  unit: string;
  /** What is inside one, e.g. `300` for a 300 ml can. A unit of any kind. */
  sizeValue: number | null;
  sizeUnit: string | null;
  /** The printed date, `YYYY-MM-DD`. */
  expiresAt: string | null;
  openedAt: string | null;
  /** The "12M" symbol on cosmetics and syrups, in days. */
  periodAfterOpeningDays: number | null;
  /**
   * The earlier of the printed date and `openedAt + periodAfterOpeningDays`,
   * computed by the database. **Read this for expiry status, never `expiresAt`**
   * — an opened jar would otherwise report fresh until its printed date.
   */
  effectiveExpiresAt: string | null;
  notes: string | null;
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

export type ExpiryStatus = 'fresh' | 'expiring-soon' | 'expired' | 'unknown';

/* Socket payloads. */

export interface PantrySnapshotPayload {
  householdId: string;
  /** Active items only, most urgent first. */
  items: PantryItem[];
  locations: PantryLocation[];
  serverTime: string;
}

export interface PantryItemPayload {
  item: PantryItem;
}

export interface PantryItemDeletedPayload {
  householdId: string;
  id: string;
}

export interface PantryLocationPayload {
  location: PantryLocation;
}

export interface PantryLocationDeletedPayload {
  householdId: string;
  id: string;
}

export interface PantryLocationsReorderedPayload {
  householdId: string;
  /** Every active location, in the new order. */
  locations: PantryLocation[];
}

/**
 * The locations editor saved: renames, additions, deletions and the new order
 * arrive as one list, so no client renders a half-applied edit. Items moved out
 * of a deleted location are announced separately, as item updates.
 */
export interface PantryLocationsUpsertedPayload {
  householdId: string;
  /** Every active location, in the new order. Replaces the client's list. */
  locations: PantryLocation[];
}

export interface HouseholdPayload {
  household: Household;
}

export interface HouseholdDeletedPayload {
  householdId: string;
}

export interface HouseholdMemberPayload {
  member: HouseholdMember;
}

export interface HouseholdMemberRemovedPayload {
  householdId: string;
  userId: string;
}
