import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
  type TestApp,
} from './helpers.js';

const db = testDb();
let seeded: SeededAgency;
let t: TestApp;
let stages: Array<{ id: string; name: string }>;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
  const pipeline = await db.pipeline.findFirstOrThrow({
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  stages = pipeline.stages;
});
afterAll(() => db.$disconnect());

async function as(key: string) {
  const { agent, csrf } = await login(t.app, seeded.users[key]!.email);
  const send = (method: 'post' | 'patch', path: string, body: object = {}) =>
    agent[method](path).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body);
  const post = (p: string, b?: object) => send('post', p, b);
  return {
    agent,
    post,
    patch: (p: string, b: object) => send('patch', p, b),
    lead: async (name = 'Salma Ibrahim') =>
      (await post('/api/v1/contacts', { fullName: name })).body.data as { id: string },
    deal: async (contactId: string, body: object = {}) => {
      const res = await post('/api/v1/deals', {
        contactId,
        title: 'Website rebuild',
        amount: '12,500.50',
        currency: 'EGP',
        ...body,
      });
      if (res.status !== 201)
        throw new Error(`deal create failed ${res.status} ${JSON.stringify(res.body)}`);
      return res.body.data as { id: string; version: number; amountMinor: string };
    },
  };
}

describe('FR-D01 / FR-D02 create deals', () => {
  it('stores exact minor units, defaults to the first stage and records history on deal and contact', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const res = await a.post('/api/v1/deals', {
      contactId: lead.id,
      title: 'Online ordering site',
      amount: '12,500.50',
      currency: 'EGP',
      expectedCloseOn: '2026-12-15',
      nextStep: 'Send discovery questions',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      amountMinor: '1250050',
      currency: 'EGP',
      status: 'OPEN',
      stage: { name: 'New' },
      owner: { id: seeded.users.salesA!.id },
      expectedCloseOn: '2026-12-15',
      nextStep: 'Send discovery questions',
    });
    const row = await db.deal.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.amountMinor).toBe(1250050n);
    expect(await db.activity.count({ where: { eventType: 'deal.created' } })).toBe(2);
  });

  it('rejects bad amounts, unsupported currencies and unknown stages', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    for (const amount of ['12.345', '-5', '1e3', 'ten']) {
      const res = await a.post('/api/v1/deals', {
        contactId: lead.id,
        title: 'x',
        amount,
        currency: 'EGP',
      });
      expect(res.status, amount).toBe(422);
      expect(res.body.error.fieldErrors.amount).toBeDefined();
    }
    expect(
      (
        await a.post('/api/v1/deals', {
          contactId: lead.id,
          title: 'x',
          amount: '1',
          currency: 'JPY',
        })
      ).status,
    ).toBe(422);
    const badStage = await a.post('/api/v1/deals', {
      contactId: lead.id,
      title: 'x',
      amount: '1',
      currency: 'EGP',
      stageId: '018f0000-0000-7000-8000-000000000000',
    });
    expect(badStage.status).toBe(422);
    expect(await db.deal.count()).toBe(0);
  });

  it('cannot attach a deal to a contact the user cannot see', async () => {
    const lead = await (await as('salesA')).lead();
    const b = await as('salesB');
    const res = await b.post('/api/v1/deals', {
      contactId: lead.id,
      title: 'x',
      amount: '1',
      currency: 'EGP',
    });
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors.contactId).toBeDefined();
  });

  it('rejects mass assignment of owner, status, stage and raw amount fields', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const deal = await a.deal(lead.id);
    const res = await a.patch(`/api/v1/deals/${deal.id}`, {
      version: 1,
      ownerId: seeded.users.salesB!.id,
      status: 'WON',
      stageId: stages[3]!.id,
      amountMinor: '1',
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      'amountMinor',
      'ownerId',
      'stageId',
      'status',
    ]);
  });
});

describe('scope and board', () => {
  it('SALES sees own deals; managers see all; board totals stay per currency', async () => {
    const a = await as('salesA');
    const b = await as('salesB');
    const leadA = await a.lead('Lead A');
    const leadB = await b.lead('Lead B');
    await a.deal(leadA.id, { amount: '0.10' });
    await a.deal(leadA.id, { amount: '0.20' });
    await a.deal(leadA.id, { amount: '1000', currency: 'USD' });
    const dealB = await b.deal(leadB.id, { amount: '5000' });

    expect((await a.agent.get('/api/v1/deals')).body.meta.total).toBe(3);
    await a.agent.get(`/api/v1/deals/${dealB.id}`).expect(404);

    const boardA = await a.agent.get('/api/v1/deals/board').expect(200);
    const firstA = boardA.body.data.columns[0];
    expect(firstA.count).toBe(3);
    // 0.10 + 0.20 is exactly 0.30, and USD is never added to EGP.
    expect(firstA.totals).toEqual({ EGP: '30', USD: '100000' });

    const manager = await as('manager');
    const boardM = await manager.agent.get('/api/v1/deals/board').expect(200);
    expect(boardM.body.data.columns[0].count).toBe(4);
    expect(boardM.body.data.columns[0].totals.EGP).toBe('500030');
    expect(boardM.body.data.columns.map((c: { name: string }) => c.name)).toEqual([
      'New',
      'Qualified',
      'Discovery call',
      'Proposal',
      'Negotiation',
    ]);
  });

  it.each(['pm', 'member', 'finance'])('%s has no deal access', async (key) => {
    const u = await as(key);
    await u.agent.get('/api/v1/deals').expect(403);
    await u.agent.get('/api/v1/deals/board').expect(403);
    await u.agent.get('/api/v1/pipelines/default').expect(403);
  });
});

