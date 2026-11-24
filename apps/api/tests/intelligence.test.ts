// Final signature release (ADR-072): relationship graph, sales / finance / delivery intelligence
// and project plans. Each test checks a role sees exactly what its existing scopes allow: no
// node, count or total leaks from a record the role could not open on its own page.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import type {
  DeliveryIntelligence,
  FinanceIntelligence,
  ProjectPlan,
  RelationshipGraphData,
  SalesIntelligence,
} from '@clientflow/contracts';
import { agencyToday } from '../src/lib/agency-time.js';
import {
  login,
  makeApp,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
  type TestApp,
} from './helpers.js';
import { makeClientOrg, makeDeal, makeProject, makeProposal } from './proposal-fixtures.js';

const db = testDb();
let seeded: SeededAgency;
let t: TestApp;
let today: string;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
  const agency = await db.agency.findUniqueOrThrow({ where: { id: seeded.agencyId } });
  today = agencyToday(new Date(), agency.timezone);
});
afterAll(() => db.$disconnect());

const id = (k: string) => seeded.users[k]!.id;
async function as(key: string) {
  const { agent } = await login(t.app, seeded.users[key]!.email);
  return { get: (p: string) => agent.get(p) };
}
let invoiceNo = 0;

/** salesA's contact with a deal owned by salesA and one owned by salesB, a project and invoices. */
async function clientWorld() {
  const contact = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId: id('salesA'), fullName: 'Nadia Client' },
  });
  const mine = await makeDeal(db, seeded.agencyId, id('salesA'), {
    contactId: contact.id,
    title: 'Mine: website',
  });
  const theirs = await makeDeal(db, seeded.agencyId, id('salesB'), {
    contactId: contact.id,
    title: 'Theirs: retainer',
    currency: 'USD',
  });
  const { orgId } = await makeClientOrg(db, seeded.agencyId, contact.id, {
    email: 'nadia@client.test',
  });
  const accepted = (dealId: string) =>
    makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId,
      createdById: id('owner'),
      status: 'ACCEPTED',
      clientOrgId: orgId,
    });
  const mineProposal = await accepted(mine.id);
  const theirsProposal = await accepted(theirs.id);
  const linked = await makeProject(db, {
    agencyId: seeded.agencyId,
    managerId: id('pm'),
    createdById: id('pm'),
    title: 'Website build',
    dealId: mine.id,
    baselineVersionId: mineProposal.versionId,
    clientOrgId: orgId,
    memberIds: [id('member')],
  });
  const hidden = await makeProject(db, {
    agencyId: seeded.agencyId,
    managerId: id('owner'),
    createdById: id('owner'),
    title: 'Retainer delivery',
    dealId: theirs.id,
    baselineVersionId: theirsProposal.versionId,
    clientOrgId: orgId,
  });
  const invoice = (projectId: string, currency: string, totalMinor: bigint) =>
    db.invoice.create({
      data: {
        agencyId: seeded.agencyId,
        clientOrgId: orgId,
        projectId,
        number: ++invoiceNo,
        status: 'ISSUED',
        currency,
        dueOn: new Date('2099-01-31'),
        issuedOn: new Date(`${today}T00:00:00Z`),
        issuedAt: new Date(),
        issuedById: id('finance'),
        subtotalMinor: totalMinor,
        taxMinor: 0n,
        totalMinor,
        createdById: id('finance'),
      },
    });
  const inv1 = await invoice(linked.projectId, 'EGP', 500_000n);
  const inv2 = await invoice(hidden.projectId, 'USD', 90_000n);
  return { contact, mine, theirs, orgId, linked, hidden, inv1, inv2 };
}

