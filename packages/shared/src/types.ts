import type {
  ASSISTANT_ACTION,
  HOUSEHOLD_ROLE,
  ImportSkipReason,
  ImportSource,
  ITEM_EVENT_TYPE,
  ITEM_STATUS,
  PushTopic,
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
  /**
   * `YYYY-MM-DD`, or `null` until the user gives it. Only the user sees it:
   * household members get a `HouseholdMember`, which leaves it out.
   */
  birthDate: string | null;
  /**
   * Whether the account signs in with a password. Accounts made by the
   * development sign-in have none until an administrator sets one, so they have
   * no password to change either.
   */
  hasPassword: boolean;
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

/**
 * A storage space every new household starts with, as the admin API shows it.
 * The household gets a copy named in its creator's language, and owns it from
 * then on: changing a default never reaches an existing household.
 */
export interface DefaultLocation {
  /** Stable: translations reference it. Lowercase words joined by hyphens: `spices`. */
  code: string;
  /** English: the name wherever no translation applies. */
  name: string;
  icon: string | null;
  /** The new household's fallback location. Exactly one default is. */
  isFallback: boolean;
  /**
   * Names by BCP 47 tag. A household takes its creator's exact tag, else that
   * tag's language, else `name` — so most keys are languages (`fr`), and a
   * regional key (`fr-CA`) exists only where the wording differs.
   */
  translations: Record<string, string>;
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

/**
 * One unit of an item: a carton, a tube, a blister. An item's units can differ —
 * one opened and half used, the others sealed with a later printed date — so
 * each has dates and a fill level of its own.
 */
export interface SubItem {
  id: string;
  /** The printed date, `YYYY-MM-DD`. */
  expiresAt: string | null;
  openedAt: string | null;
  /** The "12M" symbol on cosmetics and syrups, in days. */
  periodAfterOpeningDays: number | null;
  /**
   * The earlier of the printed date and `openedAt + periodAfterOpeningDays`,
   * computed by the database. **Read this for expiry status, never `expiresAt`.**
   */
  effectiveExpiresAt: string | null;
  /**
   * How much is left, in percent: `FULL_FILL_PERCENT` down to `MIN_FILL_PERCENT`.
   * Below full, the unit has been opened. An empty one is used up instead.
   */
  fillPercent: number;
  /**
   * `active` for every unit the server sends: one used up, thrown out or
   * deleted leaves its item's list. The offline mirror marks one `consumed` or
   * `discarded` until the server has taken that change.
   */
  status: ItemStatus;
  createdAt: string;
  updatedAt: string;
}

/**
 * Things of one kind in one place — milk in the fridge — as a whole: what they
 * are, how many, and the dates of the one to use first. Each unit is a
 * `SubItem`.
 */
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
  /**
   * How many, as a whole number: its active units. A fractional amount is a
   * size: `1 × 1.5 kg`.
   */
  quantity: number;
  /** The `Unit.code` of a count unit: what is counted, such as `pcs`, `bottle` or `can`. */
  unit: string;
  /** What is inside one, e.g. `300` for a 300 ml can. A unit of any kind. */
  sizeValue: number | null;
  sizeUnit: string | null;
  /*
   * The four dates below are the item's lead unit's: the active unit that
   * expires first — or, with none active, the unit changed last, so an item
   * used up keeps showing the dates it had. See `leadSubItem`.
   */
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
  /**
   * Its units on the shelf, oldest first: every active one. An item used up or
   * thrown out as a whole keeps its units, so restoring it brings them back.
   */
  subItems: SubItem[];
  notes: string | null;
  status: ItemStatus;
  /**
   * The shopping list the item goes on by itself when it runs out — used up,
   * thrown out, or down to zero — or `null` for none.
   */
  defaultShoppingListId: string | null;
  createdAt: string;
  updatedAt: string;
}

export type ExpiryStatus = 'fresh' | 'expiring-soon' | 'expired' | 'unknown';

/** A named list of things a household means to buy. */
export interface ShoppingList {
  id: string;
  householdId: string;
  name: string;
  /** Ascending: the order lists are shown in. A new list appends. */
  sortOrder: number;
  /**
   * When the list was archived, or `null` while it is in use. An archived list
   * is frozen: nothing is added to it or changed on it — not even by an item
   * running out that has it as its default — until it is restored, and clients
   * show it only where lists are managed.
   */
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * An item on a shopping list, and how many to buy. It names the item rather
 * than copying it, so putting the shopping away restocks that same item — even
 * one used up meanwhile. An item is on a list at most once.
 */
export interface ShoppingListEntry {
  id: string;
  householdId: string;
  listId: string;
  itemId: string;
  /** How many to buy, counted in the item's own unit. */
  quantity: number;
  /** When it was ticked off while shopping; `null` while it is still to buy. */
  checkedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Entries a write created or changed, with the items they name. */
export interface ShoppingListEntriesChange {
  entries: ShoppingListEntry[];
  /**
   * The items the entries name, whatever their status. An item used up or
   * thrown out is off the shelf, so it is not among the active items a client
   * holds, and the entry would have nothing to show without it.
   */
  items: PantryItem[];
}

/** A household's shopping lists, in display order, with everything on them. */
export interface ShoppingLists extends ShoppingListEntriesChange {
  lists: ShoppingList[];
}

/* Socket payloads. */

export interface PantrySnapshotPayload {
  householdId: string;
  /** Active items only, most urgent first. */
  items: PantryItem[];
  locations: PantryLocation[];
  shopping: ShoppingLists;
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

export interface ShoppingListPayload {
  list: ShoppingList;
}

/**
 * A list was deleted, and every entry on it with it. Items that went on it by
 * default are announced separately, as item updates.
 */
export interface ShoppingListDeletedPayload {
  householdId: string;
  id: string;
}

/**
 * The shopping lists editor saved: additions, renames, archiving and deletions
 * arrive as one list. A list missing from it was deleted, with its entries;
 * items that went on it by default are announced separately, as item updates.
 */
export interface ShoppingListsUpsertedPayload {
  householdId: string;
  /** Every list, archived ones included, in display order. Replaces the client's lists. */
  lists: ShoppingList[];
}

/** Entries added to lists, or changed: the quantity, or ticked off. */
export interface ShoppingListEntriesUpsertedPayload extends ShoppingListEntriesChange {
  householdId: string;
}

/** Entries taken off their lists: removed, put away, or their item deleted. */
export interface ShoppingListEntriesDeletedPayload {
  householdId: string;
  ids: string[];
}

/**
 * Where a pull left off. Documents are ordered by when they last changed, with
 * the id breaking ties, so this pair names one document exactly and a client
 * asking again from it misses nothing and repeats at most that one.
 */
export interface SyncCheckpoint {
  updatedAt: string;
  id: string;
}

/**
 * A document as the offline mirror holds it: the shape the API already returns,
 * plus whether the row is gone. A deleted row is still sent — that is how a
 * client that was away learns to drop it — so `_deleted` is what it reads,
 * never the absence of a document.
 */
export type SyncDocument<T> = T & { _deleted: boolean };

/**
 * One local change on its way to the server: the document as the client last
 * had it from the server (absent for one it created), and as it is now.
 */
export interface SyncPushRow<T> {
  assumedMasterState?: SyncDocument<T>;
  newDocumentState: SyncDocument<T>;
}

/** A change the server would not take, and why, in the server's words. */
export interface SyncRefusal {
  id: string;
  message: string;
}

/** What a push answers. */
export interface SyncPushResult<T> {
  /**
   * The server's version of every document whose change was not applied as
   * sent: because the client's base was stale, or because it was refused.
   */
  conflicts: SyncDocument<T>[];
  /** The refused ones among them, so the client can say why instead of retrying. */
  refused: SyncRefusal[];
}

/** One pull: documents in checkpoint order, and where to continue. */
export interface SyncPullPayload<T> {
  documents: SyncDocument<T>[];
  /** `null` only when the household has no documents at all in this collection. */
  checkpoint: SyncCheckpoint | null;
}

/** A row an import left out, while it took the rest of the file. */
export interface ImportSkippedRow {
  /** The sheet the row is on: a backup has several. */
  sheet: string;
  /** Numbered as a spreadsheet numbers it, the header being row 1. */
  row: number;
  /** What the row names, when it names anything. */
  name: string | null;
  reason: ImportSkipReason;
}

/**
 * What an import did. Nothing is ever replaced: the file's storage spaces,
 * items and units join what the household has.
 *
 * The item counts are of the household's items, each counted once, in one of
 * the four. Rows of one file can land in one item — the same name in the same
 * storage space — which is then counted as what happened to it first: two
 * rows making one new item are one created item.
 */
export interface ImportSummary {
  source: ImportSource;
  /** Items the household did not have. */
  createdItems: number;
  /** Items it had — the same one, or one of that name in that storage space — which took units from the file. */
  updatedItems: number;
  /** Items of a backup of this household that had been deleted since, back on their shelf. */
  restoredItems: number;
  /** Items it had with nothing to add: every unit the file lists is there, or there is no room for more. */
  unchangedItems: number;
  /** Units written, across all of them. */
  addedUnits: number;
  /** Storage spaces the import created, as named, in the order it created them. */
  createdLocations: string[];
  /** Items that reached `MAX_ITEM_QUANTITY`, by name, with how many of the file's units did not fit. */
  capped: Array<{ name: string; units: number }>;
  skipped: ImportSkippedRow[];
}

/*
 * The text assistant. It reads what someone wrote — "в холодильнике молоко, два
 * пакета до пятницы" — and proposes changes, which apply only once the user has
 * seen them in a preview and kept them. Every action names what it acts on by
 * id, and `quote` is the part of the text it came from, for the preview.
 */

/** Units alike, as an action adds them: three sealed packs, or one opened and half used. */
export interface AssistantUnitGroup {
  /** How many units are in this state. */
  count: number;
  /** The printed date, `YYYY-MM-DD`. */
  expiresAt: string | null;
  /** `null` with a fill under full takes the day the change is applied: a used unit was opened. */
  openedAt: string | null;
  periodAfterOpeningDays: number | null;
  /** `MIN_FILL_PERCENT` to `FULL_FILL_PERCENT`. */
  fillPercent: number;
}

interface AssistantActionBase {
  /** The words of the text the action comes from. */
  quote: string;
}

/**
 * A new item, or more units of the active item of that name in that storage
 * space if the household has one, as an import adds them.
 */
export interface AssistantAddItemAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.AddItem;
  locationId: string;
  name: string;
  /** A category code; one the server does not have becomes the default category. */
  category: string;
  /** A count unit's code; any other becomes `pcs`. */
  unit: string;
  sizeValue: number | null;
  sizeUnit: string | null;
  units: AssistantUnitGroup[];
}

export interface AssistantAddUnitsAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.AddUnits;
  itemId: string;
  units: AssistantUnitGroup[];
}

/** How many there are now, as stepping the quantity sets it. */
export interface AssistantSetQuantityAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.SetQuantity;
  itemId: string;
  quantity: number;
}

/**
 * `count` units used up or thrown out, those to go first; `null`, or as many as
 * it has, the whole item.
 */
export interface AssistantUseUpAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.UseUp;
  itemId: string;
  count: number | null;
}