describe('FR-D04 / T-DEAL-01 stage moves and edits', () => {
  it('moves with the expected version and records history', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    const res = await a.post(`/api/v1/deals/${deal.id}/move`, {
      stageId: stages[2]!.id,
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ stage: { name: 'Discovery call' }, version: 2 });
    expect(res.body.data.activities[0].summary).toBe(
      'Moved from New to Discovery call by salesA user',
    );
  });

  it('two people moving the same card: one wins, the other gets 409 and nothing is overwritten', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    const manager = await as('manager');
    const [r1, r2] = await Promise.all([
      a.post(`/api/v1/deals/${deal.id}/move`, { stageId: stages[1]!.id, version: 1 }),
      manager.post(`/api/v1/deals/${deal.id}/move`, { stageId: stages[4]!.id, version: 1 }),
    ]);
    expect([r1.status, r2.status].sort()).toEqual([200, 409]);
    const row = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(row.version).toBe(2);
    expect(
      await db.activity.count({ where: { entityId: deal.id, eventType: 'deal.stage_changed' } }),
    ).toBe(1);
  });

  it('stale edits get 409; currency changes need the amount again', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    await a.patch(`/api/v1/deals/${deal.id}`, { version: 1, title: 'Renamed' }).expect(200);
    const stale = await a.patch(`/api/v1/deals/${deal.id}`, { version: 1, title: 'Stale' });
    expect(stale.status).toBe(409);
    expect(
      (await a.patch(`/api/v1/deals/${deal.id}`, { version: 2, currency: 'USD' })).status,
    ).toBe(422);
    const usd = await a.patch(`/api/v1/deals/${deal.id}`, {
      version: 2,
      currency: 'USD',
      amount: '3,000',
    });
    expect(usd.body.data).toMatchObject({ currency: 'USD', amountMinor: '300000', version: 3 });
  });
});