describe('GET /contacts/:id/graph', () => {
  it('a rep sees only their own deals on their contact, and no invoices or deliverables', async () => {
    const w = await clientWorld();
    const res = await (await as('salesA')).get(`/api/v1/contacts/${w.contact.id}/graph`);
    expect(res.status).toBe(200);
    const g = res.body.data as RelationshipGraphData;
    expect(g.deals.map((d) => d.title)).toEqual(['Mine: website']);
    // The project reached through salesB's deal is not reachable for salesA.
    expect(g.projects.map((p) => p.title)).toEqual(['Website build']);
    expect(g.readable).toMatchObject({ deals: true, invoices: false, deliverables: false });
    expect(g.invoices).toEqual([]);
    expect(g.deliverables).toEqual([]);
    expect(JSON.stringify(g)).not.toContain('Theirs');
    expect(JSON.stringify(g)).not.toContain('Retainer');
  });

  it('a sales manager sees every deal on the contact, still without invoices', async () => {
    const w = await clientWorld();
    const g = (await (await as('manager')).get(`/api/v1/contacts/${w.contact.id}/graph`)).body
      .data as RelationshipGraphData;
    expect(g.deals.map((d) => d.title).sort()).toEqual(['Mine: website', 'Theirs: retainer']);
    expect(g.deals.find((d) => d.currency === 'USD')!.amountMinor).toBe('100000');
    expect(g.projects).toHaveLength(2);
    expect(g.invoices).toEqual([]);
  });

  it('the owner sees invoices per currency, never summed across currencies', async () => {
    const w = await clientWorld();
    const g = (await (await as('owner')).get(`/api/v1/contacts/${w.contact.id}/graph`)).body
      .data as RelationshipGraphData;
    expect(g.readable.invoices).toBe(true);
    expect(g.invoices.map((i) => [i.currency, i.totalMinor]).sort()).toEqual([
      ['EGP', '500000'],
      ['USD', '90000'],
    ]);
    expect(g.truncated.deals).toBe(false);
  });

  it("another rep's contact is a 404, a role with no contact access is a 403", async () => {
    const w = await clientWorld();
    expect((await (await as('salesB')).get(`/api/v1/contacts/${w.contact.id}/graph`)).status).toBe(
      404,
    );
    for (const role of ['pm', 'member', 'finance']) {
      const res = await (await as(role)).get(`/api/v1/contacts/${w.contact.id}/graph`);
      expect(res.status, role).toBe(403);
    }
    expect((await (await as('owner')).get('/api/v1/contacts/not-a-uuid/graph')).status).toBe(404);
  });

  it('a contact in another agency is a 404 even for the owner', async () => {
    const other = await db.agency.create({ data: { name: 'Other Agency', slug: 'other-intel' } });
    const stranger = await db.user.create({
      data: {
        agencyId: other.id,
        emailNorm: 'x@other.test',
        name: 'X',
        role: 'OWNER',
        passwordHash: 'x',
      },
    });
    const c = await db.contact.create({
      data: { agencyId: other.id, ownerId: stranger.id, fullName: 'Elsewhere' },
    });
    expect((await (await as('owner')).get(`/api/v1/contacts/${c.id}/graph`)).status).toBe(404);
  });
});

describe('GET /insights/sales', () => {
  it("counts only the rep's own deals and keeps open value per currency", async () => {
    await clientWorld();
    const mineOnly = (await (await as('salesA')).get('/api/v1/insights/sales')).body
      .data as SalesIntelligence;
    const all = (await (await as('manager')).get('/api/v1/insights/sales')).body
      .data as SalesIntelligence;
    const open = (s: SalesIntelligence) => s.stages.reduce((n, st) => n + st.open, 0);
    expect(open(mineOnly)).toBe(1);
    expect(open(all)).toBe(2);
    expect(all.stages[0]!.totals).toEqual({ EGP: '100000', USD: '100000' });
    expect(mineOnly.stages[0]!.totals).toEqual({ EGP: '100000' });
    // A deal that never moved counts its age from creation: today.
    expect(all.stages[0]!.age.d0to7).toBe(2);
    expect(all.monthly).toHaveLength(12);
    expect(all.monthly.at(-1)!.created).toBe(2);
  });

  it('validates months and refuses roles without the sales dashboard', async () => {
    expect((await (await as('owner')).get('/api/v1/insights/sales?months=2')).status).toBe(422);
    expect((await (await as('owner')).get('/api/v1/insights/sales?x=1')).status).toBe(422);
    expect(
      (await (await as('owner')).get('/api/v1/insights/sales?months=6')).body.data.monthly,
    ).toHaveLength(6);
    for (const role of ['pm', 'member', 'finance']) {
      expect((await (await as(role)).get('/api/v1/insights/sales')).status, role).toBe(403);
    }
  });
});

