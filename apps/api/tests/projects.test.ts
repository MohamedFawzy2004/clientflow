// M6: won-deal handoff (FR-P01, FR-P02, FR-Q10, US-10, US-18, T-HAND-01, T-HAND-02), project
// states (FR-P03, FR-P11), milestones (FR-P04), checklist, membership scope and the delivery
// dashboard, against the real database.
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/lib/password.js';
import {
  login,
  makeApp,
  ORIGIN,
  PASSWORD,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
  type TestApp,
} from './helpers.js';
import { makeDeal, makeProposal } from './proposal-fixtures.js';

const db = testDb();
let seeded: SeededAgency;
let t: TestApp;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
});
afterAll(() => db.$disconnect());

const id = (k: string) => seeded.users[k]!.id;

async function as(key: string, app = t.app) {
  const { agent, csrf } = await login(app, seeded.users[key]!.email);
  const send = (
    m: 'post' | 'patch',
    p: string,
    b: object = {},
    headers: Record<string, string> = {},
  ) => {
    let r = agent[m](p).set('Origin', ORIGIN).set('X-CSRF-Token', csrf);
    for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
    return r.send(b);
  };
  return {
    get: (p: string) => agent.get(p),
    post: (p: string, b?: object, h?: Record<string, string>) => send('post', p, b, h),
    patch: (p: string, b: object) => send('patch', p, b),
    convert: (dealId: string, body: object, key: string = randomUUID()) =>
      send('post', `/api/v1/deals/${dealId}/convert-to-project`, body, { 'Idempotency-Key': key }),
  };
}

/** salesA's deal, won by the client accepting P-xxxx v1 (fixture totals: subtotal EGP 1,000). */
async function wonDeal(milestones = 'Design · Build · Launch') {
  const deal = await makeDeal(db, seeded.agencyId, id('salesA'), { title: 'Fleet app' });
  const { versionId, proposalId } = await makeProposal(db, {
    agencyId: seeded.agencyId,
    dealId: deal.id,
    createdById: id('salesA'),
    status: 'ACCEPTED',
    milestones,
  });
  await db.deal.update({
    where: { id: deal.id },
    data: {
      status: 'WON',
      closedAt: new Date(),
      closedById: id('manager'),
      acceptedProposalVersionId: versionId,
    },
  });
  return { deal, versionId, proposalId };
}

