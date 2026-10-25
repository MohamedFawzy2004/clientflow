import type { ApiErrorBody, ErrorCode } from '@clientflow/contracts';

export type ClientErrorCode = ErrorCode | 'NETWORK' | 'TIMEOUT';

/** Every failed request becomes an ApiError, so screens can map it to a precise state. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: ClientErrorCode,
    message: string,
    readonly fieldErrors: Record<string, string[]> = {},
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

const TIMEOUT_MS = 15_000;
const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

// Held in memory only. CSRF tokens are never written to localStorage (spec §11.4).
let csrfToken: string | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setCsrfToken(token: string | null) {
  csrfToken = token;
}

/** Called on any 401 from a signed-in request, so the app can clear caches and redirect. */
export function setUnauthenticatedHandler(handler: (() => void) | null) {
  onUnauthenticated = handler;
}

async function fetchCsrfToken(): Promise<string> {
  const res = await rawRequest<{ data: { csrfToken: string } }>('GET', '/api/v1/auth/csrf');
  csrfToken = res.data.csrfToken;
  return csrfToken;
}

async function rawRequest<T>(
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  signal?: AbortSignal,
): Promise<T> {
  const timeout = AbortSignal.timeout(TIMEOUT_MS);
  const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...headers,
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: combined,
    });
  } catch (err) {
    if (timeout.aborted) {
      throw new ApiError(0, 'TIMEOUT', 'The server took too long to respond. Please try again.');
    }
    if (signal?.aborted) throw err;
    throw new ApiError(
      0,
      'NETWORK',
      'We could not reach ClientFlow. Check your connection and try again.',
    );
  }

  const text = await res.text();
  let json: unknown = undefined;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = undefined;
    }
  }
  if (!res.ok) {
    const err = (json as ApiErrorBody | undefined)?.error;
    throw new ApiError(
      res.status,
      err?.code ?? (res.status >= 500 ? 'INTERNAL_ERROR' : 'MALFORMED_REQUEST'),
      err?.message ?? 'Something went wrong. Please try again.',
      err?.fieldErrors ?? {},
      err?.requestId ?? res.headers.get('x-request-id') ?? undefined,
    );
  }
  return json as T;
}

export interface RequestOptions {
  body?: unknown;
  signal?: AbortSignal;
  /** Set for auth endpoints, where a 401 is an expected answer and not a session loss. */
  skipAuthRedirect?: boolean;
}

export async function apiRequest<T>(
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  options: RequestOptions = {},
): Promise<T> {
  const send = async () => {
    const headers: Record<string, string> = {};
    if (MUTATING.has(method)) headers['X-CSRF-Token'] = csrfToken ?? (await fetchCsrfToken());
    return rawRequest<T>(method, path, options.body, headers, options.signal);
  };
  try {
    return await send();
  } catch (err) {
    if (err instanceof ApiError) {
      // A stale CSRF token (e.g. after the server restarted) is refreshed once and retried.
      if (err.code === 'CSRF_INVALID' && MUTATING.has(method)) {
        csrfToken = null;
        return send();
      }
      if (err.status === 401 && !options.skipAuthRedirect) onUnauthenticated?.();
    }
    throw err;
  }
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) => apiRequest<T>('GET', path, options),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('POST', path, { ...options, body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PUT', path, { ...options, body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    apiRequest<T>('PATCH', path, { ...options, body }),
};

/** Reads a one-time token from the URL fragment (#token=…). Pure: safe to call twice. */
export function readTokenFromFragment(): string | null {
  return /(?:^|[#&])token=([A-Za-z0-9_-]+)/.exec(window.location.hash)?.[1] ?? null;
}

/**
 * Removes the fragment from the address bar and history, so the one-time token is not left
 * behind in the browser or copied into a shared screenshot. Idempotent.
 */
export function clearFragment() {
  if (window.location.hash) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
}
