import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Express } from 'express';
import type { Db } from '../src/db/client.js';
import { login, makeApp, ORIGIN, PASSWORD, resetDb, seedAgency, testDb, type SeededAgency } from './helpers.js';

const db = testDb();
let seeded: SeededAgency;
let app: Express;
let logs: string[];

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  ({ app, logs } = makeApp());
});
afterAll(() => db.$disconnect());

async function signedIn(key: string) {
  const { agent, csrf } = await login(app, seeded.users[key]!.email);
  return {
    agent,
    create: (body: object) =>
      agent.post('/api/v1/contacts').set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body),
  };
}

describe('authentication is required', () => {
  it('returns 401 for every contacts endpoint without a session', async () => {
    await request(app).get('/api/v1/contacts').expect(401);
    await request(app).get('/api/v1/contacts/00000000-0000-0000-0000-000000000000').expect(401);
    const res = await request(app).post('/api/v1/contacts').set('Origin', ORIGIN).send({ fullName: 'X' });
    expect(res.status).toBe(401);
    expect(await db.contact.count()).toBe(0);
  });
});

describe('US-04 create lead', () => {
  it('persists the contact, its first activity and an audit event', async () => {
    const sales = await signedIn('salesA');
    const res = await sales.create({
      fullName: '  Salma Ibrahim ',
      email: 'Salma@Nile-Bakery.test',
      phone: '+20 100 555 0101',
      companyName: 'Nile Bakery Co.',
      source: 'REFERRAL',
      nextActionAt: '2026-11-01T09:00:00+02:00',
      notes: 'Wants online ordering.',
    });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({
      fullName: 'Salma Ibrahim',
      email: 'salma@nile-bakery.test',
      phone: '+20 100 555 0101',
      lifecycle: 'LEAD',
      source: 'REFERRAL',
      owner: { id: seeded.users.salesA!.id },
      nextActionAt: '2026-11-01T07:00:00.000Z',
      version: 1,
    });
    expect(res.body.meta.possibleDuplicates).toEqual([]);

    const row = await db.contact.findUniqueOrThrow({ where: { id: res.body.data.id } });
    expect(row.phoneNorm).toBe('+201005550101');
    expect(row.agencyId).toBe(seeded.agencyId);
    const activity = await db.activity.findFirstOrThrow({ where: { entityId: row.id } });
    expect(activity.eventType).toBe('contact.created');
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'contact.create' } });
    expect(audit).toMatchObject({ targetId: row.id, actorId: seeded.users.salesA!.id, outcome: 'SUCCESS' });

    const detail = await sales.agent.get(`/api/v1/contacts/${row.id}`).expect(200);
    expect(detail.body.data.activities).toHaveLength(1);
    expect(detail.body.data.notes).toBe('Wants online ordering.');
  });

  it('returns 422 with field errors and writes nothing for invalid input', async () => {
    const sales = await signedIn('salesA');
    const res = await sales.create({ fullName: '', email: 'not-an-email', phone: 'abc', notes: 'x'.repeat(5001) });
    expect(res.status).toBe(422);
    expect(res.body.error.code).toBe('VALIDATION_FAILED');
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['email', 'fullName', 'notes', 'phone']);
    expect(await db.contact.count()).toBe(0);
  });

  it('T-ACL-03: rejects mass-assignment fields such as ownerId and agencyId', async () => {
    const sales = await signedIn('salesA');
    const res = await sales.create({
      fullName: 'Sneaky',
      ownerId: seeded.users.salesB!.id,
      agencyId: '00000000-0000-0000-0000-000000000000',
      version: 99,
    });
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors).toMatchObject({
      ownerId: ['This field is not allowed.'],
      agencyId: ['This field is not allowed.'],
      version: ['This field is not allowed.'],
    });
    expect(await db.contact.count()).toBe(0);
  });

  it('warns about duplicates inside the caller scope without merging', async () => {
    const sales = await signedIn('salesA');
    const first = await sales.create({ fullName: 'Ahmed Rostom', email: 'ahmed@delta.test' });
    const second = await sales.create({ fullName: 'A. Rostom', email: 'AHMED@delta.test ' });
    expect(second.status).toBe(201);
    expect(second.body.meta.possibleDuplicates).toEqual([
      { id: first.body.data.id, fullName: 'Ahmed Rostom', matchedOn: ['email'] },
    ]);
    expect(await db.contact.count()).toBe(2);

    // Sales B cannot learn that Sales A already has this contact (SEC-25).
    const other = await signedIn('salesB');
    const third = await other.create({ fullName: 'Ahmed', email: 'ahmed@delta.test' });
    expect(third.body.meta.possibleDuplicates).toEqual([]);
  });

  it.each(['pm', 'member', 'finance'])('forbids %s from creating leads', async (key) => {
    const user = await signedIn(key);
    const res = await user.create({ fullName: 'Nope' });
    expect(res.status).toBe(403);
    expect(await db.contact.count()).toBe(0);
  });
});