export interface AssistantDiscardAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.Discard;
  itemId: string;
  count: number | null;
}

/** One unit's state. A `null` field is left as it is. */
export interface AssistantUpdateUnitAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.UpdateUnit;
  itemId: string;
  subItemId: string;
  expiresAt: string | null;
  openedAt: string | null;
  fillPercent: number | null;
}

export interface AssistantMoveItemAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.MoveItem;
  itemId: string;
  locationId: string;
}

/** A thing to buy that the household has never had: made as an item that ran out. */
export interface AssistantNewListItem {
  name: string;
  category: string;
  unit: string;
  /** Where it goes once bought. */
  locationId: string;
}

/** Exactly one of `itemId` and `newItem`. */
export interface AssistantAddToListAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.AddToList;
  listId: string;
  itemId: string | null;
  newItem: AssistantNewListItem | null;
  quantity: number;
}

export interface AssistantCheckEntryAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.CheckEntry;
  entryId: string;
  checked: boolean;
}

/** As the Bought button does: the item restocked by the entry's quantity, the entry off its list. */
export interface AssistantBuyEntryAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.BuyEntry;
  entryId: string;
}

export interface AssistantRemoveEntryAction extends AssistantActionBase {
  type: typeof ASSISTANT_ACTION.RemoveEntry;
  entryId: string;
}