describe('handoff: convert a won deal (FR-P01, FR-P02, FR-Q10, US-10)', () => {
  it('creates the project, baseline link, milestones, checklist and history in one go', async () => {
    const { deal, versionId, proposalId } = await wonDeal();
    const pm = await as('pm');
    const res = await pm.convert(deal.id, {
      managerId: id('pm'),
      startOn: '2026-11-01',
      dueOn: '2027-01-31',
    });
    expect(res.status).toBe(201);
    const p = res.body.data.project;
    expect(res.body.data.replayed).toBe(false);
    expect(p).toMatchObject({
      title: 'Fleet app',
      state: 'PLANNED',
      manager: { id: id('pm') },
      startOn: '2026-11-01',
      dueOn: '2027-01-31',
      budgetMinor: '100000', // subtotal − discount, excluding VAT
      currency: 'EGP',
      fromDeal: { id: deal.id, title: 'Fleet app' },
      access: { manage: true },
    });
    expect(p.baseline).toMatchObject({ proposalId, versionNo: 1, totalMinor: '114000' });
    expect(p.baseline.items).toHaveLength(1);
    expect(p.milestoneList.map((m: { title: string }) => m.title)).toEqual([
      'Design',
      'Build',
      'Launch',
    ]);
    expect(p.checklist).toHaveLength(5);
    expect(p.activities[0].summary).toMatch(/Project created from deal “Fleet app”/);

    const stored = await db.project.findUniqueOrThrow({ where: { id: p.id } });
    expect(stored.baselineVersionId).toBe(versionId);
    const dealView = (await (await as('salesA')).get(`/api/v1/deals/${deal.id}`)).body.data;
    expect(dealView.project).toEqual({ id: p.id, title: 'Fleet app' });
    expect(
      await db.activity.count({ where: { entityId: deal.id, eventType: 'deal.handoff' } }),
    ).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'project.convert' } })).toBe(1);
  });

  it('needs an Idempotency-Key header with a UUID', async () => {
    const { deal } = await wonDeal();
    const pm = await as('pm');
    const none = await pm.post(`/api/v1/deals/${deal.id}/convert-to-project`, {
      managerId: id('pm'),
    });
    expect(none.status).toBe(422);
    expect(none.body.error.fieldErrors['Idempotency-Key']).toBeDefined();
    expect((await pm.convert(deal.id, { managerId: id('pm') }, 'not-a-uuid')).status).toBe(422);
    expect(await db.project.count()).toBe(0);
  });

  it('T-HAND-01: a retry with the same key returns the same project; other keys get 409', async () => {
    const { deal } = await wonDeal();
    const pm = await as('pm');
    const key = randomUUID();
    const first = await pm.convert(deal.id, { managerId: id('pm') }, key);
    const again = await pm.convert(deal.id, { managerId: id('pm') }, key);
    expect(first.status).toBe(201);
    expect(again.status).toBe(200);
    expect(again.body.data.replayed).toBe(true);
    expect(again.body.data.project.id).toBe(first.body.data.project.id);
    const reused = await pm.convert(deal.id, { managerId: id('pm'), title: 'Other' }, key);
    expect(reused.status).toBe(409);
    expect(reused.body.error.message).toMatch(/already used for a different request/);
    const otherKey = await pm.convert(deal.id, { managerId: id('pm') });
    expect(otherKey.status).toBe(409);
    expect(otherKey.body.error.message).toMatch(/already has a project/);
    expect(await db.project.count()).toBe(1);
    expect(await db.idempotencyRecord.count()).toBe(1);
  });

  it('US-18: simultaneous double submits create one project', async () => {
    const { deal } = await wonDeal();
    const pm = await as('pm');
    const key = randomUUID();
    const same = await Promise.all(
      [1, 2, 3].map(() => pm.convert(deal.id, { managerId: id('pm') }, key)),
    );
    expect(same.map((r) => r.status).sort()).toEqual([200, 200, 201]);
    expect(new Set(same.map((r) => r.body.data.project.id)).size).toBe(1);

    const { deal: deal2 } = await wonDeal();
    const owner = await as('owner');
    const different = await Promise.all([
      pm.convert(deal2.id, { managerId: id('pm') }),
      owner.convert(deal2.id, { managerId: id('pm') }),
      pm.convert(deal2.id, { managerId: id('pm') }),
    ]);
    expect(different.map((r) => r.status).sort()).toEqual([201, 409, 409]);
    expect(await db.project.count()).toBe(2);
    expect(await db.projectMilestone.count()).toBe(6);
  });

  it('T-HAND-02: a failure halfway through leaves nothing behind, and a retry then succeeds', async () => {
    const { deal } = await wonDeal();
    const failing = makeApp({}, db, {
      hooks: {
        beforeHandoffCommit: () => {
          throw new Error('Injected failure after the project rows were written');
        },
      },
    });
    const pm = await as('pm', failing.app);
    const key = randomUUID();
    const res = await pm.convert(deal.id, { managerId: id('pm') }, key);
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toMatch(/Injected/);
    expect(await db.project.count()).toBe(0);
    expect(await db.projectMilestone.count()).toBe(0);
    expect(await db.handoffChecklistItem.count()).toBe(0);
    expect(await db.idempotencyRecord.count()).toBe(0);
    expect(
      await db.activity.count({
        where: { eventType: { in: ['project.created', 'deal.handoff'] } },
      }),
    ).toBe(0);
    expect(await db.auditEvent.count({ where: { action: 'project.convert' } })).toBe(0);

    const retry = await (await as('pm')).convert(deal.id, { managerId: id('pm') }, key);
    expect(retry.status).toBe(201);
    expect(await db.project.count()).toBe(1);
  });

  it('refuses open deals, override-won deals, bad managers and the wrong roles', async () => {
    const pm = await as('pm');
    const open = await makeDeal(db, seeded.agencyId, id('salesA'));
    expect((await pm.convert(open.id, { managerId: id('pm') })).status).toBe(409);

    const override = await makeDeal(db, seeded.agencyId, id('salesA'));
    await db.deal.update({
      where: { id: override.id },
      data: {
        status: 'WON',
        closedAt: new Date(),
        closedById: id('manager'),
        wonOverrideReason: 'PO by email',
      },
    });
    const res = await pm.convert(override.id, { managerId: id('pm') });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/Create the project manually/);

    const { deal } = await wonDeal();
    const badManager = await pm.convert(deal.id, { managerId: id('salesA') });
    expect(badManager.status).toBe(422);
    expect(badManager.body.error.fieldErrors.managerId).toBeDefined();
    expect(
      (await pm.convert('018f0000-0000-7000-8000-000000000000', { managerId: id('pm') })).status,
    ).toBe(404);
    for (const k of ['salesA', 'manager', 'member', 'finance']) {
      expect({
        k,
        s: (await (await as(k)).convert(deal.id, { managerId: id('pm') })).status,
      }).toEqual({ k, s: 403 });
    }
    expect(await db.project.count()).toBe(0);
  });

  it('lists won deals waiting for handoff until they are converted', async () => {
    const { deal } = await wonDeal();
    const pm = await as('pm');
    const queue = (await pm.get('/api/v1/projects/handoff-queue')).body.data;
    expect(queue.map((q: { dealId: string }) => q.dealId)).toEqual([deal.id]);
    await pm.convert(deal.id, { managerId: id('pm') });
    expect((await pm.get('/api/v1/projects/handoff-queue')).body.data).toEqual([]);
    expect((await (await as('salesA')).get('/api/v1/projects/handoff-queue')).status).toBe(403);
  });

  it('a handed-off deal can no longer be reopened', async () => {
    const { deal } = await wonDeal();
    await (await as('pm')).convert(deal.id, { managerId: id('pm') });
    const fresh = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    const res = await (
      await as('manager')
    ).post(`/api/v1/deals/${deal.id}/reopen`, {
      version: fresh.version,
      reason: 'Client wants changes',
    });
    expect(res.status).toBe(409);
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe('WON');
  });
});

