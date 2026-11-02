// M12.1 — two-step sign-in screens (ADR-069).
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LoginPage } from '../src/features/auth/LoginPage';
import { AccountSecurityPage } from '../src/features/account/AccountSecurityPage';
import { MfaRequiredPage } from '../src/features/account/MfaRequiredPage';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const CODES = Array.from({ length: 10 }, (_, i) => `AAAA-BBBB-CC${String.fromCharCode(65 + i)}2`);

describe('sign-in with two-step sign-in on', () => {
  it('asks for the code after the password, then signs in', async () => {
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/auth/csrf')) return { status: 200, body: { data: { csrfToken: 'pre' } } };
      if (url.endsWith('/auth/login'))
        return { status: 200, body: { data: { mfaRequired: true } } };
      if (url.endsWith('/auth/mfa/verify')) {
        const body = JSON.parse(String(init.body));
        return body.code === '123456'
          ? { status: 200, body: { data: { user: USER, csrfToken: 'session-token' } } }
          : {
              status: 422,
              body: errorBody('VALIDATION_FAILED', 'Some fields need your attention.', {
                code: ['That code is not right. Try the next one.'],
              }),
            };
      }
      return { status: 404 };
    });
    const { router } = renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    await userEvent.type(screen.getByLabelText(/^Email/), 'nour@agency.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    const code = await screen.findByLabelText(/^Authentication code/);
    expect(code).toHaveAttribute('autocomplete', 'one-time-code');
    await userEvent.type(code, '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(
      await screen.findByText('That code is not right. Try the next one.'),
    ).toBeInTheDocument();

    await userEvent.clear(code);
    await userEvent.type(code, '123 456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/dashboard'));
    const verifyCall = calls.filter((c) => c.url.endsWith('/auth/mfa/verify')).at(-1)!;
    expect(JSON.parse(String(verifyCall.init.body))).toEqual({ code: '123456' });
  });

  it('offers a recovery code, and restarts when the attempt ended', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/csrf')) return { status: 200, body: { data: { csrfToken: 'pre' } } };
      if (url.endsWith('/auth/login'))
        return { status: 200, body: { data: { mfaRequired: true } } };
      return { status: 401, body: errorBody('TOKEN_INVALID', 'Your sign-in took too long.') };
    });
    renderRoute(<LoginPage />, { path: '/login', url: '/login', user: null });
    await userEvent.type(screen.getByLabelText(/^Email/), 'nour@agency.test');
    await userEvent.type(screen.getByLabelText(/^Password/), 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    await userEvent.click(
      await screen.findByRole('button', { name: 'Use a recovery code instead' }),
    );
    await userEvent.type(screen.getByLabelText(/^Recovery code/), 'ABCD-EFGH-JKLM');
    await userEvent.click(screen.getByRole('button', { name: 'Verify and sign in' }));
    expect(await screen.findByText('That sign-in attempt ended.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Back to sign in' }));
    expect(screen.getByLabelText(/^Password/)).toHaveValue('');
  });
});

describe('turning it on', () => {
  it('password, then a QR code and key, then recovery codes that must be saved', async () => {
    mockFetch((url) => {
      if (url.endsWith('/auth/mfa/setup')) {
        return {
          status: 200,
          body: {
            data: {
              secret: 'JBSW Y3DP EHPK 3PXP',
              otpauthUrl:
                'otpauth://totp/ClientFlow:nour%40agency.test?secret=JBSWY3DPEHPK3PXP&issuer=ClientFlow',
            },
          },
        };
      }
      if (url.endsWith('/auth/mfa/enable'))
        return { status: 200, body: { data: { recoveryCodes: CODES } } };
      if (url.endsWith('/auth/me')) return { status: 200, body: { data: USER } };
      return { status: 404 };
    });
    renderRoute(<AccountSecurityPage />, { path: '/app/account', url: '/app/account' });
    await userEvent.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));
    await userEvent.type(screen.getByLabelText(/^Your password/), 'a long password');
    await userEvent.click(screen.getByRole('button', { name: 'Continue' }));

    expect(await screen.findByRole('img', { name: /QR code to scan/ })).toBeInTheDocument();
    expect(screen.getByText('JBSW Y3DP EHPK 3PXP')).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(/^Authentication code/), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Turn on two-step sign-in' }));

    const list = await screen.findByRole('list');
    expect(within(list).getAllByRole('listitem')).toHaveLength(10);
    const done = screen.getByRole('button', { name: 'Done' });
    expect(done).toBeDisabled();
    await userEvent.click(screen.getByLabelText('I have saved my recovery codes'));
    expect(done).toBeEnabled();
  });

  it('a role that requires it cannot turn it off', () => {
    renderRoute(<AccountSecurityPage />, {
      path: '/app/account',
      url: '/app/account',
      user: { ...USER, role: 'ADMIN', mfa: { enabled: true, required: true } },
    });
    expect(screen.getByText('On')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Turn off/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Your role requires two-step sign-in/)).toBeInTheDocument();
  });

  it('the required-setup page explains why and offers sign out', () => {
    renderRoute(<MfaRequiredPage />, {
      path: '/app/dashboard',
      url: '/app/dashboard',
      user: { ...USER, role: 'OWNER', mfa: { enabled: false, required: true } },
    });
    expect(
      screen.getByRole('heading', { name: 'Turn on two-step sign-in to continue' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Your role \(Owner\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
  });
});
