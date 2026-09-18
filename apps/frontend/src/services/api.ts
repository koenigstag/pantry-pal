import type {
  AuthSession,
  Category,
  CurrentUser,
  PantryItem,
  PantryLocation,
  ShoppingList,
  ShoppingListEntriesChange,
  ShoppingListEntry,
  ShoppingLists,
  Unit,
  UserHousehold,
} from '@pantry-pal/shared';
import type {
  AddShoppingListEntriesDto,
  ChangePasswordDto,
  CreateHouseholdDto,
  CreatePantryItemDto,
  CreateShoppingListDto,
  DevSignInDto,
  PutAwayShoppingListEntriesDto,
  SignInDto,
  SignUpDto,
  UpdateHouseholdDto,
  UpdateMeDto,
  UpdatePantryItemDto,
  UpdateShoppingListEntryDto,
  UpsertLocationsDto,
  UpsertShoppingListsDto,
} from '@pantry-pal/shared/dto';

import { messages } from '../i18n/messages';
import { ApiError, send } from './http';
import { accessTokenOrStored, refreshAccessToken } from './session';

export { ApiError } from './http';

/**
 * A request as the signed-in user.
 *
 * The access token is refreshed before it expires, so a 401 means the server
 * refused it early, after restarting with a new signing key, say. The token is
 * then refreshed and the request sent once more. A refresh the server refuses
 * ends the session, and the app returns to the sign-in page.
 */
async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const token = await accessTokenOrStored();
  if (token === null) throw new ApiError(messages.auth.sessionEnded, 401);

  try {
    return await send<T>(path, init, token);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;

    const replacement = await refreshAccessToken(token);
    if (replacement === null) throw error;
    return send<T>(path, init, replacement);
  }
}

const household = (householdId: string): string => `/households/${encodeURIComponent(householdId)}`;

const shoppingList = (householdId: string, listId: string): string =>
  `${household(householdId)}/shopping-lists/${encodeURIComponent(listId)}`;

export const pantryApi = {
  me: (): Promise<CurrentUser> => request<CurrentUser>('/me'),

  updateMe: (dto: UpdateMeDto): Promise<CurrentUser> =>
    request<CurrentUser>('/me', { method: 'PATCH', body: JSON.stringify(dto) }),

  /** 403 for a wrong current password. The account's other sessions end. */
  changePassword: (dto: ChangePasswordDto): Promise<void> =>
    request<void>('/me/password', { method: 'POST', body: JSON.stringify(dto) }),

  listHouseholds: (): Promise<UserHousehold[]> => request<UserHousehold[]>('/households'),

  createHousehold: (dto: CreateHouseholdDto): Promise<UserHousehold> =>
    request<UserHousehold>('/households', { method: 'POST', body: JSON.stringify(dto) }),

  /** Owners only: 403 for a member. */
  updateHousehold: (householdId: string, dto: UpdateHouseholdDto): Promise<UserHousehold> =>
    request<UserHousehold>(household(householdId), {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),

  listUnits: (): Promise<Unit[]> => request<Unit[]>('/units'),

  listCategories: (): Promise<Category[]> => request<Category[]>('/categories'),

  listLocations: (householdId: string): Promise<PantryLocation[]> =>
    request<PantryLocation[]>(`${household(householdId)}/locations`),

  /** The locations editor's save: every location in its new order. 409 when the list was stale. */
  upsertLocations: (householdId: string, dto: UpsertLocationsDto): Promise<PantryLocation[]> =>
    request<PantryLocation[]>(`${household(householdId)}/locations`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  listItems: (householdId: string): Promise<PantryItem[]> =>
    request<PantryItem[]>(`${household(householdId)}/items`),

  createItem: (householdId: string, dto: CreatePantryItemDto): Promise<PantryItem> =>
    request<PantryItem>(`${household(householdId)}/items`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  updateItem: (householdId: string, id: string, dto: UpdatePantryItemDto): Promise<PantryItem> =>
    request<PantryItem>(`${household(householdId)}/items/${encodeURIComponent(id)}`, {
      method: 'PATCH',
      body: JSON.stringify(dto),
    }),

  removeItem: (householdId: string, id: string): Promise<void> =>
    request<void>(`${household(householdId)}/items/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    }),

  /** Every list, every entry, and the items the entries name — used-up ones included. */
  listShoppingLists: (householdId: string): Promise<ShoppingLists> =>
    request<ShoppingLists>(`${household(householdId)}/shopping-lists`),

  /** 409 when the household has a list of that name, or has as many lists as it may. */
  createShoppingList: (householdId: string, dto: CreateShoppingListDto): Promise<ShoppingList> =>
    request<ShoppingList>(`${household(householdId)}/shopping-lists`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  /** The shopping lists editor's save: every list in its new order. 409 when the set was stale. */
  upsertShoppingLists: (
    householdId: string,
    dto: UpsertShoppingListsDto,
  ): Promise<ShoppingList[]> =>
    request<ShoppingList[]>(`${household(householdId)}/shopping-lists`, {
      method: 'PUT',
      body: JSON.stringify(dto),
    }),

  /** Answers with the entries it created: items already on the list are left alone. */
  addShoppingListEntries: (
    householdId: string,
    listId: string,
    dto: AddShoppingListEntriesDto,
  ): Promise<ShoppingListEntriesChange> =>
    request<ShoppingListEntriesChange>(`${shoppingList(householdId, listId)}/entries`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),

  updateShoppingListEntry: (
    householdId: string,
    listId: string,
    entryId: string,
    dto: UpdateShoppingListEntryDto,
  ): Promise<ShoppingListEntry> =>
    request<ShoppingListEntry>(
      `${shoppingList(householdId, listId)}/entries/${encodeURIComponent(entryId)}`,
      { method: 'PATCH', body: JSON.stringify(dto) },
    ),

  removeShoppingListEntry: (householdId: string, listId: string, entryId: string): Promise<void> =>
    request<void>(`${shoppingList(householdId, listId)}/entries/${encodeURIComponent(entryId)}`, {
      method: 'DELETE',
    }),

  /** Restocks the ticked-off entries and takes them off the list; 409 when the list changed. */
  putAwayShoppingListEntries: (
    householdId: string,
    listId: string,
    dto: PutAwayShoppingListEntriesDto,
  ): Promise<PantryItem[]> =>
    request<PantryItem[]>(`${shoppingList(householdId, listId)}/put-away`, {
      method: 'POST',
      body: JSON.stringify(dto),
    }),
};

export type PantryApi = typeof pantryApi;

/** The routes that hand out a session, and so need none. Refreshing and signing out live in `session.ts`. */
export const authApi = {
  signIn: (dto: SignInDto): Promise<AuthSession> =>
    send<AuthSession>('/auth/sign-in', { method: 'POST', body: JSON.stringify(dto) }),

  signUp: (dto: SignUpDto): Promise<AuthSession> =>
    send<AuthSession>('/auth/sign-up', { method: 'POST', body: JSON.stringify(dto) }),

  /** 404 unless the backend runs with `DEV_AUTH=true`. */
  devSignIn: (dto: DevSignInDto): Promise<AuthSession> =>
    send<AuthSession>('/auth/dev-sign-in', { method: 'POST', body: JSON.stringify(dto) }),
};

export type AuthApi = typeof authApi;
