// M10: notification center, notification settings and CSV import screens.
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ImportPreview,
  NotificationPage,
  NotificationPreferenceView,
  SessionUser,
} from '@clientflow/contracts';
import { NotificationsPage } from '../src/features/notifications/NotificationsPage';
import { NotificationSettingsPage } from '../src/features/notifications/NotificationSettingsPage';
import { ImportPage } from '../src/features/imports/ImportPage';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const ok = (data: unknown, status = 200) => ({ status, body: { data, meta: { requestId: 'r' } } });
const PM: SessionUser = { ...USER, id: '018f0000-0000-7000-8000-0000000000aa', role: 'PM' };
const MANAGER: SessionUser = {
  ...USER,
  id: '018f0000-0000-7000-8000-0000000000bb',
  role: 'SALES_MANAGER',
};

const page = (over: Partial<NotificationPage> = {}): NotificationPage => ({
  items: [
    {
      id: 'n2',
      category: 'CLIENT_ACTIVITY',
      type: 'change.client_accepted',
      title: 'Omar (client) accepted CR-2 v1 on Harbour website',
      link: '/app/projects/p1/changes/c2',
      createdAt: '2026-10-28T09:00:00.000Z',
      readAt: null,
    },
    {
      id: 'n1',
      category: 'TASKS',
      type: 'task.assigned',
      title: 'Mona assigned you “Homepage copy” in Harbour website',
      link: '/app/projects/p1/board',
      createdAt: '2026-10-27T09:00:00.000Z',
      readAt: '2026-10-27T10:00:00.000Z',
    },
  ],
  unreadCount: 1,
  nextCursor: null,
  ...over,
});

describe('notification center (FR-X09)', () => {
  it('lists notifications, marks all up to the newest shown, and opens one', async () => {
    const calls = mockFetch((url, init) => {
      if (url.includes('/unread-count')) return ok({ count: 1 });
      if (url.includes('/read-all')) return ok({ marked: 1, unreadCount: 0 });
      if (init.method === 'PATCH') return ok({ id: 'n2', unreadCount: 0 });
      return ok(page());
    });
    const user = userEvent.setup();
    renderRoute(<NotificationsPage />, {
      path: '/app/notifications',
      url: '/app/notifications',
      user: PM,
    });
    const list = await screen.findByRole('region', { name: 'Notifications' });
    // Unread items say so in text, not only with colour and weight.
    expect(await within(list).findByText(/Unread:/)).toBeInTheDocument();
    expect(screen.getByText('1 unread', { exact: false })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Mark all as read/ }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/read-all'))).toBe(true));
    const body = JSON.parse(String(calls.find((c) => c.url.includes('/read-all'))!.init.body));
    expect(body).toEqual({ upTo: '2026-10-28T09:00:00.000Z' });

    await user.click(screen.getByRole('link', { name: /accepted CR-2/ }));
    expect(await screen.findByText('Navigated elsewhere')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        calls.some((c) => c.init.method === 'PATCH' && c.url.endsWith('/notifications/n2/read')),
      ).toBe(true),
    );
  });

  it('filters to unread and shows a calm empty state', async () => {
    const calls = mockFetch((url) =>
      url.includes('/unread-count') ? ok({ count: 0 }) : ok(page({ items: [], unreadCount: 0 })),
    );
    const user = userEvent.setup();
    renderRoute(<NotificationsPage />, {
      path: '/app/notifications',
      url: '/app/notifications',
      user: PM,
    });
    expect(await screen.findByText('No notifications yet')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Unread' }));
    expect(await screen.findByText('Nothing unread')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('unread=true'))).toBe(true);
    expect(screen.getByRole('button', { name: /Mark all as read/ })).toBeDisabled();
  });

  it('is not offered to portal users', () => {
    mockFetch(() => ok(page()));
    renderRoute(<NotificationsPage />, { user: { ...USER, role: 'CLIENT' } });
    expect(screen.getByText('Notifications are for team members')).toBeInTheDocument();
  });
});

describe('notification settings (FR-X09, FR-A03)', () => {
  const prefs: NotificationPreferenceView[] = [
    {
      category: 'CLIENT_ACTIVITY',
      label: 'Client activity',
      description: 'd',
      inApp: true,
      email: true,
    },
    { category: 'TASKS', label: 'Tasks', description: 'd', inApp: true, email: false },
  ];

  it('saves only what changed and warns when a category is fully off', async () => {
    const calls = mockFetch((_url, init) =>
      init.method === 'PUT'
        ? ok(prefs.map((p) => (p.category === 'TASKS' ? { ...p, email: true } : p)))
        : ok(prefs),
    );
    const user = userEvent.setup();
    renderRoute(<NotificationSettingsPage />, { user: PM });
    const tasks = await screen.findByRole('group', { name: 'Tasks: channels' });
    const save = screen.getByRole('button', { name: 'Save changes' });
    expect(save).toBeDisabled();
    await user.click(within(tasks).getByRole('checkbox', { name: 'In the app' }));
    expect(screen.getByText('You will not hear about these at all.')).toBeInTheDocument();
    await user.click(within(tasks).getByRole('checkbox', { name: 'In the app' }));
    await user.click(within(tasks).getByRole('checkbox', { name: 'Email' }));
    await user.click(save);
    await waitFor(() => expect(calls.some((c) => c.init.method === 'PUT')).toBe(true));
    expect(JSON.parse(String(calls.find((c) => c.init.method === 'PUT')!.init.body))).toEqual({
      preferences: [{ category: 'TASKS', inApp: true, email: true }],
    });
  });
});

