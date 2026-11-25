import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage, safeNextPath } from '../src/features/auth/LoginPage';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

describe('safeNextPath', () => {
  it('only allows internal app paths (no open redirect)', () => {
    expect(safeNextPath('/app/leads?q=a')).toBe('/app/leads?q=a');
    expect(safeNextPath('https://evil.example')).toBe('/app/dashboard');
    expect(safeNextPath('//evil.example/app')).toBe('/app/dashboard');
    expect(safeNextPath('/app\\..\\evil')).toBe('/app/dashboard');
    expect(safeNextPath(null)).toBe('/app/dashboard');
  });
});

describe('LoginPage', () => {
  it('labels its fields and validates before calling the API', async () => {
    const calls = mockFetch(() => ({ status: 500 }));
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter an email address.')).toBeInTheDocument();
    expect(screen.getByText('Enter your password.')).toBeInTheDocument();
    expect(screen.getByLabelText(/^Email/)).toHaveAttribute('aria-invalid', 'true');
    // No sign-in call; the only request is the page asking whether this is a public demo.
    expect(calls.map((c) => c.url)).toEqual(['/api/v1/demo/accounts']);
  });

  it('shows one generic message for wrong credentials and clears the password', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/csrf')) return { status: 200, body: { data: { csrfToken: 'pre' } } };
      return { status: 401, body: errorBody('UNAUTHENTICATED', 'Email or password is incorrect.') };
    });
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    await userEvent.type(screen.getByLabelText(/^Email/), 'nour@agency.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'wrong-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Email or password is incorrect.');
    expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  });

  it('explains throttling when the API returns 429', async () => {
    mockFetch((url) =>
      url.endsWith('/auth/csrf')
        ? { status: 200, body: { data: { csrfToken: 'pre' } } }
        : { status: 429, body: errorBody('RATE_LIMITED', 'Too many attempts.') },
    );
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    await userEvent.type(screen.getByLabelText(/^Email/), 'nour@agency.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'whatever-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Too many sign-in attempts.');
  });

  it('sends the CSRF token and redirects to a safe next path on success', async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith('/auth/csrf'))
        return { status: 200, body: { data: { csrfToken: 'pre-token' } } };
      return {
        status: 200,
        body: { data: { user: USER, csrfToken: 'session-token' }, meta: { requestId: 'r' } },
      };
    });
    const { router } = renderRoute(<LoginPage />, {
      path: '/login',
      url: '/login?next=/app/leads',
      user: null,
    });
    await userEvent.type(screen.getByLabelText(/^Email/), 'nour@agency.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'correct-password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/leads'));
    const loginCall = calls.find((c) => c.url.endsWith('/auth/login'))!;
    expect((loginCall.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('pre-token');
    expect(loginCall.init.credentials).toBe('same-origin');
  });
});

describe('LoginPage on a public demo (ADR-071)', () => {
  const ACCOUNTS = [
    { role: 'OWNER', name: 'Layla Hassan' },
    { role: 'PM', name: 'Omar Farouk' },
  ];

  it('offers no demo sign-in on a normal deployment', async () => {
    mockFetch((url) =>
      url.endsWith('/demo/accounts')
        ? { status: 404, body: errorBody('NOT_FOUND', 'Not found.') }
        : { status: 500 },
    );
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole('heading', { name: 'Explore the demo' })).not.toBeInTheDocument(),
    );
  });

  it('signs in as a role without a password, then opens the app', async () => {
    const calls = mockFetch((url) => {
      if (url.endsWith('/demo/accounts'))
        return { status: 200, body: { data: ACCOUNTS, meta: { requestId: 'r' } } };
      if (url.endsWith('/auth/csrf')) return { status: 200, body: { data: { csrfToken: 'pre' } } };
      return {
        status: 200,
        body: {
          data: { user: { ...USER, role: 'PM' }, csrfToken: 'session-token' },
          meta: { requestId: 'r' },
        },
      };
    });
    const { router } = renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    expect(await screen.findByRole('heading', { name: 'Explore the demo' })).toBeInTheDocument();
    expect(screen.getByText(/No emails are sent, there are no payments/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Explore as Project manager/ }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/dashboard'));
    const signIn = calls.find((c) => c.url.endsWith('/demo/sessions'))!;
    expect(JSON.parse(String(signIn.init.body))).toEqual({ role: 'PM' });
    expect(new Headers(signIn.init.headers).get('X-CSRF-Token')).toBe('pre');
  });

  it('explains a throttled demo sign-in', async () => {
    mockFetch((url) => {
      if (url.endsWith('/demo/accounts'))
        return { status: 200, body: { data: ACCOUNTS, meta: { requestId: 'r' } } };
      if (url.endsWith('/auth/csrf')) return { status: 200, body: { data: { csrfToken: 'pre' } } };
      return { status: 429, body: errorBody('RATE_LIMITED', 'Too many attempts.') };
    });
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    await userEvent.click(await screen.findByRole('button', { name: /Explore as Owner/ }));
    expect(await screen.findByText(/Too many demo sign-ins from your address/)).toBeInTheDocument();
  });
});

describe('LoginPage with the deployment flag in the page (CLS)', () => {
  function flag(content: 'on' | 'off') {
    const meta = document.createElement('meta');
    meta.name = 'clientflow-demo-mode';
    meta.content = content;
    document.head.append(meta);
    return () => meta.remove();
  }
  let unflag: (() => void) | undefined;
  afterEach(() => unflag?.());

  it('asks nothing and shows no demo block when the page says this is not a demo', async () => {
    unflag = flag('off');
    const calls = mockFetch(() => ({ status: 500 }));
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Enter an email address.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Explore the demo' })).not.toBeInTheDocument();
    expect(calls).toEqual([]);
  });

  it('lays out the demo block at once on a demo, before the accounts arrive', async () => {
    unflag = flag('on');
    let release!: () => void;
    const arrived = new Promise<void>((r) => (release = r));
    mockFetch(async () => {
      await arrived;
      return {
        status: 200,
        body: { data: [{ role: 'OWNER', name: 'Layla Hassan' }], meta: { requestId: 'r' } },
      };
    });
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    // First render: the block and one placeholder per role, none of them a usable button.
    expect(screen.getByRole('heading', { name: 'Explore the demo' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading the demo accounts');
    expect(screen.queryByRole('button', { name: /^Explore as / })).not.toBeInTheDocument();
    expect(screen.getByText('Or sign in with an email and password')).toBeInTheDocument();
    release();
    expect(await screen.findByRole('button', { name: /^Explore as Owner/ })).toBeEnabled();
    expect(screen.queryByText('Loading the demo accounts…')).not.toBeInTheDocument();
  });
});
