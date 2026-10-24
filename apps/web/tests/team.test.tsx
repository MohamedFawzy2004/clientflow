import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { InvitationSummary, TeamMember } from '@clientflow/contracts';
import { TeamPage } from '../src/features/team/TeamPage';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const OWNER = { ...USER, id: 'owner-id', name: 'Mona Adel', role: 'OWNER' as const };
const ADMIN = { ...USER, id: 'admin-id', name: 'Hana Adly', role: 'ADMIN' as const };

const member = (over: Partial<TeamMember>): TeamMember => ({
  id: 'm1',
  name: 'Nour Salem',
  email: 'nour@agency.test',
  role: 'SALES',
  status: 'ACTIVE',
  lastLoginAt: '2026-10-24T08:00:00.000Z',
  activeSessions: 1,
  createdAt: '2026-10-01T08:00:00.000Z',
  version: 3,
  isSelf: false,
  ...over,
});

const MEMBERS = [
  member({
    id: 'owner-id',
    name: 'Mona Adel',
    email: 'owner@agency.test',
    role: 'OWNER',
    isSelf: true,
  }),
  member({ id: 'admin-id', name: 'Hana Adly', email: 'admin@agency.test', role: 'ADMIN' }),
  member({}),
];

const invitation = (over: Partial<InvitationSummary> = {}): InvitationSummary => ({
  id: 'inv1',
  email: 'new@agency.test',
  role: 'PM',
  status: 'PENDING',
  expiresAt: '2026-10-31T08:00:00.000Z',
  createdAt: '2026-10-24T08:00:00.000Z',
  invitedBy: { id: 'owner-id', name: 'Mona Adel' },
  ...over,
});

function teamApi(
  extra: (url: string, init: RequestInit) => { status: number; body?: unknown } | undefined = () =>
    undefined,
) {
  return mockFetch((url, init) => {
    const custom = extra(url, init);
    if (custom) return custom;
    if (url.endsWith('/api/v1/users'))
      return { status: 200, body: { data: MEMBERS, meta: { requestId: 'r' } } };
    if (url.endsWith('/api/v1/invitations') && !init.method?.match(/POST/)) {
      return { status: 200, body: { data: [invitation()], meta: { requestId: 'r' } } };
    }
    return { status: 404, body: errorBody('NOT_FOUND', 'nope') };
  });
}