describe('CSV import (FR-C10)', () => {
  const preview = (over: Partial<ImportPreview> = {}): ImportPreview => ({
    kind: 'contacts',
    fileSha256: 'f'.repeat(64),
    headers: ['Name', 'Email', 'Mail 2'],
    mapping: {
      fullName: 'Name',
      email: 'Email',
      phone: null,
      companyName: null,
      source: null,
      lifecycle: null,
      nextActionAt: null,
      notes: null,
      ownerEmail: null,
    },
    rows: [
      {
        line: 2,
        status: 'ready',
        values: { fullName: 'Mona Hassan', email: 'mona@nile.test' },
        errors: {},
        duplicateOf: null,
      },
      {
        line: 3,
        status: 'duplicate',
        values: { fullName: 'Existing', email: 'e@x.test' },
        errors: {},
        duplicateOf: { kind: 'existing', id: 'c1', label: 'Existing Person' },
      },
      {
        line: 4,
        status: 'error',
        values: { fullName: 'Karim', email: 'nope' },
        errors: { email: ['Enter a valid email address.'] },
        duplicateOf: null,
      },
    ],
    counts: { total: 3, ready: 1, duplicate: 1, error: 1 },
    fileErrors: [],
    ...over,
  });
  const run = {
    id: 'r1',
    kind: 'contacts',
    filename: 'leads.csv',
    actor: { id: MANAGER.id, name: MANAGER.name },
    rowsTotal: 3,
    rowsCreated: 1,
    rowsSkipped: 1,
    rowsFailed: 1,
    createdAt: '2026-10-28T09:00:00.000Z',
    undoneAt: null,
  };

  it('previews the file, re-checks on a new mapping, and imports once with one key across retries', async () => {
    let commits = 0;
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/imports/preview')) return ok(preview());
      if (url.endsWith('/imports') && init.method === 'POST') {
        commits += 1;
        return commits === 1
          ? { status: 503, body: errorBody('INTERNAL_ERROR', 'Try again.') }
          : ok({ run, notImported: [{ line: 3, reason: 'Already exists' }], replayed: false }, 201);
      }
      return ok([]);
    });
    const user = userEvent.setup();
    const { container } = renderRoute(<ImportPage />, { user: MANAGER });
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(
      input,
      new File(['Name,Email\nMona Hassan,mona@nile.test\n'], 'leads.csv', { type: 'text/csv' }),
    );

    const rows = await screen.findByRole('region', { name: 'Rows' });
    // Problems first: the ready row is hidden until "All rows".
    expect(within(rows).getByText('Matches “Existing Person”.')).toBeInTheDocument();
    expect(within(rows).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(within(rows).queryByText(/Mona Hassan/)).not.toBeInTheDocument();
    const sent = JSON.parse(
      String(calls.find((c) => c.url.endsWith('/imports/preview'))!.init.body),
    );
    expect(sent).toMatchObject({
      kind: 'contacts',
      filename: 'leads.csv',
      csv: 'Name,Email\nMona Hassan,mona@nile.test\n',
    });

    await user.selectOptions(screen.getByLabelText(/^Email/), 'Mail 2');
    await waitFor(() =>
      expect(calls.filter((c) => c.url.endsWith('/imports/preview'))).toHaveLength(2),
    );
    expect(
      JSON.parse(String(calls.filter((c) => c.url.endsWith('/imports/preview'))[1]!.init.body))
        .mapping.email,
    ).toBe('Mail 2');

    const importButton = await screen.findByRole('button', { name: 'Import 1 contact' });
    await user.click(screen.getByRole('radio', { name: 'Import them anyway' }));
    expect(screen.getByRole('button', { name: 'Import 2 contacts' })).toBeInTheDocument();
    await user.click(screen.getByRole('radio', { name: /Skip them/ }));
    await user.click(importButton);
    expect(await screen.findByText('Not imported')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Import 1 contact' }));
    const done = await screen.findByRole('region', { name: 'Import finished' });
    expect(within(done).getByText('1 contact imported')).toBeInTheDocument();
    const posts = calls.filter((c) => c.url.endsWith('/imports') && c.init.method === 'POST');
    const keyOf = (c: (typeof posts)[number]) => new Headers(c.init.headers).get('Idempotency-Key');
    expect(keyOf(posts[0]!)).toMatch(/^[0-9a-f-]{36}$/);
    expect(keyOf(posts[1]!)).toBe(keyOf(posts[0]!));
    expect(JSON.parse(String(posts[1]!.init.body))).toMatchObject({
      duplicates: 'skip',
      fileSha256: 'f'.repeat(64),
    });
  });

  it('blocks the import while the file has problems', async () => {
    mockFetch((url) =>
      url.endsWith('/imports/preview')
        ? ok(
            preview({
              rows: [],
              counts: { total: 0, ready: 0, duplicate: 0, error: 0 },
              fileErrors: ['Choose the column for “Name”.'],
            }),
          )
        : ok([]),
    );
    const user = userEvent.setup();
    const { container } = renderRoute(<ImportPage />, { user: MANAGER });
    await user.upload(
      container.querySelector('input[type="file"]') as HTMLInputElement,
      new File(['Email\na@b.test\n'], 'x.csv'),
    );
    expect(await screen.findByText('Fix the file before importing')).toBeInTheDocument();
    expect(screen.getByText('Choose the column for “Name”.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Import \d/ })).not.toBeInTheDocument();
  });

  it('is not offered to salespeople', () => {
    mockFetch(() => ok([]));
    renderRoute(<ImportPage />, { user: USER });
    expect(
      screen.getByText('Imports are for owners, admins and sales managers'),
    ).toBeInTheDocument();
  });
});
