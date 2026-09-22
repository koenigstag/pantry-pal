import { API_BASE_PATH } from '@pantry-pal/shared';

import { backendOrigin } from './backendOrigin';

export class ApiError extends Error {
  readonly status: number;
  /** What some refusals name their reason by, beside the message: an import's `wrong-format`. */
  readonly code: string | undefined;

  constructor(message: string, status: number, code?: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

interface NestErrorBody {
  message?: string | string[];
  error?: string;
  code?: string;
}

async function readError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as NestErrorBody;
    const message = Array.isArray(body.message)
      ? body.message.join('; ')
      : (body.message ?? body.error);
    if (typeof message === 'string') {
      return new ApiError(
        message,
        response.status,
        typeof body.code === 'string' ? body.code : undefined,
      );
    }
  } catch {
    // Non-JSON error body (proxy error, gateway timeout, ...).
  }
  return new ApiError(`${response.status} ${response.statusText}`, response.status);
}

async function fetchOk(path: string, init: RequestInit, accessToken?: string): Promise<Response> {
  const response = await fetch(`${backendOrigin}${API_BASE_PATH}${path}`, {
    ...init,
    headers: {
      // A form sets its own multipart type, boundary included.
      ...(init.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
    },
  });

  if (!response.ok) throw await readError(response);
  return response;
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
  const response = await fetchOk(path, init, accessToken);

  // 204 No Content has no body to parse.
  return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** `send` for a route that answers with a file rather than JSON: the export. */
export async function receive(
  path: string,
  init: RequestInit = {},
  accessToken?: string,
): Promise<Blob> {
  return (await fetchOk(path, init, accessToken)).blob();
}
