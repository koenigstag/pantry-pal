import { API_BASE_PATH, type PantryItem } from '@pantry-pal/shared';
import type { CreatePantryItemDto, UpdatePantryItemDto } from '@pantry-pal/shared/dto';

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
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  // 204 No Content has no body to parse.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

export const pantryApi = {
  list: (): Promise<PantryItem[]> => request<PantryItem[]>('/items'),

  create: (dto: CreatePantryItemDto): Promise<PantryItem> =>
    request<PantryItem>('/items', { method: 'POST', body: JSON.stringify(dto) }),

  update: (id: string, dto: UpdatePantryItemDto): Promise<PantryItem> =>
    request<PantryItem>(`/items/${id}`, { method: 'PATCH', body: JSON.stringify(dto) }),

  remove: (id: string): Promise<void> => request<void>(`/items/${id}`, { method: 'DELETE' }),
};

export type PantryApi = typeof pantryApi;
