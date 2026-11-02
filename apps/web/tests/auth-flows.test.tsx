import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivateInvitePage } from '../src/features/auth/ActivateInvitePage';
import { ForgotPasswordPage, ResetPasswordPage } from '../src/features/auth/PasswordResetPages';
import { LoginPage } from '../src/features/auth/LoginPage';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

const TOKEN = 'T'.repeat(43);
const csrf = { status: 200, body: { data: { csrfToken: 'pre' } } };

beforeEach(() => window.history.replaceState(null, '', '/'));
afterEach(() => vi.unstubAllGlobals());

function withFragment(path: string) {
  window.history.replaceState(null, '', `${path}#token=${TOKEN}`);
}

describe('ActivateInvitePage', () => {
  it('reads the token from the fragment, removes it from the address bar and previews', async () => {
    withFragment('/activate-invite');
    const calls = mockFetch((url) =>
      url.endsWith('/csrf')
        ? csrf
        : {
            status: 200,
            body: {
              data: {
                email: 'joiner@agency.test',
                role: 'PM',
                agencyName: 'Lumen Digital Studio',
                expiresAt: '2026-10-31T08:00:00.000Z',
              },
              meta: { requestId: 'r' },
            },
          },
    );
    renderRoute(<ActivateInvitePage />, {
      path: '/activate-invite',
      url: '/activate-invite',
      user: null,
    });
    expect(
      await screen.findByRole('heading', { name: 'Join Lumen Digital Studio' }),
    ).toBeInTheDocument();
    expect(screen.getByDisplayValue('joiner@agency.test')).toHaveAttribute('readonly');
    expect(window.location.hash).toBe('');
    const preview = calls.find((c) => c.url.endsWith('/invitations/preview'))!;
    expect(preview.url).not.toContain(TOKEN);
    expect(JSON.parse(preview.init.body as string)).toEqual({ token: TOKEN });
  });

  it('shows a clear dead-end for invalid or expired links', async () => {
    withFragment('/activate-invite');
    mockFetch((url) =>
      url.endsWith('/csrf') ? csrf : { status: 400, body: errorBody('TOKEN_INVALID', 'invalid') },
    );
    renderRoute(<ActivateInvitePage />, {
      path: '/activate-invite',
      url: '/activate-invite',
      user: null,
    });
    expect(await screen.findByText('This invitation link does not work')).toBeInTheDocument();
  });

  it('shows the same dead-end when the link has no token', async () => {
    const calls = mockFetch(() => csrf);
    renderRoute(<ActivateInvitePage />, {
      path: '/activate-invite',
      url: '/activate-invite',
      user: null,
    });
    expect(await screen.findByText('This invitation link does not work')).toBeInTheDocument();
    expect(calls).toHaveLength(0);
  });

  it('validates matching passwords, shows server policy errors, then signs in', async () => {
    withFragment('/activate-invite');
    let attempt = 0;
    mockFetch((url) => {
      if (url.endsWith('/csrf')) return csrf;
      if (url.endsWith('/preview')) {
        return {
          status: 200,
          body: {
            data: {
              email: 'joiner@agency.test',
              role: 'PM',
              agencyName: 'Lumen',
              expiresAt: '2026-10-31T08:00:00.000Z',
            },
            meta: { requestId: 'r' },
          },
        };
      }
      attempt += 1;
      return attempt === 1
        ? {
            status: 422,
            body: errorBody('VALIDATION_FAILED', 'x', {
              password: ['This password is too common or easy to guess.'],
            }),
          }
        : {
            status: 201,
            body: {
              data: { user: { ...USER, role: 'PM' }, csrfToken: 'session' },
              meta: { requestId: 'r' },
            },
          };
    });
    const { router } = renderRoute(<ActivateInvitePage />, {
      path: '/activate-invite',
      url: '/activate-invite',
      user: null,
    });
    await screen.findByRole('heading', { name: 'Join Lumen' });
    await userEvent.type(screen.getByLabelText(/^Your name/), 'Jana Joiner');
    await userEvent.type(screen.getByLabelText(/^Password/), 'amber-orchard-signal-77');
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'amber-orchard-signal-78');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and sign in' }));
    expect(await screen.findByText('The passwords do not match.')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText(/^Confirm password/));
    await userEvent.type(screen.getByLabelText(/^Confirm password/), 'amber-orchard-signal-77');
    await userEvent.click(screen.getByRole('button', { name: 'Create account and sign in' }));
    expect(
      await screen.findByText('This password is too common or easy to guess.'),
    ).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create account and sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/dashboard'));
  });
});

describe('password reset pages', () => {
  it('forgot password shows the same confirmation whatever the outcome', async () => {
    const calls = mockFetch((url) =>
      url.endsWith('/csrf') ? csrf : { status: 202, body: { data: {}, meta: { requestId: 'r' } } },
    );
    renderRoute(<ForgotPasswordPage />, {
      path: '/forgot-password',
      url: '/forgot-password',
      user: null,
    });
    await userEvent.type(screen.getByLabelText(/^Email/), 'nobody@agency.test');
    await userEvent.click(screen.getByRole('button', { name: 'Send reset link' }));
    expect(
      await screen.findByText('If that address has an account, a link is on its way'),
    ).toBeInTheDocument();
    const req = calls.find((c) => c.url.endsWith('/password-reset/request'))!;
    expect((req.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('pre');
  });

  it('reset page posts the fragment token in the body and confirms success', async () => {
    withFragment('/reset-password');
    const calls = mockFetch((url) =>
      url.endsWith('/csrf')
        ? csrf
        : { status: 200, body: { data: { passwordReset: true }, meta: { requestId: 'r' } } },
    );
    renderRoute(<ResetPasswordPage />, {
      path: '/reset-password',
      url: '/reset-password',
      user: null,
    });
    expect(window.location.hash).toBe('');
    await userEvent.type(screen.getByLabelText(/^New password/), 'quiet-harbor-lantern-58');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'quiet-harbor-lantern-58');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByText('You can sign in with your new password')).toBeInTheDocument();
    const confirm = calls.find((c) => c.url.endsWith('/password-reset/confirm'))!;
    expect(JSON.parse(confirm.init.body as string)).toEqual({
      token: TOKEN,
      password: 'quiet-harbor-lantern-58',
    });
  });

  it('reset page explains expired links and offers a new one', async () => {
    withFragment('/reset-password');
    mockFetch((url) =>
      url.endsWith('/csrf') ? csrf : { status: 400, body: errorBody('TOKEN_INVALID', 'expired') },
    );
    renderRoute(<ResetPasswordPage />, {
      path: '/reset-password',
      url: '/reset-password',
      user: null,
    });
    await userEvent.type(screen.getByLabelText(/^New password/), 'quiet-harbor-lantern-58');
    await userEvent.type(screen.getByLabelText(/^Confirm new password/), 'quiet-harbor-lantern-58');
    await userEvent.click(screen.getByRole('button', { name: 'Set new password' }));
    expect(await screen.findByRole('link', { name: 'Request a new link' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
  });

  it('login links to forgot password and lets users reveal what they typed', async () => {
    mockFetch(() => csrf);
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    expect(screen.getByRole('link', { name: 'Forgot password?' })).toHaveAttribute(
      'href',
      '/forgot-password',
    );
    const input = screen.getByLabelText(/^Password/);
    expect(input).toHaveAttribute('type', 'password');
    await userEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input).toHaveAttribute('type', 'text');
  });
});
