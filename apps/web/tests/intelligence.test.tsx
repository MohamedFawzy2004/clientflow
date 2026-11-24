// Final signature release: the relationship graph and plan timeline turn server data into
// nodes, links and bars without inventing anything.
import { describe, expect, it } from 'vitest';
import type { ProjectPlan, RelationshipGraphData } from '@clientflow/contracts';
import { buildServerGraph } from '../src/features/relationships/graph';
import { planRows } from '../src/features/intelligence/ProjectPlanPage';

const money = (minor: string, currency: string) => `${currency} ${minor}`;
const person = (id: string) => ({ id, name: `Person ${id}` });

function graphData(overrides: Partial<RelationshipGraphData> = {}): RelationshipGraphData {
  return {
    contact: {
      id: 'c1',
      fullName: 'Nadia Client',
      companyName: 'Nadia Co',
      lifecycle: 'CUSTOMER',
      source: 'REFERRAL',
      owner: person('u1'),
      clientOrg: { id: 'o1', name: 'Nadia Co' },
    },
    readable: {
      deals: true,
      proposals: true,
      projects: true,
      invoices: false,
      deliverables: false,
    },
    deals: [
      {
        id: 'd1',
        title: 'Website',
        status: 'WON',
        stage: 'Proposal',
        amountMinor: '100000',
        currency: 'EGP',
        owner: person('u2'),
      },
    ],
    proposals: [
      {
        id: 'p1',
        reference: 'P-0001',
        title: 'Website build',
        status: 'ACCEPTED',
        dealId: 'd1',
        totalMinor: '114000',
        currency: 'EGP',
      },
    ],
    projects: [
      {
        id: 'pr1',
        title: 'Website delivery',
        state: 'ACTIVE',
        dealId: 'd1',
        manager: person('u3'),
        milestones: { done: 1, total: 3 },
      },
      {
        id: 'pr2',
        title: 'Direct retainer',
        state: 'PLANNED',
        dealId: null,
        manager: person('u3'),
        milestones: { done: 0, total: 1 },
      },
    ],
    invoices: [],
    deliverables: [],
    truncated: {
      deals: false,
      proposals: false,
      projects: false,
      invoices: false,
      deliverables: false,
    },
    ...overrides,
  };
}

describe('buildServerGraph', () => {
  it('links every record through its stored key and nothing else', () => {
    const g = buildServerGraph(graphData(), money);
    const has = (from: string, to: string, label: string) =>
      g.edges.some((e) => e.from === from && e.to === to && e.label === label);
    expect(has('contact:c1', 'org:o1', 'belongs to')).toBe(true);
    expect(has('contact:c1', 'deal:d1', 'deal')).toBe(true);
    expect(has('deal:d1', 'person:u2', 'owned by')).toBe(true);
    expect(has('deal:d1', 'proposal:p1', 'proposal')).toBe(true);
    expect(has('deal:d1', 'project:pr1', 'handed off to')).toBe(true);
    // A project with no deal hangs off the contact, not off a guessed deal.
    expect(has('contact:c1', 'project:pr2', 'project')).toBe(true);
    expect(g.nodes.find((n) => n.id === 'project:pr2')!.parent).toBeNull();
    // Every edge points at nodes that exist.
    const ids = new Set(g.nodes.map((n) => n.id));
    expect(g.edges.every((e) => ids.has(e.from) && ids.has(e.to))).toBe(true);
  });

  it('draws no invoice or deliverable node when the server sent none', () => {
    const g = buildServerGraph(graphData(), money);
    expect(g.nodes.some((n) => n.kind === 'invoice' || n.kind === 'deliverable')).toBe(false);
  });

  it('skips a link whose target the viewer cannot see', () => {
    const g = buildServerGraph(
      graphData({
        invoices: [
          {
            id: 'i1',
            reference: 'INV-0001',
            status: 'ISSUED',
            projectId: 'not-visible',
            totalMinor: '1',
            paidMinor: '0',
            currency: 'EGP',
          },
        ],
      }),
      money,
    );
    expect(g.edges.some((e) => e.to === 'invoice:i1')).toBe(false);
  });
});

describe('planRows', () => {
  const plan: ProjectPlan = {
    project: { id: 'p', title: 'Build', startOn: '2026-11-01', dueOn: '2027-01-31' },
    milestones: [
      { id: 'm2', title: 'Build', dueOn: '2026-12-20', status: 'PLANNED', sequence: 1 },
      { id: 'm1', title: 'Design', dueOn: '2026-11-20', status: 'DONE', sequence: 0 },
      { id: 'm3', title: 'Launch', dueOn: null, status: 'PLANNED', sequence: 2 },
    ],
    tasks: [
      {
        id: 't1',
        title: 'Wireframes',
        status: 'TODO',
        priority: 'MEDIUM',
        dueOn: '2026-11-10',
        milestoneId: 'm1',
        assignee: null,
        estimateMinutes: null,
      },
      {
        id: 't2',
        title: 'Loose end',
        status: 'DONE',
        priority: 'LOW',
        dueOn: '2026-12-01',
        milestoneId: null,
        assignee: null,
        estimateMinutes: null,
      },
    ],
    dependencies: [],
  };

  it('windows each milestone from the previous due date and never invents dates', () => {
    const rows = planRows(plan, '2026-11-24');
    expect(rows.map((r) => [r.name, r.start, r.end])).toEqual([
      ['Design', '2026-11-01', '2026-11-20'],
      ['Build', '2026-11-20', '2026-12-20'],
      ['Launch', null, null],
      ['Tasks without a milestone', null, null],
    ]);
    // A past-due open task is marked late; a done milestone is done.
    const design = rows[0]!.markers;
    expect(design.find((m) => m.id === 't1')!.state).toBe('late');
    expect(design.find((m) => m.id === 'ms-m1')!.state).toBe('done');
    expect(rows[3]!.markers.map((m) => m.state)).toEqual(['done']);
  });
});
