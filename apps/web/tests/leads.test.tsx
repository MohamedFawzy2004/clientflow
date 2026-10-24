import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ContactSummary } from '@clientflow/contracts';
import { LeadsListPage } from '../src/features/leads/LeadsListPage';
import { LeadDetailPage } from '../src/features/leads/LeadDetailPage';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const lead = (over: Partial<ContactSummary> = {}): ContactSummary => ({
  id: '018f0000-0000-7000-8000-0000000000aa',
  fullName: 'Salma Ibrahim',
  email: 'salma@nile.test',
  phone: null,
  companyName: 'Nile Bakery Co.',
  lifecycle: 'LEAD',
  source: 'REFERRAL',
  owner: { id: USER.id, name: USER.name },
  nextActionAt: null,
  convertedAt: null,
  archivedAt: null,
  createdAt: '2026-10-20T10:00:00.000Z',
  updatedAt: '2026-10-20T10:00:00.000Z',
  version: 1,
  ...over,
});

const listResponse = (rows: ContactSummary[], total = rows.length) => ({
  status: 200,
  body: { data: rows, meta: { page: 1, limit: 25, total, requestId: 'r' } },
});

describe('LeadsListPage', () => {
  it('shows a first-run empty state with an Add lead action', async () => {
    mockFetch(() => listResponse([]));
    renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads' });
    expect(await screen.findByText('No leads yet')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /Add lead/ }).length).toBeGreaterThan(0);
  });

  it('shows a filtered-empty state with a way to reset', async () => {
    mockFetch(() => listResponse([]));
    renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads?q=zzz' });
    expect(await screen.findByText('No leads match these filters')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear filters' })).toBeInTheDocument();
  });

  it('renders rows from the API, flags overdue follow-ups and shows the page range', async () => {
    mockFetch(() =>
      listResponse(
        [
          lead(),
          lead({
            id: '018f0000-0000-7000-8000-0000000000bb',
            fullName: 'Ahmed Rostom',
            nextActionAt: '2020-01-01T09:00:00.000Z',
          }),
        ],
        2,
      ),
    );
    renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads' });
    const table = await screen.findByRole('table');
    expect(within(table).getByRole('link', { name: 'Salma Ibrahim' })).toHaveAttribute(
      'href',
      '/app/leads/018f0000-0000-7000-8000-0000000000aa',
    );
    expect(within(table).getByText(/Overdue/)).toBeInTheDocument();
    expect(screen.getByText('1–2 of 2')).toBeInTheDocument();
  });

  it('renders stored HTML as inert text (T-SEC-03, UI side)', async () => {
    const payload = '<img src=x onerror="window.__xss=1">';
    mockFetch(() => listResponse([lead({ fullName: payload })]));
    const { container } = renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads' });
    expect((await screen.findAllByText(payload)).length).toBeGreaterThan(0);
    expect(container.querySelector('img')).toBeNull();
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('shows a role-based forbidden state on 403', async () => {
    mockFetch(() => ({
      status: 403,
      body: errorBody('FORBIDDEN', 'Your role does not have access to leads.'),
    }));
    renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads' });
    expect(await screen.findByText('Leads are not part of your role')).toBeInTheDocument();
  });

  it('shows a retryable error state with the request reference on 500', async () => {
    let fail = true;
    mockFetch(() =>
      fail
        ? { status: 500, body: errorBody('INTERNAL_ERROR', 'Something went wrong on our side.') }
        : listResponse([lead()]),
    );
    renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads' });
    expect(await screen.findByText('We could not load leads')).toBeInTheDocument();
    expect(screen.getByText('req-test-1')).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole('button', { name: /Try again/ }));
    expect(await screen.findByRole('link', { name: 'Salma Ibrahim' })).toBeInTheDocument();
  });
});