describe('GET /insights/finance', () => {
  it('finance sees every invoice; a PM only those of projects they can read', async () => {
    const w = await clientWorld();
    // The ledger trigger checks paidMinor against the payments at commit: write both together.
    await db.$transaction([
      db.payment.create({
        data: {
          agencyId: seeded.agencyId,
          invoiceId: w.inv1.id,
          amountMinor: 200_000n,
          currency: 'EGP',
          receivedOn: new Date(`${today}T00:00:00Z`),
          recordedById: id('finance'),
        },
      }),
      db.invoice.update({
        where: { id: w.inv1.id },
        data: { paidMinor: 200_000n, status: 'PARTIALLY_PAID' },
      }),
    ]);
    const fin = (await (await as('finance')).get('/api/v1/insights/finance')).body
      .data as FinanceIntelligence;
    expect(fin.monthly.map((s) => s.currency)).toEqual(['EGP', 'USD']);
    const egp = fin.monthly[0]!.points.at(-1)!;
    expect(egp).toMatchObject({ invoicedMinor: '500000', receivedMinor: '200000' });
    expect(fin.monthly[1]!.points.at(-1)!.invoicedMinor).toBe('90000');
    expect(fin.projects.map((p) => p.title).sort()).toEqual(['Retainer delivery', 'Website build']);

    const pm = (await (await as('pm')).get('/api/v1/insights/finance')).body
      .data as FinanceIntelligence;
    expect(pm.monthly.map((s) => s.currency)).toEqual(['EGP']);
    expect(pm.projects.map((p) => p.title)).toEqual(['Website build']);
    expect(JSON.stringify(pm)).not.toContain('Retainer');
  });

  it('a reversal reduces received money in its month', async () => {
    const w = await clientWorld();
    const pay = (
      kind: 'PAYMENT' | 'REVERSAL',
      amountMinor: bigint,
      paidAfter: bigint,
      reversesId?: string,
    ) =>
      db.$transaction(async (tx) => {
        const created = await tx.payment.create({
          data: {
            agencyId: seeded.agencyId,
            invoiceId: w.inv1.id,
            amountMinor,
            currency: 'EGP',
            receivedOn: new Date(`${today}T00:00:00Z`),
            recordedById: id('finance'),
            kind,
            reversesId,
          },
        });
        await tx.invoice.update({
          where: { id: w.inv1.id },
          data: { paidMinor: paidAfter, status: paidAfter > 0n ? 'PARTIALLY_PAID' : 'ISSUED' },
        });
        return created;
      });
    const p = await pay('PAYMENT', 300_000n, 300_000n);
    await pay('REVERSAL', 300_000n, 0n, p.id);
    const fin = (await (await as('finance')).get('/api/v1/insights/finance')).body
      .data as FinanceIntelligence;
    expect(fin.monthly[0]!.points.at(-1)!.receivedMinor).toBe('0');
  });

  it('profitability: budget, accepted changes, dated time cost and margin, for finance only', async () => {
    const w = await clientWorld();
    await db.project.update({
      where: { id: w.linked.projectId },
      data: { budgetMinor: 1_000_000n },
    });
    const task = await db.task.create({
      data: {
        agencyId: seeded.agencyId,
        projectId: w.linked.projectId,
        title: 'Build',
        createdById: id('pm'),
      },
    });
    // 90 minutes at EGP 200.00/h = EGP 300.00; a USD rate on the same project is left out.
    await db.costRate.createMany({
      data: [
        {
          agencyId: seeded.agencyId,
          userId: id('member'),
          hourlyMinor: 20_000n,
          currency: 'EGP',
          effectiveFrom: new Date('2020-01-01'),
          setById: id('owner'),
        },
        {
          agencyId: seeded.agencyId,
          userId: id('pm'),
          hourlyMinor: 5_000n,
          currency: 'USD',
          effectiveFrom: new Date('2020-01-01'),
          setById: id('owner'),
        },
      ],
    });
    const entry = (userId: string, minutes: number) => ({
      agencyId: seeded.agencyId,
      projectId: w.linked.projectId,
      taskId: task.id,
      userId,
      workedOn: new Date(`${today}T00:00:00Z`),
      minutes,
    });
    await db.timeEntry.createMany({ data: [entry(id('member'), 90), entry(id('pm'), 30)] });

    const fin = (await (await as('finance')).get('/api/v1/insights/finance')).body
      .data as FinanceIntelligence;
    const row = fin.profitability!.find((r) => r.id === w.linked.projectId)!;
    expect(row).toMatchObject({
      currency: 'EGP',
      budgetMinor: '1000000',
      acceptedChangesMinor: '0',
      originalBudgetMinor: '1000000',
      invoicedMinor: '500000',
      estimatedCostMinor: '30000',
      estimatedMarginMinor: '970000',
      costCompletenessPercent: 75,
    });
    // Each project stays in its own currency; nothing is converted or summed.
    const hidden = await db.project.findUniqueOrThrow({ where: { id: w.hidden.projectId } });
    expect(fin.profitability!.find((r) => r.id === w.hidden.projectId)).toMatchObject({
      currency: hidden.currency,
      estimatedCostMinor: '0',
      costCompletenessPercent: 100,
    });

    const pm = (await (await as('pm')).get('/api/v1/insights/finance')).body
      .data as FinanceIntelligence;
    expect(pm.profitability).toBeNull();
    expect(JSON.stringify(pm)).not.toContain('estimatedCostMinor');
  });

  it('sales and members get a 403', async () => {
    for (const role of ['salesA', 'manager', 'member']) {
      expect((await (await as(role)).get('/api/v1/insights/finance')).status, role).toBe(403);
    }
  });
});

