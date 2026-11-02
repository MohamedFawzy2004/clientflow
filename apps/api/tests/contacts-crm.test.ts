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

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
});
afterAll(() => db.$disconnect());

async function as(key: string) {
  const { agent, csrf } = await login(t.app, seeded.users[key]!.email);
  const send = (method: 'post' | 'patch', path: string, body: object = {}) =>
    agent[method](path).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body);
  return {
    agent,
    post: (p: string, b?: object) => send('post', p, b),
    patch: (p: string, b: object) => send('patch', p, b),
    lead: async (body: object = {}) => {
      const res = await send('post', '/api/v1/contacts', {
        fullName: 'Salma Ibrahim',
        email: 'salma@nile.test',
        ...body,
      });
      return res.body.data as { id: string; version: number };
    },
  };
}

describe('FR-C01 / US-05 edit with optimistic locking', () => {
  it('updates fields, normalizes them, bumps the version and logs field names only', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const res = await a.patch(`/api/v1/contacts/${lead.id}`, {
      version: 1,
      fullName: 'Salma I. Ibrahim',
      email: 'SALMA@New-Domain.test',
      phone: '+20 (100) 555-0199',
      companyName: '',
      notes: 'Secret pricing note',
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      fullName: 'Salma I. Ibrahim',
      email: 'salma@new-domain.test',
      phone: '+20 (100) 555-0199',
      companyName: null,
      version: 2,
    });
    const row = await db.contact.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.phoneNorm).toBe('+201005550199');
    const entry = res.body.data.activities.find(
      (x: { eventType: string }) => x.eventType === 'contact.updated',
    );
    expect(entry.summary).toMatch(/updated name, email, phone, company, notes/);
    expect(entry.summary).not.toContain('Secret pricing note');
  });

  it('T-DEAL-01 pattern: two editors on one version → one 200, one 409, no lost update', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const manager = await as('manager');
    const [first, second] = await Promise.all([
      a.patch(`/api/v1/contacts/${lead.id}`, { version: 1, companyName: 'Edit by A' }),
      manager.patch(`/api/v1/contacts/${lead.id}`, { version: 1, companyName: 'Edit by manager' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const loser = first.status === 409 ? first : second;
    expect(loser.body.error.code).toBe('CONFLICT_STALE_VERSION');
    const row = await db.contact.findUniqueOrThrow({ where: { id: lead.id } });
    expect(row.version).toBe(2);
    expect(['Edit by A', 'Edit by manager']).toContain(row.companyName);
  });

  it('T-ACL-03: owner, lifecycle, archive state and agency cannot be set through PATCH', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const res = await a.patch(`/api/v1/contacts/${lead.id}`, {
      version: 1,
      ownerId: seeded.users.salesB!.id,
      lifecycle: 'CUSTOMER',
      archivedAt: null,
      agencyId: seeded.agencyId,
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      'agencyId',
      'archivedAt',
      'lifecycle',
      'ownerId',
    ]);
    expect((await db.contact.findUniqueOrThrow({ where: { id: lead.id } })).version).toBe(1);
  });

  it('another salesperson gets 404 and changes nothing', async () => {
    const lead = await (await as('salesA')).lead();
    const b = await as('salesB');
    expect(
      (await b.patch(`/api/v1/contacts/${lead.id}`, { version: 1, fullName: 'Hijack' })).status,
    ).toBe(404);
    expect((await b.post(`/api/v1/contacts/${lead.id}/archive`, { version: 1 })).status).toBe(404);
    expect(
      (await b.post(`/api/v1/contacts/${lead.id}/activities`, { kind: 'NOTE', body: 'x' })).status,
    ).toBe(404);
    expect((await db.contact.findUniqueOrThrow({ where: { id: lead.id } })).fullName).toBe(
      'Salma Ibrahim',
    );
  });
});