export type AssistantAction =
  | AssistantAddItemAction
  | AssistantAddUnitsAction
  | AssistantSetQuantityAction
  | AssistantUseUpAction
  | AssistantDiscardAction
  | AssistantUpdateUnitAction
  | AssistantMoveItemAction
  | AssistantAddToListAction
  | AssistantCheckEntryAction
  | AssistantBuyEntryAction
  | AssistantRemoveEntryAction;

/** Part of the text the assistant could not turn into a change. */
export interface AssistantUnresolved {
  quote: string;
  /**
   * Why, in the user's language, as the model put it; `null` when the server
   * turned a proposal down — one naming something the household does not have,
   * say — and the client says so in its own words.
   */
  reason: string | null;
}

/** What `POST .../assistant/interpret` answers: proposals only, nothing written. */
export interface AssistantInterpretation {
  actions: AssistantAction[];
  unresolved: AssistantUnresolved[];
}

/** `GET /assistant`: whether this server has the assistant, so clients can hide it when not. */
export interface AssistantStatus {
  enabled: boolean;
}

/** What `POST .../assistant/apply` answers once every action kept has been applied. */
export interface AssistantApplyResult {
  applied: number;
}

/*
 * Connecting an assistant elsewhere — claude.ai, ChatGPT — over MCP. It asks
 * through OAuth; the user allows or denies it on the consent page, and can
 * disconnect it later from their profile.
 */