describe('US-05 / T-ACL-01 record scope', () => {
  async function createFor(key: string, fullName: string) {
    const user = await signedIn(key);
    const res = await user.create({ fullName, email: `${fullName.split(' ')[0]!.toLowerCase()}@x.test` });
    return res.body.data.id as string;
  }

  it('hides another salesperson’s lead with a 404 that reveals nothing', async () => {
    const privateId = await createFor('salesA', 'Laila Haddad');
    const salesB = await signedIn('salesB');
    const res = await salesB.agent.get(`/api/v1/contacts/${privateId}`);
    expect(res.status).toBe(404);
    expect(JSON.stringify(res.body)).not.toContain('Laila');

    // Indistinguishable from a record that does not exist at all.
    const missing = await salesB.agent.get('/api/v1/contacts/018f0000-0000-7000-8000-000000000000');
    const strip = (b: { error: object }) => ({ ...b.error, requestId: undefined });
    expect(strip(res.body)).toEqual(strip(missing.body));
    const malformed = await salesB.agent.get('/api/v1/contacts/not-a-uuid');
    expect(malformed.status).toBe(404);
  });

  it('scopes list, totals and search to owned records for SALES', async () => {
    await createFor('salesA', 'Laila Haddad');
    await createFor('salesA', 'Mostafa Kamel');
    await createFor('salesB', 'Rana Sayed');

    const salesB = await signedIn('salesB');
    const list = await salesB.agent.get('/api/v1/contacts').expect(200);
    expect(list.body.meta.total).toBe(1);
    expect(list.body.data.map((c: { fullName: string }) => c.fullName)).toEqual(['Rana Sayed']);
    const search = await salesB.agent.get('/api/v1/contacts?q=laila').expect(200);
    expect(search.body.meta.total).toBe(0);
  });

  it('lets managers and owners see all agency leads', async () => {
    await createFor('salesA', 'Laila Haddad');
    await createFor('salesB', 'Rana Sayed');
    for (const key of ['manager', 'owner', 'admin']) {
      const user = await signedIn(key);
      const list = await user.agent.get('/api/v1/contacts').expect(200);
      expect(list.body.meta.total).toBe(2);
    }
  });

  it('T-ACL-04 (partial): PM, MEMBER and FINANCE have no lead access in M1', async () => {
    const id = await createFor('salesA', 'Laila Haddad');
    for (const key of ['pm', 'member', 'finance']) {
      const user = await signedIn(key);
      await user.agent.get('/api/v1/contacts').expect(403);
      await user.agent.get(`/api/v1/contacts/${id}`).expect(403);
    }
  });

  it('never returns contacts from another agency', async () => {
    const other = await db.agency.create({ data: { name: 'Other Agency', slug: 'other-agency' } });
    const otherOwner = await db.user.create({
      data: { agencyId: other.id, emailNorm: 'o@other.test', name: 'O', role: 'OWNER', passwordHash: 'x' },
    });
    const foreign = await db.contact.create({
      data: { agencyId: other.id, ownerId: otherOwner.id, fullName: 'Foreign Lead' },
    });
    const owner = await signedIn('owner');
    await owner.agent.get(`/api/v1/contacts/${foreign.id}`).expect(404);
    const list = await owner.agent.get('/api/v1/contacts').expect(200);
    expect(list.body.data.some((c: { id: string }) => c.id === foreign.id)).toBe(false);
  });
});

