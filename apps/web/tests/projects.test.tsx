import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ProjectDetail, SessionUser } from '@clientflow/contracts';
import { ConvertDealDialog } from '../src/features/projects/ConvertDealDialog';
import { ProjectDetailPage } from '../src/features/projects/ProjectDetailPage';
import { ProjectOverview } from '../src/features/projects/ProjectOverview';
import { mockFetch, renderRoute, USER } from './utils';

afterEach(() => vi.unstubAllGlobals());

const PM_ID = '018f0000-0000-7000-8000-0000000000f1';
const PM: SessionUser = { ...USER, id: PM_ID, name: 'Pat Manager', role: 'PM' };
const ok = (data: unknown, status = 200) => ({ status, body: { data, meta: { requestId: 'r' } } });

const project = (over: Partial<ProjectDetail> = {}): ProjectDetail => ({
  id: 'p1',
  title: 'Fleet app',
  state: 'PLANNED',
  manager: { id: PM_ID, name: 'Pat Manager' },
  client: 'Fawzi Logistics',
  startOn: null,
  dueOn: '2027-01-31',
  budgetMinor: '3250000',
  currency: 'EGP',
  fromDeal: { id: 'd1', title: 'Fleet app' },
  milestones: { total: 1, done: 0 },
  updatedAt: '2026-10-25T10:00:00.000Z',
  version: 1,
  contact: { id: 'c1', fullName: 'Hany Fawzi' },
  members: [],
  baseline: null,
  milestoneList: [
    { id: 'm1', title: 'Design', dueOn: null, status: 'PLANNED', sequence: 0, version: 1 },
  ],
  checklist: [
    {
      id: 'k1',
      label: 'Kick-off meeting scheduled with the client',
      done: false,
      doneAt: null,
      doneBy: null,
    },
  ],
  activities: [],
  clientOrg: null,
  access: { manage: true, work: true },
  ...over,
});

describe('convert dialog (spec §11.6 idempotency)', () => {
  it('sends an Idempotency-Key and reuses it when retrying after a network failure', async () => {
    let attempt = 0;
    const calls = mockFetch((url, init) => {
      if (url.includes('/projects/staff'))
        return ok([{ id: PM_ID, name: 'Pat Manager', role: 'PM' }]);
      if (init.method === 'POST') {
        attempt += 1;
        if (attempt === 1) throw new TypeError('Failed to fetch');
        return ok({ project: project(), replayed: true });
      }
      return ok([]);
    });
    renderRoute(<ConvertDealDialog dealId="d1" dealTitle="Fleet app" onClose={() => {}} />, {
      path: '/app/deals/d1',
      url: '/app/deals/d1',
      user: PM,
    });
    const dialog = await screen.findByRole('dialog', { name: 'Convert to project' });
    await waitFor(() =>
      expect(within(dialog).getByLabelText(/^Project manager/)).toHaveValue(PM_ID),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Create project' }));
    await waitFor(() => expect(attempt).toBe(1));
    expect(await within(dialog).findByText(/safe to try again/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(attempt).toBe(2));
    const posts = calls.filter((c) => c.init.method === 'POST');
    const keys = posts.map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys[0]).toMatch(/^[0-9a-f-]{36}$/);
    expect(keys[1]).toBe(keys[0]);
    expect(JSON.parse(posts[1]!.init.body as string)).toEqual({
      managerId: PM_ID,
      title: 'Fleet app',
    });
  });
});

const OVERVIEW = [{ index: true, element: <ProjectOverview /> }];

describe('project overview', () => {
  it('managers get state, milestone and checklist controls', async () => {
    mockFetch((url) => (url.includes('/projects/staff') ? ok([]) : ok(project())));
    renderRoute(<ProjectDetailPage />, {
      path: '/app/projects/:id',
      url: '/app/projects/p1',
      children: OVERVIEW,
      user: PM,
    });
    expect(await screen.findByRole('heading', { level: 1, name: 'Fleet app' })).toBeInTheDocument();
    const move = screen.getByLabelText('Change state');
    expect(
      within(move)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Move to…', 'Active', 'On hold', 'Archived']);
    expect(screen.getByLabelText('Status of Design')).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Kick-off meeting/ })).toBeEnabled();
    expect(screen.getByText(/Created without a deal|The agreed scope/)).toBeInTheDocument();
  });

  it('readers without manage rights see the project but no controls', async () => {
    mockFetch(() => ok(project({ access: { manage: false, work: false } })));
    renderRoute(<ProjectDetailPage />, {
      path: '/app/projects/:id',
      url: '/app/projects/p1',
      children: OVERVIEW,
      user: { ...USER, role: 'SALES' },
    });
    expect(
      await screen.findByText(/Only its manager or an admin can change it/),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText('Change state')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Status of Design')).not.toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: /Kick-off meeting/ })).toBeDisabled();
    // Sales can open the deal it came from.
    expect(screen.getByRole('link', { name: 'Fleet app' })).toHaveAttribute(
      'href',
      '/app/deals/d1',
    );
  });

  it('archived projects say so and stay read-only', async () => {
    mockFetch(() => ok(project({ state: 'ARCHIVED', access: { manage: false, work: false } })));
    renderRoute(<ProjectDetailPage />, {
      path: '/app/projects/:id',
      url: '/app/projects/p1',
      children: OVERVIEW,
      user: PM,
    });
    expect(
      await screen.findByText('This project is kept for history and can no longer change.'),
    ).toBeInTheDocument();
  });
});