describe('TeamPage', () => {
  it('lists members and pending invitations', async () => {
    teamApi();
    renderRoute(<TeamPage />, { path: '/app/team', url: '/app/team', user: OWNER });
    const table = await screen.findByRole('table', { name: 'Team members' });
    expect(within(table).getByText('Nour Salem')).toBeInTheDocument();
    expect(within(table).getByText('You')).toBeInTheDocument();
    expect(await screen.findByText('new@agency.test')).toBeInTheDocument();
    expect(screen.getByText('Pending')).toBeInTheDocument();
  });

  it('admins only get "View" on owners and on themselves', async () => {
    teamApi();
    renderRoute(<TeamPage />, { path: '/app/team', url: '/app/team', user: ADMIN });
    const table = await screen.findByRole('table', { name: 'Team members' });
    expect(within(table).getByRole('button', { name: 'View Mona Adel' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Manage Nour Salem' })).toBeInTheDocument();
  });

  it('roles without team access see an explanation and never call the team API', async () => {
    const calls = teamApi();
    renderRoute(<TeamPage />, { path: '/app/team', url: '/app/team', user: USER });
    expect(await screen.findByText('Team management is for owners and admins')).toBeInTheDocument();
    expect(
      calls.filter((c) => c.url.includes('/users') || c.url.includes('/invitations')),
    ).toHaveLength(0);
  });

  it('admins cannot pick the Owner role when inviting', async () => {
    teamApi();
    renderRoute(<TeamPage />, { path: '/app/team', url: '/app/team', user: ADMIN });
    await userEvent.click(await screen.findByRole('button', { name: /Invite member/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a team member' });
    const options = within(dialog)
      .getAllByRole('option')
      .map((o) => o.textContent);
    expect(options).not.toContain('Owner');
    expect(options).toContain('Admin');
  });

  it('shows the one-time link after creating an invitation', async () => {
    const calls = teamApi((url, init) =>
      url.endsWith('/api/v1/invitations') && init.method === 'POST'
        ? {
            status: 201,
            body: {
              data: {
                invitation: invitation({ email: 'joiner@agency.test' }),
                acceptUrl: 'http://localhost:5173/activate-invite#token=abc',
                emailDelivery: 'sent_to_dev_sink',
              },
              meta: { requestId: 'r' },
            },
          }
        : undefined,
    );
    renderRoute(<TeamPage />, { path: '/app/team', url: '/app/team', user: OWNER });
    await userEvent.click(await screen.findByRole('button', { name: /Invite member/ }));
    const dialog = await screen.findByRole('dialog', { name: 'Invite a team member' });
    await userEvent.type(within(dialog).getByLabelText(/^Work email/), 'joiner@agency.test');
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Role/), 'PM');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create invitation' }));
    const done = await screen.findByRole('dialog', { name: 'Invitation created' });
    expect(within(done).getByLabelText('Invitation link')).toHaveValue(
      'http://localhost:5173/activate-invite#token=abc',
    );
    expect(within(done).getByText(/written to the local mail sink, not sent/)).toBeInTheDocument();
    const post = calls.find((c) => c.init.method === 'POST')!;
    expect(JSON.parse(post.init.body as string)).toEqual({
      email: 'joiner@agency.test',
      role: 'PM',
    });
  });

  it('changes a role with the member version and explains stale conflicts', async () => {
    const calls = teamApi((url, init) =>
      init.method === 'PATCH'
        ? { status: 409, body: errorBody('CONFLICT_STALE_VERSION', 'stale') }
        : undefined,
    );
    renderRoute(<TeamPage />, { path: '/app/team', url: '/app/team', user: OWNER });
    const table = await screen.findByRole('table', { name: 'Team members' });
    await userEvent.click(within(table).getByRole('button', { name: 'Manage Nour Salem' }));
    const dialog = await screen.findByRole('dialog', { name: 'Manage member' });
    await userEvent.selectOptions(within(dialog).getByLabelText(/^Role/), 'SALES_MANAGER');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save role' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
    const patch = calls.find((c) => c.init.method === 'PATCH')!;
    expect(patch.url).toContain('/api/v1/users/m1');
    expect(JSON.parse(patch.init.body as string)).toEqual({ role: 'SALES_MANAGER', version: 3 });
  });

  it('deactivation needs an explicit confirmation step', async () => {
    const calls = teamApi((url, init) =>
      url.endsWith('/deactivate') && init.method === 'POST'
        ? {
            status: 200,
            body: {
              data: member({ status: 'DEACTIVATED', activeSessions: 0, version: 4 }),
              meta: { requestId: 'r' },
            },
          }
        : undefined,
    );
    renderRoute(<TeamPage />, { path: '/app/team', url: '/app/team', user: OWNER });
    const table = await screen.findByRole('table', { name: 'Team members' });
    await userEvent.click(within(table).getByRole('button', { name: 'Manage Nour Salem' }));
    const dialog = await screen.findByRole('dialog', { name: 'Manage member' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Deactivate' }));
    expect(calls.filter((c) => c.url.endsWith('/deactivate'))).toHaveLength(0);
    const confirm = await screen.findByRole('dialog', { name: 'Please confirm' });
    expect(within(confirm).getByText('Deactivate Nour Salem?')).toBeInTheDocument();
    await userEvent.click(within(confirm).getByRole('button', { name: 'Deactivate' }));
    await waitFor(() => expect(calls.filter((c) => c.url.endsWith('/deactivate'))).toHaveLength(1));
    expect(
      JSON.parse(calls.find((c) => c.url.endsWith('/deactivate'))!.init.body as string),
    ).toEqual({ version: 3 });
  });
});
