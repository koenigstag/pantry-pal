import {
  API_BASE_PATH,
  DEV_USER_HEADER,
  type Category,
  type CurrentUser,
  type PantryItem,
  type PantryLocation,
  type Unit,
  type UserHousehold,
} from '@pantry-pal/shared';
import type {
  CreateHouseholdDto,
  CreatePantryItemDto,
  UpdatePantryItemDto,
  UpsertLocationsDto,
} from '@pantry-pal/shared/dto';

import { devUserEmail } from './identity';

export class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

interface NestErrorBody {
  message?: string | string[];
  error?: string;
}

async function readErrorMessage(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as NestErrorBody;
    if (Array.isArray(body.message)) return body.message.join('; ');
    if (typeof body.message === 'string') return body.message;
    if (typeof body.error === 'string') return body.error;
  } catch {
    // Non-JSON error body (proxy error, gateway timeout, ...).
  }
  return `${response.status} ${response.statusText}`;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE_PATH}${path}`, {
    headers: { 'Content-Type': 'application/json', [DEV_USER_HEADER]: devUserEmail },
    ...init,
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  // 204 No Content has no body to parse.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

const household = (householdId: string): string => `/households/${encodeURIComponent(householdId)}`;

export const pantryApi = {
  me: (): Promise<CurrentUser> => request<CurrentUser>('/me'),

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
