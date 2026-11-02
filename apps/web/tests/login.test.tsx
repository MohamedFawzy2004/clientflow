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
    expect(calls).toHaveLength(0);
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