/** A pending authorization request, as the consent page shows it. */
export interface OAuthConsentRequest {
  id: string;
  /** The name the client registered itself with, or its redirect's host when it gave none. */
  clientName: string;
  /** Where the answer goes, so the user can tell a client that only borrows a known name. */
  redirectHost: string;
  scopes: string[];
  expiresAt: string;
}

/** Where to send the browser after the user answered: the client's redirect URI, with the code or the error. */
export interface OAuthRedirect {
  redirectTo: string;
}

/** `GET /me/connections`: where to connect an assistant, and the ones connected. */
export interface OAuthConnections {
  /** The MCP endpoint's address, to paste into claude.ai's or ChatGPT's connector settings. */
  mcpUrl: string;
  connections: OAuthConnection[];
}

/** An assistant the user connected, as their profile lists it. */
export interface OAuthConnection {
  id: string;
  clientName: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/*
 * Push notifications: a browser registers itself as one of the caller's
 * devices, with the topics it wants, and the server sends to it while the app
 * is closed.
 */

/** `GET /push`: the key a browser subscribes with, or `null` while this server has push turned off. */
export interface PushStatus {
  publicKey: string | null;
}

/** A browser the caller registered for notifications. */
export interface PushDevice {
  id: string;
  /** The push service's URL for this browser: how a client recognises its own row. */
  endpoint: string;
  topics: PushTopic[];
  createdAt: string;
}

/**
 * What a notification carries to the service worker, already in its
 * recipient's language: a worker has no catalog to word it with.
 */
export interface PushPayload {
  title: string;
  body: string;
  /** A route of the app, such as `SHOPPING_ROUTE`, opened when the notification is tapped. */
  path: string;
  /** Notifications with the same tag replace one another rather than stacking up. */
  tag?: string;
}

/** What `POST /push/test` answers: how many of this session's devices the push service took it for. */
export interface PushTestResult {
  sent: number;
}
