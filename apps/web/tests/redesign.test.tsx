import { describe, expect, it } from 'vitest';
import type {
  ContactWithDeals,
  DealSummary,
  InvoiceSummary,
  ProjectSummary,
  ProposalSummary,
} from '@clientflow/contracts';
import { dealSignals, signalReason, STALL_DAYS } from '../src/lib/deal-signals';
import { bounds, buildGraph, layout } from '../src/features/relationships/graph';

const NOW = new Date('2026-11-24T10:00:00Z');
const day = (n: number) => new Date(NOW.getTime() - n * 86_400_000).toISOString();

function deal(over: Partial<DealSummary> = {}): DealSummary {
  return {
    id: 'd1',
    title: 'Clinic app',
    amountMinor: '100000',
    currency: 'EGP',
    status: 'OPEN',
    stage: { id: 's1', name: 'Proposal', position: 3 } as DealSummary['stage'],
    contact: { id: 'c1', fullName: 'Laila Haddad', companyName: 'Haddad Dental' },
    owner: { id: 'u1', name: 'Nour Salem' },
    expectedCloseOn: null,
    nextStep: null,
    nextStepAt: null,
    closedAt: null,
    createdAt: day(30),
    updatedAt: day(20),
    version: 1,
    ...over,
  };
}

describe('deal signals', () => {
  it('flags a deal as stalled only when idle and without a future next step', () => {
    const s = dealSignals(deal(), NOW);
    expect(s.ageDays).toBe(30);
    expect(s.idleDays).toBe(20);
    expect(s.stalled).toBe(true);
    expect(signalReason(s)).toBe('Stalled: no change for 20 days');
  });

  it('does not call an idle deal stalled when a next step is scheduled ahead', () => {
    const s = dealSignals(deal({ nextStepAt: '2026-12-01T09:00:00Z' }), NOW);
    expect(s.stalled).toBe(false);
    expect(s.atRisk).toBe(false);
  });

  it('flags an overdue next step on a recently changed deal without calling it stalled', () => {
    const s = dealSignals(deal({ updatedAt: day(1), nextStepAt: day(2) }), NOW);
    expect(s.stalled).toBe(false);
    expect(s.nextStepOverdue).toBe(true);
    expect(signalReason(s)).toBe('Next step overdue');
  });

  it('never flags closed deals', () => {
    const s = dealSignals(deal({ status: 'WON', updatedAt: day(STALL_DAYS + 30) }), NOW);
    expect(s.atRisk).toBe(false);
  });
});

describe('relationship graph', () => {
  const contact = {
    id: 'c1',
    fullName: 'Laila Haddad',
    companyName: 'Haddad Dental',
    lifecycle: 'CUSTOMER',
    owner: { id: 'u1', name: 'Nour Salem' },
    clientOrg: { id: 'o1', name: 'Haddad Dental Clinics' },
    deals: [deal(), deal({ id: 'd2', title: 'Second', owner: { id: 'u2', name: 'Omar Zaki' } })],
  } as unknown as ContactWithDeals;
  const proposals = [
    {
      id: 'p1',
      reference: 'P-0003',
      title: 'App',
      totalMinor: '1',
      currency: 'EGP',
      deal: { id: 'd1' },
    },
    {
      id: 'p9',
      reference: 'P-0009',
      title: 'Other',
      totalMinor: '1',
      currency: 'EGP',
      deal: { id: 'dX' },
    },
  ] as unknown as ProposalSummary[];
  const projects = [
    {
      id: 'j1',
      title: 'Booking app',
      fromDeal: { id: 'd1', title: 'Clinic app' },
      manager: { id: 'u3', name: 'Yara Mansour' },
      milestones: { total: 3, done: 1 },
    },
  ] as unknown as ProjectSummary[];
  const invoices = [
    {
      id: 'i1',
      reference: 'INV-0004',
      number: 4,
      totalMinor: '5',
      currency: 'EGP',
      displayStatus: 'ISSUED',
      project: { id: 'j1' },
    },
    {
      id: 'i2',
      reference: 'Draft',
      number: null,
      totalMinor: '5',
      currency: 'EGP',
      displayStatus: 'DRAFT',
      project: { id: 'j1' },
    },
    {
      id: 'i9',
      reference: 'INV-0009',
      number: 9,
      totalMinor: '5',
      currency: 'EGP',
      displayStatus: 'ISSUED',
      project: { id: 'jX' },
    },
  ] as unknown as InvoiceSummary[];
  const graph = buildGraph({
    contact,
    proposals,
    projects,
    invoices,
    money: (m, c) => `${c} ${m}`,
  });

  it('only links records through stored foreign keys', () => {
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual(
      [
        'contact:c1',
        'deal:d1',
        'deal:d2',
        'invoice:i1',
        'invoice:i2',
        'org:o1',
        'person:u1',
        'person:u2',
        'person:u3',
        'project:j1',
        'proposal:p1',
      ].sort(),
    );
    expect(graph.nodes.find((n) => n.id === 'invoice:i2')?.label).toBe('Draft invoice');
  });

  it('sizes nodes by their number of links', () => {
    const project = graph.nodes.find((n) => n.id === 'project:j1')!;
    // deal → project, project → manager, project → two invoices
    expect(project.degree).toBe(4);
  });

  it('places every visible node once, with the contact at the centre', () => {
    const placed = layout(graph, () => true);
    expect(placed).toHaveLength(graph.nodes.length);
    expect(placed[0]).toMatchObject({ id: 'contact:c1', x: 0, y: 0 });
    const invoice = placed.find((p) => p.id === 'invoice:i1')!;
    const project = placed.find((p) => p.id === 'project:j1')!;
    expect(invoice.depth).toBe(project.depth + 1);
    const [, , w, h] = bounds(placed);
    expect(w).toBeGreaterThan(0);
    expect(h).toBeGreaterThan(0);
  });

  it('hides filtered kinds and their links', () => {
    const placed = layout(graph, (n) => n.kind !== 'invoice');
    expect(placed.some((p) => p.kind === 'invoice')).toBe(false);
  });
});
