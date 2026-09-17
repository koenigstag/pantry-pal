import { API_BASE_PATH } from '@pantry-pal/shared';

import { backendOrigin } from './backendOrigin';

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

/**
 * One request to the backend, knowing nothing of sessions: `api.ts` adds the
 * access token and retries after a refresh, `session.ts` refreshes, and the
 * routes that sign in need no token at all.
 *
 * A failed response throws `ApiError`; no response at all (offline, backend
 * down) throws whatever `fetch` threw.
 */
export async function send<T>(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<T> {
  const response = await fetch(`${backendOrigin}${API_BASE_PATH}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
    },
  });

  if (!response.ok) {
    throw new ApiError(await readErrorMessage(response), response.status);
  }

  // 204 No Content has no body to parse.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}