describe('AddLeadDialog', () => {
  async function openDialog() {
    renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads' });
    await screen.findByText('No leads yet');
    await userEvent.click(screen.getAllByRole('button', { name: /Add lead/ })[0]!);
    return screen.findByRole('dialog', { name: 'Add lead' });
  }

  it('validates required and malformed fields on the client', async () => {
    const calls = mockFetch(() => listResponse([]));
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/^Email/), 'not-an-email');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save lead' }));
    expect(await within(dialog).findByText('Enter the lead’s name.')).toBeInTheDocument();
    expect(within(dialog).getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(calls.filter((c) => c.init.method === 'POST')).toHaveLength(0);
  });

  it('maps server field errors next to inputs and keeps what was typed', async () => {
    mockFetch((_url, init) =>
      init.method === 'POST'
        ? {
            status: 422,
            body: errorBody('VALIDATION_FAILED', 'Some fields need your attention.', {
              phone: ['Phone number must contain 6 to 15 digits.'],
            }),
          }
        : listResponse([]),
    );
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/^Full name/), 'Salma Ibrahim');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save lead' }));
    expect(
      await within(dialog).findByText('Phone number must contain 6 to 15 digits.'),
    ).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Full name/)).toHaveValue('Salma Ibrahim');
  });

  it('never claims success on a network failure and keeps the input for retry', async () => {
    mockFetch((_url, init) => {
      if (init.method === 'POST') throw new TypeError('Failed to fetch');
      return listResponse([]);
    });
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/^Full name/), 'Offline Lead');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save lead' }));
    expect(await within(dialog).findByText('Not saved: connection problem')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/^Full name/)).toHaveValue('Offline Lead');
    expect(screen.queryByText('Lead added')).not.toBeInTheDocument();
  });

  it('asks before discarding unsaved input', async () => {
    mockFetch(() => listResponse([]));
    const dialog = await openDialog();
    await userEvent.type(within(dialog).getByLabelText(/^Full name/), 'Half typed');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(await within(dialog).findByText('Discard this lead?')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Keep editing' }));
    expect(within(dialog).getByLabelText(/^Full name/)).toHaveValue('Half typed');
  });

  it('sends a strict payload with the CSRF header and opens the new lead', async () => {
    const calls = mockFetch((_url, init) =>
      init.method === 'POST'
        ? {
            status: 201,
            body: {
              data: { ...lead(), notes: null, activities: [] },
              meta: { possibleDuplicates: [], requestId: 'r' },
            },
          }
        : listResponse([]),
    );
    renderRoute(<LeadsListPage />, { path: '/app/leads', url: '/app/leads' });
    await screen.findByText('No leads yet');
    await userEvent.click(screen.getAllByRole('button', { name: /Add lead/ })[0]!);
    const dialog = await screen.findByRole('dialog', { name: 'Add lead' });
    await userEvent.type(within(dialog).getByLabelText(/^Full name/), 'Salma Ibrahim');
    await userEvent.type(within(dialog).getByLabelText(/^Company/), 'Nile Bakery Co.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save lead' }));
    await waitFor(() => expect(screen.getByText('Navigated elsewhere')).toBeInTheDocument());
    const post = calls.find((c) => c.init.method === 'POST')!;
    expect((post.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('test-csrf');
    expect(JSON.parse(post.init.body as string)).toEqual({
      fullName: 'Salma Ibrahim',
      companyName: 'Nile Bakery Co.',
    });
  });
});

describe('LeadDetailPage', () => {
  it('shows the same not-found state for missing and out-of-scope leads', async () => {
    mockFetch(() => ({
      status: 404,
      body: errorBody('NOT_FOUND', 'We could not find that record.'),
    }));
    renderRoute(<LeadDetailPage />, { path: '/app/leads/:id', url: '/app/leads/some-id' });
    expect(await screen.findByText('Lead not found')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Back to leads/ })).toBeInTheDocument();
  });

  it('renders notes as plain text and the activity timeline', async () => {
    mockFetch(() => ({
      status: 200,
      body: {
        data: {
          ...lead(),
          notes: '<b>bold?</b>\nSecond line',
          deals: [],
          activities: [
            {
              id: 'a1',
              eventType: 'contact.created',
              summary: 'Lead added by Nour Salem',
              body: null,
              actor: { id: USER.id, name: USER.name },
              occurredAt: '2026-10-20T10:00:00.000Z',
              createdAt: '2026-10-20T10:00:00.000Z',
            },
          ],
        },
        meta: { requestId: 'r' },
      },
    }));
    const { container } = renderRoute(<LeadDetailPage />, {
      path: '/app/leads/:id',
      url: '/app/leads/x',
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Salma Ibrahim' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Lead added by Nour Salem')).toBeInTheDocument();
    expect(screen.getByText(/<b>bold\?<\/b>/)).toBeInTheDocument();
    expect(container.querySelector('b')).toBeNull();
  });
});
