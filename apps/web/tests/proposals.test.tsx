import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PortalProposalDetail,
  ProposalDetail,
  ProposalVersionView,
  SessionUser,
} from '@clientflow/contracts';
import { ProposalDetailPage } from '../src/features/proposals/ProposalDetailPage';
import { PortalProposalPage } from '../src/features/portal/PortalProposalPage';
import { safeNextPath } from '../src/features/auth/LoginPage';
import { mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const PID = '018f0000-0000-7000-8000-0000000000p1';

const version = (over: Partial<ProposalVersionView> = {}): ProposalVersionView => ({
  id: 'v1',
  versionNo: 1,
  status: 'DRAFT',
  displayStatus: 'DRAFT',
  title: 'Delivery app',
  summary: null,
  inclusions: 'Apps',
  exclusions: 'Hosting',
  assumptions: null,
  milestones: null,
  paymentTerms: null,
  terms: null,
  internalNotes: 'Keep margin above 30%',
  currency: 'EGP',
  expiresOn: '2099-06-30',
  discountBp: 0,
  taxRateBp: 1400,
  taxLabel: 'VAT',
  items: [],
  subtotalMinor: '0',
  discountMinor: '0',
  taxMinor: '0',
  totalMinor: '0',
  contentHash: null,
  submittedAt: null,
  approvedAt: null,
  sentAt: null,
  decidedAt: null,
  version: 1,
  reviews: [],
  ...over,
});

const detail = (v: ProposalVersionView): ProposalDetail => ({
  id: PID,
  reference: 'P-0001',
  title: v.title,
  status: v.status,
  displayStatus: v.displayStatus,
  currentVersionNo: v.versionNo,
  totalMinor: v.totalMinor,
  currency: 'EGP',
  expiresOn: v.expiresOn,
  deal: { id: 'd1', title: 'Delivery deal', status: 'OPEN' },
  contact: { id: 'c1', fullName: 'Karim Nasser', companyName: 'Nasser Pharmacies' },
  owner: { id: USER.id, name: USER.name },
  updatedAt: '2026-10-25T10:00:00.000Z',
  version: 1,
  versions: [
    {
      id: v.id,
      versionNo: v.versionNo,
      status: v.status,
      displayStatus: v.displayStatus,
      totalMinor: v.totalMinor,
      currency: 'EGP',
      updatedAt: '2026-10-25T10:00:00.000Z',
    },
  ],
  current: v,
  clientOrg: null,
});

const ok = (data: unknown) => ({ status: 200, body: { data, meta: { requestId: 'r' } } });

function renderDetail(v: ProposalVersionView, user: SessionUser = USER) {
  const calls = mockFetch((url, init) => {
    if (url.includes('/services')) return ok([]);
    if (init.method === 'PUT') {
      const body = JSON.parse(init.body as string);
      return ok(detail({ ...v, title: body.title, version: v.version + 1 }));
    }
    return ok(detail(v));
  });
  renderRoute(<ProposalDetailPage />, {
    path: '/app/proposals/:id',
    url: `/app/proposals/${PID}`,
    user,
  });
  return calls;
}

describe('proposal editor', () => {
  it('previews exact totals with explained VAT while typing', async () => {
    renderDetail(version());
    await userEvent.click(await screen.findByRole('button', { name: /Custom line/ }));
    await userEvent.type(screen.getByLabelText(/^Line 1/), 'Design sprint');
    const qty = screen.getByLabelText(/^Quantity/);
    await userEvent.clear(qty);
    await userEvent.type(qty, '3');
    await userEvent.type(screen.getByLabelText(/^Unit price/), '1,500.50');
    const price = screen.getByRole('region', { name: 'Price (EGP)' });
    expect(within(price).getByText(/VAT 14% of EGP\s4,501\.50/)).toBeInTheDocument();
    expect(within(price).getByText(/EGP\s630\.21/)).toBeInTheDocument(); // 630.21 = 14% of 4,501.50
    expect(within(price).getByText(/EGP\s5,131\.71/)).toBeInTheDocument();
    expect(within(price).getByText(/server recalculates on save/)).toBeInTheDocument();
  });

  it('saves with PUT and sends inputs only, never totals', async () => {
    const calls = renderDetail(version());
    const title = await screen.findByLabelText(/^Title/);
    await userEvent.clear(title);
    await userEvent.type(title, 'New title');
    await userEvent.click(screen.getByRole('button', { name: 'Save draft' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.init.method === 'PUT')!;
    const body = JSON.parse(put.init.body as string);
    expect(body.version).toBe(1);
    expect(body.title).toBe('New title');
    expect(Object.keys(body)).not.toContain('totalMinor');
    expect(Object.keys(body)).not.toContain('currency');
    expect((put.init.headers as Record<string, string>)['X-CSRF-Token']).toBe('test-csrf');
  });
});

describe('proposal workflow panel', () => {
  const inReview = version({
    status: 'IN_REVIEW',
    displayStatus: 'IN_REVIEW',
    contentHash: 'a'.repeat(64),
  });

  it('salespeople wait for review and cannot approve', async () => {
    renderDetail(inReview);
    expect(
      await screen.findByText(/Waiting for an owner, admin or sales manager/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument();
    expect(screen.getByText('Keep margin above 30%')).toBeInTheDocument();
  });

  it('managers see approve and request changes', async () => {
    renderDetail(inReview, { ...USER, role: 'SALES_MANAGER' });
    expect(await screen.findByRole('button', { name: 'Approve' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Request changes' })).toBeInTheDocument();
  });

  it('an approved version cannot be sent until the client portal has someone in it', async () => {
    renderDetail(
      version({
        status: 'APPROVED_INTERNAL',
        displayStatus: 'APPROVED_INTERNAL',
        contentHash: 'a'.repeat(64),
      }),
    );
    expect(await screen.findByText('Client portal not set up')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send to client' })).toBeDisabled();
  });
});

describe('client portal proposal page', () => {
  const portal = (over: Partial<PortalProposalDetail['current']> = {}): PortalProposalDetail => ({
    id: PID,
    reference: 'P-0001',
    agencyName: 'Lumen Digital Studio',
    clientOrgName: 'Nasser Pharmacies',
    current: {
      ...version({ status: 'SENT', displayStatus: 'SENT' }),
      internalNotes: undefined as never,
      contentHash: 'b'.repeat(64),
      sentAt: '2026-10-25T10:00:00.000Z',
      decidedAt: null,
      decision: null,
      ...over,
    } as PortalProposalDetail['current'],
    history: [{ versionNo: 1, displayStatus: 'SENT', sentAt: '2026-10-25T10:00:00.000Z' }],
  });
  const CLIENT: SessionUser = {
    ...USER,
    role: 'CLIENT',
    clientOrg: { id: 'o1', name: 'Nasser Pharmacies' },
  };

  it('accepting needs the “I have read” tick and sends the terms hash shown', async () => {
    const calls = mockFetch((_url, init) => (init.method === 'POST' ? ok(portal()) : ok(portal())));
    renderRoute(<PortalProposalPage />, {
      path: '/portal/proposals/:id',
      url: `/portal/proposals/${PID}`,
      user: CLIENT,
    });
    const accept = await screen.findByRole('button', { name: 'Accept proposal' });
    expect(accept).toBeDisabled();
    expect(screen.getAllByText(/not a formal electronic signature/).length).toBeGreaterThan(0);
    await userEvent.click(screen.getByLabelText(/I have read version 1/));
    await userEvent.click(accept);
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init.method === 'POST')!;
    expect(JSON.parse(post.init.body as string)).toEqual({
      decision: 'ACCEPT',
      contentHash: 'b'.repeat(64),
    });
  });

  it('an expired version shows why it cannot be accepted', async () => {
    mockFetch(() => ok(portal({ displayStatus: 'EXPIRED' })));
    renderRoute(<PortalProposalPage />, {
      path: '/portal/proposals/:id',
      url: `/portal/proposals/${PID}`,
      user: CLIENT,
    });
    expect(await screen.findByText('This proposal has expired')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Accept proposal' })).not.toBeInTheDocument();
  });
});

describe('role-aware redirects', () => {
  it('keeps portal users in /portal and staff in /app', () => {
    expect(safeNextPath('/app/leads', 'CLIENT')).toBe('/portal');
    expect(safeNextPath('/portal/proposals/x', 'CLIENT')).toBe('/portal/proposals/x');
    expect(safeNextPath('/portal', 'SALES')).toBe('/app/dashboard');
    expect(safeNextPath(null, 'CLIENT')).toBe('/portal');
  });
});