describe('GET /insights/delivery and /projects/:id/plan', () => {
  async function delivery() {
    const w = await clientWorld();
    const task = (projectId: string, title: string, extra: object = {}) =>
      db.task.create({
        data: {
          agencyId: seeded.agencyId,
          projectId,
          title,
          createdById: id('pm'),
          ...extra,
        },
      });
    const design = await task(w.linked.projectId, 'Design', {
      assigneeId: id('member'),
      dueOn: new Date('2020-01-01T00:00:00Z'),
      estimateMinutes: 120,
    });
    const build = await task(w.linked.projectId, 'Build', {
      assigneeId: id('member'),
      status: 'BLOCKED',
    });
    await task(w.hidden.projectId, 'Secret retainer task', { assigneeId: id('admin') });
    await db.taskDependency.create({
      data: { projectId: w.linked.projectId, taskId: build.id, dependsOnId: design.id },
    });
    const entry = (userId: string, minutes: number) =>
      db.timeEntry.create({
        data: {
          agencyId: seeded.agencyId,
          projectId: w.linked.projectId,
          taskId: design.id,
          userId,
          workedOn: new Date(`${today}T00:00:00Z`),
          minutes,
        },
      });
    await entry(id('member'), 30);
    await entry(id('pm'), 90);
    return { ...w, design, build };
  }

  it('a member sees only their projects, their own logged time, and counts without capacity', async () => {
    await delivery();
    const d = (await (await as('member')).get('/api/v1/insights/delivery')).body
      .data as DeliveryIntelligence;
    expect(d.projects.map((p) => p.title)).toEqual(['Website build']);
    expect(d.projects[0]).toMatchObject({
      loggedMinutes: 30,
      loggedScope: 'own',
      estimateMinutes: 120,
      tasks: { total: 2, open: 2, blocked: 1, overdue: 1, done: 0 },
    });
    expect(d.people.map((p) => p.name)).toEqual(['member user']);
    expect(d.weekStarts).toHaveLength(6);
    expect(JSON.stringify(d)).not.toContain('Retainer');
  });

  it("the project's manager sees everyone's time; the owner sees every project", async () => {
    await delivery();
    const pm = (await (await as('pm')).get('/api/v1/insights/delivery')).body
      .data as DeliveryIntelligence;
    expect(pm.projects[0]).toMatchObject({ loggedMinutes: 120, loggedScope: 'all' });
    const owner = (await (await as('owner')).get('/api/v1/insights/delivery')).body
      .data as DeliveryIntelligence;
    expect(owner.projects.map((p) => p.title).sort()).toEqual([
      'Retainer delivery',
      'Website build',
    ]);
    expect(owner.people.map((p) => p.name).sort()).toEqual(['admin user', 'member user']);
  });

  it('a plan lists tasks and stored dependencies, inside the project scope only', async () => {
    const w = await delivery();
    const plan = (await (await as('member')).get(`/api/v1/projects/${w.linked.projectId}/plan`))
      .body.data as ProjectPlan;
    expect(plan.tasks.map((x) => x.title).sort()).toEqual(['Build', 'Design']);
    expect(plan.dependencies).toEqual([{ taskId: w.build.id, dependsOnId: w.design.id }]);
    expect(plan.milestones[0]!.title).toBe('Kick-off');
    expect(
      (await (await as('member')).get(`/api/v1/projects/${w.hidden.projectId}/plan`)).status,
    ).toBe(404);
    for (const role of ['salesA', 'manager', 'finance']) {
      expect(
        (await (await as(role)).get(`/api/v1/projects/${w.linked.projectId}/plan`)).status,
        role,
      ).toBe(403);
      expect((await (await as(role)).get('/api/v1/insights/delivery')).status, role).toBe(403);
    }
  });
});
