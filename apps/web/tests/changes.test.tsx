import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ChangeDetail,
  CommentView,
  PortalChangeDetail,
  ProjectDetail,
  SessionUser,
} from '@clientflow/contracts';
import { ProjectDetailPage } from '../src/features/projects/ProjectDetailPage';
import { ChangePage } from '../src/features/changes/ChangePage';
import { CommentsThread } from '../src/features/changes/CommentsThread';
import { PortalChangePage } from '../src/features/portal/PortalChangePage';
import { mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const ok = (data: unknown, status = 200) => ({ status, body: { data, meta: { requestId: 'r' } } });
const PM: SessionUser = { ...USER, id: '018f0000-0000-7000-8000-0000000000f1', role: 'PM' };
const OWNER: SessionUser = { ...USER, id: '018f0000-0000-7000-8000-0000000000f2', role: 'OWNER' };
const CLIENT: SessionUser = {
  ...USER,
  id: '018f0000-0000-7000-8000-0000000000cc',
  role: 'CLIENT',
  clientOrg: { id: 'o1', name: 'Harbour Co.' },
};

const project: ProjectDetail = {
  id: 'p1',
  title: 'Fleet app',
  state: 'ACTIVE',
  manager: { id: PM.id, name: 'Pat' },
  client: 'Harbour Co.',
  startOn: null,
  dueOn: null,
  budgetMinor: '0',
  currency: 'EGP',
  fromDeal: null,
  milestones: { total: 0, done: 0 },
  updatedAt: '2026-10-25T10:00:00.000Z',
  version: 1,
  contact: null,
  members: [],
  baseline: null,
  milestoneList: [],
  checklist: [],
  activities: [],
  scopeHistory: { originalBudgetMinor: '0', currentBudgetMinor: '0', currency: 'EGP', changes: [] },
  clientOrg: { id: 'o1', name: 'Harbour Co.' },
  access: { manage: true, work: true },
};

const change = (over: Partial<ChangeDetail> = {}): ChangeDetail => ({
  id: 'c1',
  number: 1,
  reference: 'CR-1',
  title: 'Arabic version',
  status: 'REQUESTED',
  requestedBy: { id: 'u9', name: 'Omar', client: true },
  priceMinor: null,
  currency: 'EGP',
  newDueOn: null,
  updatedAt: '2026-10-25T10:00:00.000Z',
  version: 4,
  projectId: 'p1',
  projectTitle: 'Fleet app',
  description: 'All pages in Arabic',
  justification: null,
  withdrawnReason: null,
  versions: [],
  tasks: [],
  needsApproval: false,
  access: { estimate: true, submit: false, review: false, send: false, withdraw: true },
  ...over,
});

function renderChange(user: SessionUser, c: ChangeDetail) {
  const calls = mockFetch((url) => {
    if (url.endsWith('/projects/p1')) return ok(project);
    if (url.includes('/comments')) return ok([]);
    return ok(c);
  });
  renderRoute(<ProjectDetailPage />, {
    path: '/app/projects/:id',
    url: '/app/projects/p1/changes/c1',
    user,
    children: [{ path: 'changes/:changeId', element: <ChangePage /> }],
  });
  return calls;
}

describe('change request (FR-S02)', () => {
  it('the PM saves an estimate in exact money and whole minutes', async () => {
    const calls = renderChange(PM, change());
    await userEvent.type(await screen.findByLabelText(/^Scope change/), 'Translate 8 pages');
    await userEvent.type(screen.getByLabelText(/^Work items/), 'Translate{Enter}Review');
    await userEvent.type(screen.getByLabelText(/^Price excl\. tax/), '12500.50');
    await userEvent.type(screen.getByLabelText(/^Effort/), '7.5');
    await userEvent.click(screen.getByRole('button', { name: 'Save estimate' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'PUT')).toBe(true));
    const put = calls.find((c) => c.init.method === 'PUT')!;
    expect(put.url).toContain('/changes/c1/draft');
    expect(JSON.parse(put.init.body as string)).toEqual({
      version: 4,
      scope: 'Translate 8 pages',
      workItems: 'Translate\nReview',
      estimateMinutes: 450,
      price: '12500.50',
      newDueOn: null,
    });
  });

  it('an owner reviewing a priced change can approve it or send it back', async () => {
    renderChange(
      OWNER,
      change({
        status: 'IN_REVIEW',
        needsApproval: true,
        access: { estimate: false, submit: false, review: true, send: false, withdraw: true },
        versions: [
          {
            id: 'v1',
            versionNo: 1,
            status: 'IN_REVIEW',
            scope: 'Translate 8 pages',
            workItems: ['Translate'],
            estimateMinutes: 450,
            priceMinor: '1250050',
            taxRateBp: 1400,
            taxMinor: '175007',
            totalMinor: '1425057',
            currency: 'EGP',
            newDueOn: null,
            contentHash: null,
            submittedAt: '2026-10-25T10:00:00.000Z',
            approvedAt: null,
            approvedBy: null,
            sentAt: null,
            createdBy: { id: PM.id, name: 'Pat' },
            effect: null,
            decision: null,
          },
        ],
      }),
    );
    expect(await screen.findByText('Waiting for internal approval')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Approve for the client' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send back' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Send to the client/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Effort 7h 30m \(internal\)/)).toBeInTheDocument();
  });
});