describe('archive and restore', () => {
  it('hides archived leads from lists, keeps them readable, and makes them read-only', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const archived = await a.post(`/api/v1/contacts/${lead.id}/archive`, { version: 1 });
    expect(archived.status).toBe(200);
    expect(archived.body.data.archivedAt).not.toBeNull();

    expect((await a.agent.get('/api/v1/contacts')).body.meta.total).toBe(0);
    const archivedView = await a.agent.get('/api/v1/contacts?archived=true');
    expect(archivedView.body.data.map((c: { id: string }) => c.id)).toEqual([lead.id]);
    await a.agent.get(`/api/v1/contacts/${lead.id}`).expect(200);

    const edit = await a.patch(`/api/v1/contacts/${lead.id}`, { version: 2, fullName: 'x' });
    expect(edit.status).toBe(409);
    expect(edit.body.error.code).toBe('CONFLICT');

    // Idempotent: archiving again changes nothing.
    await a.post(`/api/v1/contacts/${lead.id}/archive`, { version: 2 }).expect(200);
    expect((await db.contact.findUniqueOrThrow({ where: { id: lead.id } })).version).toBe(2);

    const restored = await a.post(`/api/v1/contacts/${lead.id}/restore`, { version: 2 });
    expect(restored.body.data).toMatchObject({ archivedAt: null, version: 3 });
    expect((await a.agent.get('/api/v1/contacts')).body.meta.total).toBe(1);
  });
});

describe('FR-C07 / US-06 / T-CRM-01 convert lead to customer', () => {
  it('keeps the same ID and deals, and repeating it is safe', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const deal = await a.post('/api/v1/deals', {
      contactId: lead.id,
      title: 'Website',
      amount: '50000',
      currency: 'EGP',
    });
    expect(deal.status).toBe(201);

    const first = await a.post(`/api/v1/contacts/${lead.id}/convert`, { version: 1 });
    expect(first.status).toBe(200);
    expect(first.body.data).toMatchObject({ id: lead.id, lifecycle: 'CUSTOMER', version: 2 });
    expect(first.body.data.convertedAt).not.toBeNull();
    expect(first.body.data.deals.map((d: { id: string }) => d.id)).toEqual([deal.body.data.id]);

    // Retry (e.g. double click with the old version) is a no-op, not an error or a second event.
    const again = await a.post(`/api/v1/contacts/${lead.id}/convert`, { version: 1 });
    expect(again.status).toBe(200);
    expect(again.body.data.version).toBe(2);
    expect(
      await db.activity.count({ where: { entityId: lead.id, eventType: 'contact.converted' } }),
    ).toBe(1);
    expect(await db.contact.count()).toBe(1);
  });
});

describe('FR-D08 reassignment', () => {
  it('managers reassign with history; the old owner loses access', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const manager = await as('manager');
    const res = await manager.post(`/api/v1/contacts/${lead.id}/reassign`, {
      ownerId: seeded.users.salesB!.id,
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.owner.id).toBe(seeded.users.salesB!.id);
    expect(res.body.data.activities[0].summary).toMatch(
      /Owner changed from salesA user to salesB user by manager user/,
    );
    await a.agent.get(`/api/v1/contacts/${lead.id}`).expect(404);
    await (await as('salesB')).agent.get(`/api/v1/contacts/${lead.id}`).expect(200);
  });

  it('salespeople cannot reassign; invalid owners are rejected', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    expect(
      (
        await a.post(`/api/v1/contacts/${lead.id}/reassign`, {
          ownerId: seeded.users.salesB!.id,
          version: 1,
        })
      ).status,
    ).toBe(403);

    const manager = await as('manager');
    for (const key of ['pm', 'finance', 'member']) {
      const res = await manager.post(`/api/v1/contacts/${lead.id}/reassign`, {
        ownerId: seeded.users[key]!.id,
        version: 1,
      });
      expect(res.status).toBe(422);
      expect(res.body.error.fieldErrors.ownerId).toBeDefined();
    }
    await db.user.update({ where: { id: seeded.users.salesB!.id }, data: { active: false } });
    expect(
      (
        await manager.post(`/api/v1/contacts/${lead.id}/reassign`, {
          ownerId: seeded.users.salesB!.id,
          version: 1,
        })
      ).status,
    ).toBe(422);
    expect((await db.contact.findUniqueOrThrow({ where: { id: lead.id } })).ownerId).toBe(
      seeded.users.salesA!.id,
    );
  });

  it('lists assignable owners for managers only', async () => {
    const manager = await as('manager');
    const res = await manager.agent.get('/api/v1/sales/assignable-owners').expect(200);
    const roles = new Set(res.body.data.map((u: { role: string }) => u.role));
    expect([...roles].sort()).toEqual(['ADMIN', 'OWNER', 'SALES', 'SALES_MANAGER']);
    await (await as('salesA')).agent.get('/api/v1/sales/assignable-owners').expect(403);
  });
});