describe('project scope (spec §1.1)', () => {
  async function converted() {
    const { deal } = await wonDeal();
    const res = await (await as('pm')).convert(deal.id, { managerId: id('pm') });
    return res.body.data.project as { id: string; version: number };
  }

  it('Owner/Admin see all; the PM sees what they manage; members only after being added', async () => {
    const p = await converted();
    expect((await (await as('owner')).get('/api/v1/projects')).body.data).toHaveLength(1);
    expect((await (await as('admin')).get(`/api/v1/projects/${p.id}`)).status).toBe(200);
    const member = await as('member');
    expect((await member.get(`/api/v1/projects/${p.id}`)).status).toBe(404);
    expect((await member.get('/api/v1/projects')).body.data).toEqual([]);
    await (
      await as('pm')
    )
      .post(`/api/v1/projects/${p.id}/members`, { userId: id('member') })
      .expect(200);
    const asMember = (await member.get(`/api/v1/projects/${p.id}`)).body.data;
    expect(asMember.access.manage).toBe(false);
    expect(
      (await member.patch(`/api/v1/projects/${p.id}`, { version: 1, title: 'x' })).status,
    ).toBe(403);

    // Another PM sees nothing they do not manage.
    const otherPm = await db.user.create({
      data: {
        agencyId: seeded.agencyId,
        emailNorm: 'pm2@agency.test',
        name: 'pm2',
        role: 'PM',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    seeded.users.pm2 = { id: otherPm.id, email: 'pm2@agency.test', role: 'PM' };
    expect((await (await as('pm2')).get(`/api/v1/projects/${p.id}`)).status).toBe(404);
  });

  it('sales read projects from their own deals, read-only; other salespeople and finance get nothing', async () => {
    const p = await converted();
    const a = await as('salesA');
    const view = (await a.get(`/api/v1/projects/${p.id}`)).body.data;
    expect(view.access.manage).toBe(false);
    expect((await a.patch(`/api/v1/projects/${p.id}`, { version: 1, title: 'x' })).status).toBe(
      403,
    );
    expect((await (await as('salesB')).get(`/api/v1/projects/${p.id}`)).status).toBe(404);
    expect((await (await as('manager')).get(`/api/v1/projects/${p.id}`)).status).toBe(200);
    expect((await (await as('finance')).get('/api/v1/projects')).status).toBe(403);
  });
});

describe('project life cycle (FR-P03, FR-P04, FR-P11)', () => {
  async function project() {
    const { deal } = await wonDeal();
    const pm = await as('pm');
    const p = (await pm.convert(deal.id, { managerId: id('pm') })).body.data.project;
    return { pm, p };
  }

  it('moves through allowed states only, with optimistic locking', async () => {
    const { pm, p } = await project();
    const active = await pm.post(`/api/v1/projects/${p.id}/state`, {
      version: p.version,
      state: 'ACTIVE',
    });
    expect(active.body.data.state).toBe('ACTIVE');
    expect(
      (await pm.post(`/api/v1/projects/${p.id}/state`, { version: p.version, state: 'ON_HOLD' }))
        .status,
    ).toBe(409);
    const bad = await pm.post(`/api/v1/projects/${p.id}/state`, {
      version: active.body.data.version,
      state: 'ARCHIVED',
    });
    expect(bad.status).toBe(409);
    expect(bad.body.error.message).toMatch(/active project cannot become archived/);
    const done = await pm.post(`/api/v1/projects/${p.id}/state`, {
      version: active.body.data.version,
      state: 'COMPLETED',
    });
    expect(done.body.data.state).toBe('COMPLETED');
  });

  it('archived projects stay readable and listed on request, but nothing changes', async () => {
    const { pm, p } = await project();
    const archived = await pm.post(`/api/v1/projects/${p.id}/state`, {
      version: p.version,
      state: 'ARCHIVED',
    });
    expect(archived.body.data.access.manage).toBe(false);
    expect(
      (
        await pm.patch(`/api/v1/projects/${p.id}`, {
          version: archived.body.data.version,
          title: 'x',
        })
      ).status,
    ).toBe(409);
    expect((await pm.post(`/api/v1/projects/${p.id}/milestones`, { title: 'Late' })).status).toBe(
      409,
    );
    expect((await pm.get('/api/v1/projects')).body.data).toEqual([]);
    expect((await pm.get('/api/v1/projects?state=ARCHIVED')).body.data).toHaveLength(1);
    expect((await pm.get(`/api/v1/projects/${p.id}`)).body.data.activities.length).toBeGreaterThan(
      0,
    );
  });

  it('milestones: add, complete, stale edits refused; checklist toggles are idempotent', async () => {
    const { pm, p } = await project();
    const added = (
      await pm.post(`/api/v1/projects/${p.id}/milestones`, { title: 'QA', dueOn: '2026-12-15' })
    ).body.data;
    const qa = added.milestoneList.find((m: { title: string }) => m.title === 'QA');
    expect(qa.sequence).toBe(3);
    const doneRes = await pm.patch(`/api/v1/projects/${p.id}/milestones/${qa.id}`, {
      version: 1,
      status: 'DONE',
    });
    expect(doneRes.body.data.milestones).toEqual({ total: 4, done: 1 });
    expect(
      (
        await pm.patch(`/api/v1/projects/${p.id}/milestones/${qa.id}`, {
          version: 1,
          status: 'PLANNED',
        })
      ).status,
    ).toBe(409);

    const item = p.checklist[0];
    const on = (await pm.post(`/api/v1/projects/${p.id}/checklist/${item.id}`, { done: true })).body
      .data.checklist[0];
    expect(on).toMatchObject({ done: true, doneBy: { id: id('pm') } });
    await pm.post(`/api/v1/projects/${p.id}/checklist/${item.id}`, { done: true }).expect(200);
    expect(await db.activity.count({ where: { eventType: 'checklist.toggle' } })).toBe(1);
  });

  it('only delivery roles can join; only Owner/Admin can change the manager', async () => {
    const { pm, p } = await project();
    expect(
      (await pm.post(`/api/v1/projects/${p.id}/members`, { userId: id('salesA') })).status,
    ).toBe(422);
    expect(
      (await pm.patch(`/api/v1/projects/${p.id}`, { version: p.version, managerId: id('admin') }))
        .status,
    ).toBe(403);
    const moved = await (
      await as('owner')
    ).patch(`/api/v1/projects/${p.id}`, { version: p.version, managerId: id('admin') });
    expect(moved.body.data.manager.id).toBe(id('admin'));
    // The previous PM no longer manages it and, not being a member, can no longer see it.
    expect((await pm.get(`/api/v1/projects/${p.id}`)).status).toBe(404);
  });

  it('manual projects: Owner/Admin/PM only, with an exact budget', async () => {
    const pm = await as('pm');
    const res = await pm.post('/api/v1/projects', {
      title: 'Internal retainer',
      managerId: id('pm'),
      budget: '12,500.50',
      currency: 'EGP',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ budgetMinor: '1250050', fromDeal: null, baseline: null });
    expect(res.body.data.milestoneList).toEqual([]);
    expect(
      (
        await pm.post('/api/v1/projects', {
          title: 'x',
          managerId: id('pm'),
          budget: '1.234',
          currency: 'EGP',
        })
      ).status,
    ).toBe(422);
    expect(
      (
        await (
          await as('salesA')
        ).post('/api/v1/projects', { title: 'x', managerId: id('pm'), currency: 'EGP' })
      ).status,
    ).toBe(403);
  });
});

describe('delivery dashboard', () => {
  it('counts projects and milestones in the viewer’s scope', async () => {
    const { deal } = await wonDeal('Kick-off\nBuild');
    const pm = await as('pm');
    const p = (await pm.convert(deal.id, { managerId: id('pm') })).body.data.project;
    const kickoff = p.milestoneList[0];
    await pm.patch(`/api/v1/projects/${p.id}/milestones/${kickoff.id}`, {
      version: 1,
      dueOn: '2020-01-01',
    });
    await wonDeal(); // another won deal waiting for handoff
    const d = (await pm.get('/api/v1/dashboard/delivery')).body.data;
    expect(d.projects.PLANNED).toBe(1);
    expect(d.milestones.overdue).toBe(1);
    expect(d.handoffWaiting).toBe(1);
    expect(d.upcoming[0]).toMatchObject({ milestone: 'Kick-off', overdue: true });
    const m = (await (await as('member')).get('/api/v1/dashboard/delivery')).body.data;
    expect(m.projects.PLANNED).toBe(0);
    expect(m.handoffWaiting).toBeNull();
    expect((await (await as('salesA')).get('/api/v1/dashboard/delivery')).status).toBe(403);
  });
});