describe('listing, pagination and search', () => {
  it('paginates server-side with bounded limits', async () => {
    const sales = await signedIn('salesA');
    for (let i = 1; i <= 7; i++) await sales.create({ fullName: `Lead ${i}` });
    const page1 = await sales.agent.get('/api/v1/contacts?limit=3&page=1').expect(200);
    const page3 = await sales.agent.get('/api/v1/contacts?limit=3&page=3').expect(200);
    expect(page1.body.meta).toMatchObject({ page: 1, limit: 3, total: 7 });
    expect(page1.body.data).toHaveLength(3);
    expect(page1.body.data[0].fullName).toBe('Lead 7');
    expect(page3.body.data).toHaveLength(1);
    await sales.agent.get('/api/v1/contacts?limit=101').expect(422);
    await sales.agent.get('/api/v1/contacts?unknown=1').expect(422);
  });

  it('T-SEC-02: treats SQL-like search input as inert text', async () => {
    const sales = await signedIn('salesA');
    await sales.create({ fullName: 'Hossam Wahba', companyName: 'Wahba Engineering' });
    for (const q of ["' OR 1=1 --", "%'; DROP TABLE contacts; --", '\\', '%_%']) {
      const res = await sales.agent.get('/api/v1/contacts').query({ q }).expect(200);
      expect(res.body.meta.total).toBe(0);
    }
    expect(await db.contact.count()).toBe(1);
    const hit = await sales.agent.get('/api/v1/contacts').query({ q: 'wahba eng' }).expect(200);
    expect(hit.body.meta.total).toBe(1);

    // Wildcards are literal: "50%" finds only the company that contains that text.
    await sales.create({ fullName: 'Promo Lead', companyName: '50% Growth Agency' });
    const literal = await sales.agent.get('/api/v1/contacts').query({ q: '50%' }).expect(200);
    expect(literal.body.data.map((c: { fullName: string }) => c.fullName)).toEqual(['Promo Lead']);
  });

  it('T-SEC-03 (API side): stores HTML as plain text and returns it as JSON data', async () => {
    const sales = await signedIn('salesA');
    const payload = '<img src=x onerror=alert(1)><script>alert("x")</script>';
    const res = await sales.create({ fullName: payload, notes: payload });
    expect(res.status).toBe(201);
    const detail = await sales.agent.get(`/api/v1/contacts/${res.body.data.id}`).expect(200);
    expect(detail.headers['content-type']).toMatch(/application\/json/);
    expect(detail.body.data.notes).toBe(payload);
  });
});

describe('errors and logging', () => {
  it('US-21 / T-SEC-05: a server failure returns a generic error with no stack or secrets', async () => {
    // Fails the list query inside its transaction, like a dropped database connection.
    const failing = new Proxy(db, {
      get(target, prop, receiver) {
        if (prop === '$transaction') {
          return () => Promise.reject(new Error('boom: connection to 10.0.0.5 failed'));
        }
        return Reflect.get(target, prop, receiver);
      },
    }) as Db;
    const broken = makeApp({}, failing);
    const { agent } = await login(broken.app, seeded.users.owner!.email);
    const res = await agent.get('/api/v1/contacts');
    expect(res.status).toBe(500);
    expect(res.body.error).toMatchObject({ code: 'INTERNAL_ERROR' });
    expect(res.body.error.requestId).toBe(res.headers['x-request-id']);
    const text = JSON.stringify(res.body);
    expect(text).not.toMatch(/boom|10\.0\.0\.5|at .*\.ts|stack/i);
  });

  it('T-SEC-05: logs never contain passwords, session cookies or CSRF tokens', async () => {
    const { agent, csrf, res } = await login(app, seeded.users.salesA!.email);
    const sessionCookie = (res.headers['set-cookie'] as unknown as string[])
      .find((c) => c.startsWith('cf_session='))!
      .split(';')[0]!
      .split('=')[1]!;
    await agent
      .post('/api/v1/contacts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ fullName: 'Log Check', email: 'log.check@x.test' });
    await agent.get('/api/v1/contacts').query({ q: 'secret-search-term' });

    const all = logs.join('\n');
    expect(all.length).toBeGreaterThan(0);
    expect(all).not.toContain(PASSWORD);
    expect(all).not.toContain(sessionCookie);
    expect(all).not.toContain(csrf);
    expect(all).not.toContain('secret-search-term');
    expect(all).not.toContain('log.check@x.test');
    expect(all).toContain('[REDACTED]');
  });

  it('rejects malformed JSON and oversized bodies with typed errors', async () => {
    const { agent, csrf } = await login(app, seeded.users.salesA!.email);
    const bad = await agent
      .post('/api/v1/contacts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .set('Content-Type', 'application/json')
      .send('{"fullName": ');
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('MALFORMED_REQUEST');
    const big = await agent
      .post('/api/v1/contacts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ fullName: 'x', notes: 'y'.repeat(40_000) });
    expect(big.status).toBe(413);
  });

  it('returns a typed 404 for unknown API routes', async () => {
    const res = await request(app).get('/api/v1/does-not-exist').expect(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
