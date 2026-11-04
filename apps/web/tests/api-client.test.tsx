// QA regression tests for the shared API client (lib/api.ts). Every screen relies on it to turn
// failures into precise states, so its edge cases are pinned here: network loss, timeouts,
// non-JSON error pages, a stale CSRF token, and session loss (401) versus expected auth 401s.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, api, setCsrfToken, setUnauthenticatedHandler } from '../src/lib/api';

type Handler = (url: string, init: RequestInit) => Response | Promise<Response>;

function json(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

let calls: { url: string; init: RequestInit }[] = [];
function mockFetch(handler: Handler) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

const header = (i: number, name: string) =>
  (calls[i]!.init.headers as Record<string, string>)[name];

beforeEach(() => {
  setCsrfToken(null);
  setUnauthenticatedHandler(null);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('API client failures become precise ApiErrors', () => {
  it('a network failure is NETWORK with status 0, never a success', async () => {
    mockFetch(() => {
      throw new TypeError('Failed to fetch');
    });
    const err = await api.get('/api/v1/leads').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: 'NETWORK' });
  });

  it('a request that never answers ends as TIMEOUT', async () => {
    mockFetch(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        }),
    );
    const err = await api
      .get('/api/v1/leads', { timeoutMs: 20 })
      .catch((e: unknown) => e as ApiError);
    expect(err).toMatchObject({ status: 0, code: 'TIMEOUT' });
  });

  it('a non-JSON 502 page from a proxy maps to INTERNAL_ERROR with the request id header', async () => {
    mockFetch(
      () =>
        new Response('<html>Bad gateway</html>', {
          status: 502,
          headers: { 'x-request-id': 'req-123' },
        }),
    );
    const err = (await api.get('/api/v1/leads').catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 502, code: 'INTERNAL_ERROR', requestId: 'req-123' });
    expect(err.message).not.toContain('<html>');
  });

  it('keeps the server code, message and field errors from an error body', async () => {
    mockFetch(() =>
      json(409, {
        error: {
          code: 'CONFLICT_STALE_VERSION',
          message: 'Someone else changed this record.',
          fieldErrors: { version: ['Reload and try again.'] },
          requestId: 'req-9',
        },
      }),
    );
    const err = (await api
      .patch('/api/v1/leads/1', { version: 1 })
      .catch((e: unknown) => e)) as ApiError;
    expect(err).toMatchObject({ status: 409, code: 'CONFLICT_STALE_VERSION', requestId: 'req-9' });
    expect(err.fieldErrors.version).toEqual(['Reload and try again.']);
  });
});

describe('CSRF handling', () => {
  it('fetches a token before the first write and sends it in X-CSRF-Token', async () => {
    mockFetch((url) =>
      url.endsWith('/auth/csrf') ? json(200, { data: { csrfToken: 't1' } }) : json(201, {}),
    );
    await api.post('/api/v1/leads', { name: 'x' });
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/auth/csrf', '/api/v1/leads']);
    expect(header(1, 'X-CSRF-Token')).toBe('t1');
  });

  it('reads never send or fetch a CSRF token', async () => {
    mockFetch(() => json(200, { data: [] }));
    await api.get('/api/v1/leads');
    expect(calls).toHaveLength(1);
    expect(header(0, 'X-CSRF-Token')).toBeUndefined();
  });

  it('a stale token (CSRF_INVALID) is refreshed and the write retried exactly once', async () => {
    let tokens = 0;
    let writes = 0;
    mockFetch((url) => {
      if (url.endsWith('/auth/csrf')) return json(200, { data: { csrfToken: `t${++tokens}` } });
      writes++;
      return json(403, { error: { code: 'CSRF_INVALID', message: 'Invalid token' } });
    });
    setCsrfToken('stale');
    const err = (await api.post('/api/v1/leads', {}).catch((e: unknown) => e)) as ApiError;
    // One retry with a fresh token, then the error is surfaced instead of looping.
    expect(writes).toBe(2);
    expect(tokens).toBe(1);
    expect(header(0, 'X-CSRF-Token')).toBe('stale');
    expect(header(2, 'X-CSRF-Token')).toBe('t1');
    expect(err.code).toBe('CSRF_INVALID');
  });
});

describe('session loss', () => {
  it('a 401 on a signed-in request calls the unauthenticated handler once', async () => {
    const lost = vi.fn();
    setUnauthenticatedHandler(lost);
    mockFetch(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Sign in' } }));
    await expect(api.get('/api/v1/leads')).rejects.toMatchObject({ status: 401 });
    expect(lost).toHaveBeenCalledTimes(1);
  });

  it('an expected 401 on an auth endpoint (skipAuthRedirect) does not end the session', async () => {
    const lost = vi.fn();
    setUnauthenticatedHandler(lost);
    mockFetch(() => json(401, { error: { code: 'UNAUTHENTICATED', message: 'Wrong password' } }));
    await expect(api.get('/api/v1/auth/me', { skipAuthRedirect: true })).rejects.toMatchObject({
      status: 401,
    });
    expect(lost).not.toHaveBeenCalled();
  });

  it('a 403 is a permission answer, not a session loss', async () => {
    const lost = vi.fn();
    setUnauthenticatedHandler(lost);
    mockFetch(() => json(403, { error: { code: 'FORBIDDEN', message: 'No access' } }));
    await expect(api.get('/api/v1/team')).rejects.toMatchObject({ status: 403 });
    expect(lost).not.toHaveBeenCalled();
  });
});

describe('uploads', () => {
  it('stream the raw file with an encoded name and the long upload timeout', async () => {
    mockFetch((url) =>
      url.endsWith('/auth/csrf') ? json(200, { data: { csrfToken: 't' } }) : json(201, {}),
    );
    const file = new File(['abc'], 'brief (v2) ü.pdf', { type: 'application/pdf' });
    await api.upload('/api/v1/projects/p/files', file);
    expect(header(1, 'Content-Type')).toBe('application/octet-stream');
    expect(header(1, 'X-File-Name')).toBe(encodeURIComponent('brief (v2) ü.pdf'));
    expect(calls[1]!.init.body).toBe(file);
  });
});