describe('FR-C08 timeline', () => {
  it('logs notes and calls as plain text, ordered by when they happened', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const html = '<b>Called</b><script>alert(1)</script>';
    const call = await a.post(`/api/v1/contacts/${lead.id}/activities`, {
      kind: 'CALL',
      body: html,
      occurredAt: new Date(Date.now() - 3_600_000).toISOString(),
    });
    expect(call.status).toBe(201);
    expect(call.body.data).toMatchObject({
      eventType: 'activity.call',
      body: html,
      summary: 'Call logged by salesA user',
    });
    await a
      .post(`/api/v1/contacts/${lead.id}/activities`, { kind: 'NOTE', body: 'Prefers WhatsApp' })
      .expect(201);

    const detail = await a.agent.get(`/api/v1/contacts/${lead.id}`).expect(200);
    // The call happened an hour ago, before the lead was entered, so it sorts last.
    expect(detail.body.data.activities.map((x: { eventType: string }) => x.eventType)).toEqual([
      'activity.note',
      'contact.created',
      'activity.call',
    ]);
  });

  it('rejects future interactions, empty bodies and unknown kinds', async () => {
    const a = await as('salesA');
    const lead = await a.lead();
    const future = await a.post(`/api/v1/contacts/${lead.id}/activities`, {
      kind: 'MEETING',
      body: 'Tomorrow',
      occurredAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(future.status).toBe(422);
    expect(future.body.error.fieldErrors.occurredAt).toBeDefined();
    expect(
      (await a.post(`/api/v1/contacts/${lead.id}/activities`, { kind: 'NOTE', body: '   ' }))
        .status,
    ).toBe(422);
    expect(
      (await a.post(`/api/v1/contacts/${lead.id}/activities`, { kind: 'SMS', body: 'x' })).status,
    ).toBe(422);
  });
});

describe('FR-C03 / FR-C04 filters', () => {
  it('filters by owner, source, follow-up bucket and keeps scope', async () => {
    const a = await as('salesA');
    const hour = 3_600_000;
    await a.lead({
      fullName: 'Overdue Lead',
      email: 'o@x.test',
      source: 'REFERRAL',
      nextActionAt: new Date(Date.now() - hour).toISOString(),
    });
    await a.lead({
      fullName: 'Later Lead',
      email: 'l@x.test',
      source: 'WEBSITE',
      nextActionAt: new Date(Date.now() + 3 * 24 * hour).toISOString(),
    });
    await a.lead({ fullName: 'Idle Lead', email: 'i@x.test' });
    await (
      await as('salesB')
    ).lead({
      fullName: 'B Overdue',
      email: 'b@x.test',
      nextActionAt: new Date(Date.now() - hour).toISOString(),
    });

    const names = async (query: string) =>
      (await a.agent.get(`/api/v1/contacts?${query}`)).body.data.map(
        (c: { fullName: string }) => c.fullName,
      );
    expect(await names('followUp=overdue')).toEqual(['Overdue Lead']);
    expect(await names('followUp=upcoming')).toEqual(['Later Lead']);
    expect(await names('followUp=none')).toEqual(['Idle Lead']);
    expect(await names('source=WEBSITE')).toEqual(['Later Lead']);

    const manager = await as('manager');
    const byOwner = await manager.agent.get(`/api/v1/contacts?ownerId=${seeded.users.salesB!.id}`);
    expect(byOwner.body.data.map((c: { fullName: string }) => c.fullName)).toEqual(['B Overdue']);
    // A salesperson filtering by someone else still only sees their own scope.
    expect(await names(`ownerId=${seeded.users.salesB!.id}`)).toEqual([]);
  });
});