const portalChange = (over: Partial<PortalChangeDetail> = {}): PortalChangeDetail => {
  const v = {
    id: 'v1',
    versionNo: 1,
    scope: 'Translate 8 pages',
    workItems: ['Translate'],
    priceMinor: '1250000',
    taxRateBp: 1400,
    taxMinor: '175000',
    totalMinor: '1425000',
    currency: 'EGP' as const,
    newDueOn: '2027-04-30',
    contentHash: 'a'.repeat(64),
    sentAt: '2026-10-25T10:00:00.000Z',
    decision: null,
  };
  return {
    id: 'c1',
    reference: 'CR-1',
    project: { id: 'p1', title: 'Fleet app', dueOn: '2027-03-31' },
    title: 'Arabic version',
    description: 'All pages in Arabic',
    justification: null,
    status: 'AWAITING_CLIENT',
    requestedByYou: true,
    versions: [v],
    open: v,
    ...over,
  };
};

describe('client decision on a change (FR-S03, FR-S04)', () => {
  it('accepts the exact version shown; rejecting needs a reason', async () => {
    const calls = mockFetch((url, init) => {
      if (url.includes('/portal/comments')) return ok([]);
      if (init.method === 'POST') return ok(portalChange({ status: 'ACCEPTED', open: null }));
      return ok(portalChange());
    });
    renderRoute(<PortalChangePage />, {
      path: '/portal/changes/:id',
      url: '/portal/changes/c1',
      user: CLIENT,
    });
    expect(
      await screen.findByText(/Delivery moves to 30 Apr 2027 \(now 31 Mar 2027\)/),
    ).toBeInTheDocument();
    // Totals as exact money, with tax shown separately.
    expect(screen.getAllByText(/14,250\.00/).length).toBeGreaterThan(0);

    await userEvent.click(screen.getByRole('button', { name: 'Reject' }));
    const reject = await screen.findByRole('dialog', { name: 'Reject this change?' });
    await userEvent.click(within(reject).getByRole('button', { name: 'Reject' }));
    expect(within(reject).getByText('Write at least 3 characters.')).toBeInTheDocument();
    await userEvent.click(within(reject).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Accept change' }));
    const accept = await screen.findByRole('dialog', { name: /Accept CR-1 version 1/ });
    await userEvent.click(within(accept).getByRole('button', { name: 'Accept' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'POST')).toBe(true));
    const post = calls.find((c) => c.init.method === 'POST')!;
    expect(JSON.parse(post.init.body as string)).toEqual({
      decision: 'ACCEPT',
      contentHash: 'a'.repeat(64),
    });
  });
});

describe('comments (FR-X08)', () => {
  it('authors edit their own comment with the version they saw; edited ones show history', async () => {
    const comments: CommentView[] = [
      {
        id: 'k1',
        author: { id: CLIENT.id, name: 'Omar', client: true },
        body: 'Can it be March?',
        createdAt: '2026-10-25T10:00:00.000Z',
        editedAt: '2026-10-25T11:00:00.000Z',
        deleted: false,
        version: 2,
        mine: true,
      },
      {
        id: 'k2',
        author: { id: PM.id, name: 'Pat', client: false },
        body: 'Yes.',
        createdAt: '2026-10-25T12:00:00.000Z',
        editedAt: null,
        deleted: false,
        version: 1,
        mine: false,
      },
    ];
    const calls = mockFetch((url, init) =>
      init.method === 'PATCH'
        ? ok({ ...comments[0], body: 'Early March?', version: 3 })
        : ok(comments),
    );
    renderRoute(<CommentsThread thread={{ entityType: 'change', entityId: 'c1' }} />, {
      user: CLIENT,
    });
    expect(await screen.findByText('Can it be March?')).toBeInTheDocument();
    expect(screen.getByText('Client')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Earlier versions' })).toBeInTheDocument();
    // Only the author's own comment can be edited.
    expect(screen.getAllByRole('button', { name: /^Edit/ })).toHaveLength(1);
    await userEvent.click(screen.getByRole('button', { name: /^Edit/ }));
    const box = screen.getByLabelText('Edit your comment');
    await userEvent.clear(box);
    await userEvent.type(box, 'Early March?');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(calls.some((c) => c.init.method === 'PATCH')).toBe(true));
    const patch = calls.find((c) => c.init.method === 'PATCH')!;
    expect(patch.url).toBe('/api/v1/portal/comments/k1');
    expect(JSON.parse(patch.init.body as string)).toEqual({ version: 2, body: 'Early March?' });
  });
});
