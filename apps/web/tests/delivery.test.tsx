import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  PortalDeliverableDetail,
  ProjectDetail,
  SessionUser,
  TaskBoard,
  TaskView,
} from '@clientflow/contracts';
import { ProjectDetailPage } from '../src/features/projects/ProjectDetailPage';
import { TaskBoardPage } from '../src/features/delivery/TaskBoardPage';
import { FilesPage } from '../src/features/delivery/FilesPage';
import { PortalDeliverablePage } from '../src/features/portal/PortalDeliverablePage';
import { PortalProjectPage } from '../src/features/portal/PortalProjectPage';
import { errorBody, mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const ok = (data: unknown, status = 200) => ({ status, body: { data, meta: { requestId: 'r' } } });
const MEMBER: SessionUser = {
  ...USER,
  id: '018f0000-0000-7000-8000-0000000000aa',
  name: 'Mina Adel',
  role: 'MEMBER',
};
const CLIENT: SessionUser = {
  ...USER,
  id: '018f0000-0000-7000-8000-0000000000cc',
  name: 'Omar Client',
  role: 'CLIENT',
  clientOrg: { id: 'o1', name: 'Harbour Co.' },
};

const project = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 'p1',
  title: 'Fleet app',
  state: 'ACTIVE',
  manager: { id: 'pm', name: 'Pat Morgan' },
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
  members: [{ id: MEMBER.id, name: MEMBER.name, role: 'MEMBER' }],
  baseline: null,
  milestoneList: [],
  checklist: [],
  activities: [],
  scopeHistory: { originalBudgetMinor: '0', currentBudgetMinor: '0', currency: 'EGP', changes: [] },
  clientOrg: { id: 'o1', name: 'Harbour Co.' },
  access: { manage: false, work: true },
  ...over,
});

const task = (over: Partial<TaskView>): TaskView => ({
  id: 't1',
  projectId: 'p1',
  title: 'Homepage',
  description: null,
  status: 'TODO',
  priority: 'MEDIUM',
  assignee: { id: MEMBER.id, name: MEMBER.name },
  milestone: null,
  dueOn: null,
  overdue: false,
  estimateMinutes: null,
  loggedMinutes: 0,
  scope: 'BASELINE',
  change: null,
  scopeNote: null,
  openBlockers: [],
  completedAt: null,
  updatedAt: '2026-10-25T10:00:00.000Z',
  version: 3,
  access: { edit: false, status: true, logTime: true },
  ...over,
});

describe('task board (FR-P07, US-11)', () => {
  it('members move their own task with a status select, without drag and drop', async () => {
    const board: TaskBoard = {
      tasks: [
        task({}),
        task({
          id: 't2',
          title: 'Someone else’s',
          assignee: null,
          access: { edit: false, status: false, logTime: true },
          openBlockers: [{ id: 't1', title: 'Homepage', status: 'TODO' }],
        }),
      ],
      assignees: [],
      access: { create: false },
    };
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/projects/p1')) return ok(project());
      if (url.includes('/tasks/t1/status') && init.method === 'POST') return ok(task({}));
      return ok(board);
    });
    renderRoute(<ProjectDetailPage />, {
      path: '/app/projects/:id',
      url: '/app/projects/p1/board',
      user: MEMBER,
      children: [{ path: 'board', element: <TaskBoardPage /> }],
    });
    const select = await screen.findByLabelText('Status of Homepage');
    // No "Canceled" for an assignee, no select on someone else's task, no "New task".
    expect(within(select).queryByRole('option', { name: 'Canceled' })).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status of Someone else’s')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /New task/ })).not.toBeInTheDocument();
    expect(screen.getByText('Waits for 1')).toBeInTheDocument();
    // Tabs: the team sees the delivery sections.
    expect(screen.getByRole('link', { name: 'Files' })).toHaveAttribute(
      'href',
      '/app/projects/p1/files',
    );

    await userEvent.selectOptions(select, 'IN_PROGRESS');
    await waitFor(() =>
      expect(
        calls.some((c) => c.url.includes('/tasks/t1/status') && c.init.method === 'POST'),
      ).toBe(true),
    );
    const post = calls.find((c) => c.url.includes('/tasks/t1/status'))!;
    expect(JSON.parse(post.init.body as string)).toEqual({ version: 3, status: 'IN_PROGRESS' });
  });

  it('linked sales readers get the overview only, without delivery tabs', async () => {
    mockFetch(() => ok(project({ access: { manage: false, work: false } })));
    renderRoute(<ProjectDetailPage />, {
      path: '/app/projects/:id',
      url: '/app/projects/p1',
      user: { ...USER, role: 'SALES' },
      children: [{ index: true, element: <p>Overview content</p> }],
    });
    expect(await screen.findByText('Overview content')).toBeInTheDocument();
    // Sales see the overview and the changes, never the delivery tabs.
    const nav = screen.getByRole('navigation', { name: 'Project sections' });
    expect(
      within(nav)
        .getAllByRole('link')
        .map((l) => l.textContent),
    ).toEqual(['Overview', 'Changes']);
  });
});

