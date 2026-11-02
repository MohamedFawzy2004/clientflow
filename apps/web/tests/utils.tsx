import type { ReactElement } from 'react';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { SessionUser } from '@clientflow/contracts';
import { vi } from 'vitest';
import { createQueryClient, Providers } from '../src/app/providers';
import { SESSION_KEY } from '../src/features/auth/session';
import { setCsrfToken } from '../src/lib/api';

export const USER: SessionUser = {
  id: '018f0000-0000-7000-8000-000000000001',
  name: 'Nour Salem',
  email: 'nour@agency.test',
  role: 'SALES',
  agency: {
    id: 'a1',
    name: 'Lumen Digital Studio',
    defaultCurrency: 'EGP',
    timezone: 'Africa/Cairo',
  },
  clientOrg: null,
};

type Handler = (
  url: string,
  init: RequestInit,
) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/** Replaces fetch with a router of fake API responses and records every call. */
export function mockFetch(handler: Handler) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input);
    calls.push({ url, init });
    const { status, body } = await handler(url, init);
    return new Response(body === undefined ? '' : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'req-test-1' },
    });
  });
  vi.stubGlobal('fetch', fn);
  return calls;
}

export function renderRoute(
  element: ReactElement,
  { path = '/', url = '/', user = USER as SessionUser | null } = {},
) {
  const client = createQueryClient();
  client.setDefaultOptions({ queries: { retry: false, staleTime: Infinity } });
  client.setQueryData(SESSION_KEY, user);
  setCsrfToken('test-csrf');
  const router = createMemoryRouter(
    [
      { path, element },
      { path: '*', element: <div>Navigated elsewhere</div> },
    ],
    { initialEntries: [url] },
  );
  return {
    router,
    client,
    ...render(
      <Providers client={client}>
        <RouterProvider router={router} />
      </Providers>,
    ),
  };
}

export const errorBody = (
  code: string,
  message: string,
  fieldErrors: Record<string, string[]> = {},
) => ({
  error: { code, message, fieldErrors, requestId: 'req-test-1' },
});