describe('FR-D05 / FR-D06 closing', () => {
  it('LOST needs a reason, and repeating the close is idempotent (one event)', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    expect(
      (await a.post(`/api/v1/deals/${deal.id}/close`, { outcome: 'LOST', version: 1 })).status,
    ).toBe(422);
    const lost = await a.post(`/api/v1/deals/${deal.id}/close`, {
      outcome: 'LOST',
      version: 1,
      reason: 'Chose a cheaper vendor',
    });
    expect(lost.status).toBe(200);
    expect(lost.body.data).toMatchObject({
      status: 'LOST',
      lostReason: 'Chose a cheaper vendor',
      closedBy: { id: seeded.users.salesA!.id },
    });
    const again = await a.post(`/api/v1/deals/${deal.id}/close`, {
      outcome: 'LOST',
      version: 1,
      reason: 'Clicked twice',
    });
    expect(again.status).toBe(200);
    expect(again.body.data.lostReason).toBe('Chose a cheaper vendor');
    expect(
      await db.activity.count({
        where: { entityType: 'deal', entityId: deal.id, eventType: 'deal.lost' },
      }),
    ).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'deal.lost' } })).toBe(1);
  });

  it('a double click (concurrent close) closes once', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    const body = { outcome: 'LOST', version: 1, reason: 'No budget' };
    const results = await Promise.all(
      [1, 2, 3].map(() => a.post(`/api/v1/deals/${deal.id}/close`, body)),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(
      await db.activity.count({
        where: { entityType: 'deal', entityId: deal.id, eventType: 'deal.lost' },
      }),
    ).toBe(1);
  });

  it('WON needs a manager override with a reason (no proposals yet) and converts the lead', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const deal = await a.deal(lead.id);
    const salesTry = await a.post(`/api/v1/deals/${deal.id}/close`, {
      outcome: 'WON',
      version: 1,
      overrideReason: 'Client said yes',
    });
    expect(salesTry.status).toBe(403);

    const manager = await as('manager');
    const noReason = await manager.post(`/api/v1/deals/${deal.id}/close`, {
      outcome: 'WON',
      version: 1,
    });
    expect(noReason.status).toBe(422);
    expect(noReason.body.error.fieldErrors.overrideReason).toBeDefined();

    const won = await manager.post(`/api/v1/deals/${deal.id}/close`, {
      outcome: 'WON',
      version: 1,
      overrideReason: 'Signed PO received by email',
    });
    expect(won.status).toBe(200);
    expect(won.body.data).toMatchObject({
      status: 'WON',
      wonOverrideReason: 'Signed PO received by email',
    });
    const contact = await db.contact.findUniqueOrThrow({ where: { id: lead.id } });
    expect(contact.lifecycle).toBe('CUSTOMER');
    expect(contact.convertedAt).not.toBeNull();

    // Closed deals are read-only, and the opposite outcome needs a reopen first.
    expect(
      (await manager.post(`/api/v1/deals/${deal.id}/move`, { stageId: stages[1]!.id, version: 2 }))
        .status,
    ).toBe(409);
    expect(
      (
        await manager.post(`/api/v1/deals/${deal.id}/close`, {
          outcome: 'LOST',
          version: 2,
          reason: 'Changed mind',
        })
      ).status,
    ).toBe(409);
  });

  it('only managers reopen, with a reason; reopening clears close data', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    await a
      .post(`/api/v1/deals/${deal.id}/close`, { outcome: 'LOST', version: 1, reason: 'Timing' })
      .expect(200);
    expect(
      (await a.post(`/api/v1/deals/${deal.id}/reopen`, { version: 2, reason: 'They came back' }))
        .status,
    ).toBe(403);
    const manager = await as('manager');
    const reopened = await manager.post(`/api/v1/deals/${deal.id}/reopen`, {
      version: 2,
      reason: 'They came back',
    });
    expect(reopened.status).toBe(200);
    expect(reopened.body.data).toMatchObject({
      status: 'OPEN',
      lostReason: null,
      closedAt: null,
      version: 3,
    });
    expect(reopened.body.data.activities[0].body).toBe('They came back');
  });

  it('the database itself refuses inconsistent close data', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    await expect(
      db.deal.update({ where: { id: deal.id }, data: { status: 'LOST' } }),
    ).rejects.toThrow();
    await expect(
      db.deal.update({ where: { id: deal.id }, data: { status: 'WON' } }),
    ).rejects.toThrow();
    await expect(
      db.deal.update({ where: { id: deal.id }, data: { amountMinor: -1n } }),
    ).rejects.toThrow();
    await expect(
      db.deal.update({ where: { id: deal.id }, data: { currency: 'XYZ' } }),
    ).rejects.toThrow();
  });
});

describe('FR-D08 deal reassignment', () => {
  it('managers reassign; salespeople cannot', async () => {
    const a = await as('salesA');
    const deal = await a.deal((await a.lead()).id);
    expect(
      (
        await a.post(`/api/v1/deals/${deal.id}/reassign`, {
          ownerId: seeded.users.salesB!.id,
          version: 1,
        })
      ).status,
    ).toBe(403);
    const manager = await as('manager');
    const res = await manager.post(`/api/v1/deals/${deal.id}/reassign`, {
      ownerId: seeded.users.salesB!.id,
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.owner.id).toBe(seeded.users.salesB!.id);
    await a.agent.get(`/api/v1/deals/${deal.id}`).expect(404);
  });
});

describe('FR-D07 follow-up queue', () => {
  it('buckets overdue, today, upcoming and no-next-step items within the viewer’s scope', async () => {
    const a = await as('salesA');
    const hour = 3_600_000;
    const now = Date.now();
    await a.post('/api/v1/contacts', {
      fullName: 'Overdue Lead',
      nextActionAt: new Date(now - 2 * hour).toISOString(),
    });
    await a.post('/api/v1/contacts', { fullName: 'Idle Lead' });
    const lead = await a.lead('Deal Lead');
    await a.deal(lead.id, {
      title: 'Upcoming deal',
      nextStepAt: new Date(now + 3 * 24 * hour).toISOString(),
      nextStep: 'Send proposal',
    });
    await a.deal(lead.id, { title: 'Stalled deal' });
    const b = await as('salesB');
    await b.post('/api/v1/contacts', {
      fullName: 'Not mine',
      nextActionAt: new Date(now - hour).toISOString(),
    });

    const res = await a.agent.get('/api/v1/follow-ups').expect(200);
    const titles = (k: string) => res.body.data[k].map((i: { title: string }) => i.title);
    expect(titles('overdue')).toEqual(['Overdue Lead']);
    expect(titles('upcoming')).toEqual(['Upcoming deal']);
    expect(titles('noNextStep').sort()).toEqual(['Deal Lead', 'Idle Lead', 'Stalled deal']);
    expect(res.body.data.counts.overdue).toBe(1);
    expect(JSON.stringify(res.body)).not.toContain('Not mine');

    await (await as('member')).agent.get('/api/v1/follow-ups').expect(403);
  });
});