describe('file uploads (SEC-12)', () => {
  it('streams the raw file with its name and shows the server’s refusal', async () => {
    const calls = mockFetch((url, init) => {
      if (url.endsWith('/projects/p1')) return ok(project());
      if (url.endsWith('/files') && init.method === 'POST') {
        return {
          status: 422,
          body: errorBody('VALIDATION_FAILED', 'Some fields need your attention.', {
            file: ['Text files cannot contain HTML or scripts. Send a PDF instead.'],
          }),
        };
      }
      return ok({
        files: [],
        limits: { maxBytes: 1024, extensions: ['pdf', 'txt'] },
        access: { upload: true },
      });
    });
    const { container } = renderRoute(<ProjectDetailPage />, {
      path: '/app/projects/:id',
      url: '/app/projects/p1/files',
      user: MEMBER,
      children: [{ path: 'files', element: <FilesPage /> }],
    });
    expect(await screen.findByText('No files yet')).toBeInTheDocument();
    const input = container.querySelector<HTMLInputElement>('input[type=file]')!;
    expect(input.accept).toBe('.pdf,.txt');

    // Too big: refused before any request.
    await userEvent.upload(input, new File(['x'.repeat(2048)], 'big.pdf'));
    expect(await screen.findByText('“big.pdf” is larger than 1 KB.')).toBeInTheDocument();
    expect(calls.some((c) => c.init.method === 'POST')).toBe(false);

    await userEvent.upload(input, new File(['<script>'], 'notes é.txt', { type: 'text/plain' }));
    expect(
      await screen.findByText('Text files cannot contain HTML or scripts. Send a PDF instead.'),
    ).toBeInTheDocument();
    const post = calls.find((c) => c.init.method === 'POST')!;
    const headers = post.init.headers as Record<string, string>;
    expect(headers['X-File-Name']).toBe('notes%20%C3%A9.txt');
    expect(headers['Content-Type']).toBe('application/octet-stream');
    expect(post.init.body).toBeInstanceOf(File);
  });
});

const deliverable = (over: Partial<PortalDeliverableDetail> = {}): PortalDeliverableDetail => ({
  id: 'd1',
  project: { id: 'p1', title: 'Fleet app' },
  title: 'Homepage design',
  description: null,
  state: 'AWAITING_REVIEW',
  reviewDueOn: '2020-01-01',
  overdue: true,
  versions: [
    {
      id: 'v2',
      versionNo: 2,
      note: 'Bigger logo',
      publishedAt: '2026-10-25T10:00:00.000Z',
      file: { id: 'f2', name: 'home-v2.pdf', extension: 'pdf', sizeBytes: 2048 },
      review: null,
    },
    {
      id: 'v1',
      versionNo: 1,
      note: null,
      publishedAt: '2026-10-20T10:00:00.000Z',
      file: { id: 'f1', name: 'home.pdf', extension: 'pdf', sizeBytes: 1024 },
      review: {
        decision: 'REVISION_REQUESTED',
        reason: 'Logo too small',
        at: '2026-10-21T10:00:00.000Z',
      },
    },
  ],
  openVersionId: 'v2',
  ...over,
});

describe('client deliverable review (FR-S07, US-13)', () => {
  it('approves exactly the open version, and a revision needs a reason', async () => {
    const calls = mockFetch((url, init) =>
      url.includes('/portal/comments')
        ? ok([])
        : init.method === 'POST' && url.includes('/decision')
          ? ok(deliverable({ state: 'APPROVED', openVersionId: null }))
          : ok(deliverable()),
    );
    renderRoute(<PortalDeliverablePage />, {
      path: '/portal/deliverables/:id',
      url: '/portal/deliverables/d1',
      user: CLIENT,
    });
    expect(await screen.findByRole('heading', { name: 'Homepage design' })).toBeInTheDocument();
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('“Logo too small”')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Request a revision' }));
    const dialog = await screen.findByRole('dialog', { name: 'Request a revision?' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Send request' }));
    expect(within(dialog).getByText('Write at least 3 characters.')).toBeInTheDocument();
    expect(calls.some((c) => c.url.includes('/decision'))).toBe(false);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    await userEvent.click(screen.getByRole('button', { name: 'Approve version 2' }));
    const confirm = await screen.findByRole('dialog', {
      name: /Approve “Homepage design” version 2/,
    });
    await userEvent.click(within(confirm).getByRole('button', { name: 'Approve' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/decision'))).toBe(true));
    const post = calls.find((c) => c.url.includes('/decision'))!;
    expect(JSON.parse(post.init.body as string)).toEqual({ versionId: 'v2', decision: 'APPROVE' });
  });

  it('a project that is not shared reads as not found', async () => {
    mockFetch(() => ({
      status: 404,
      body: errorBody('NOT_FOUND', 'We could not find that record.'),
    }));
    renderRoute(<PortalProjectPage />, {
      path: '/portal/projects/:id',
      url: '/portal/projects/p9',
      user: CLIENT,
    });
    expect(
      await screen.findByText('It does not exist or it is not shared with you.'),
    ).toBeInTheDocument();
  });
});
