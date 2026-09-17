import type {
  AuthSession,
  Category,
  CurrentUser,
  PantryItem,
  PantryLocation,
  Unit,
  UserHousehold,
} from '@pantry-pal/shared';
import type {
  ChangePasswordDto,
  CreateHouseholdDto,
  CreatePantryItemDto,
  DevSignInDto,
  SignInDto,
  SignUpDto,
  UpdateMeDto,
  UpdatePantryItemDto,
  UpsertLocationsDto,
} from '@pantry-pal/shared/dto';

import { messages } from '../i18n/messages';
import { ApiError, send } from './http';
import { accessToken, refreshAccessToken } from './session';

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
  const token = await accessToken();
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
