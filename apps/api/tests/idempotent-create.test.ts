// Optional Idempotency-Key on deal and proposal create (backend audit, batch 5, F15a/F17). A
// double click or a retried request with the same key returns the first record; requests
// without a key behave exactly as before.
import { randomUUID } from 'node:crypto';
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
  return (path: string, body: object, idempotencyKey?: string) => {
    let r = agent.post(`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', csrf);
    if (idempotencyKey !== undefined) r = r.set('Idempotency-Key', idempotencyKey);
    return r.send(body).then((res) => res);
  };
}

async function leadFor(post: Awaited<ReturnType<typeof as>>) {
  const res = await post('/contacts', { fullName: 'Salma Ibrahim' });
  return res.body.data.id as string;
}

describe('deal create with an Idempotency-Key (F15a)', () => {
  it('two identical requests at once make one deal; a later retry replays it', async () => {
    const post = await as('salesA');
    const body = { contactId: await leadFor(post), title: 'Site', amount: '100', currency: 'EGP' };
    const key = randomUUID();
    const [a, b] = await Promise.all([post('/deals', body, key), post('/deals', body, key)]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    const again = await post('/deals', body, key);
    expect(again.status).toBe(200);
    expect(again.body.data.id).toBe(a.body.data.id);
    expect(await db.deal.count()).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'deal.create' } })).toBe(1);
    expect(await db.activity.count({ where: { eventType: 'deal.created' } })).toBe(2); // deal + contact
  });

  it('refuses the same key for other values or another person, and a key that is not a UUID', async () => {
    const a = await as('salesA');
    const contactId = await leadFor(a);
    const body = { contactId, title: 'Site', amount: '100', currency: 'EGP' };
    const key = randomUUID();
    expect((await a('/deals', body, key)).status).toBe(201);
    const other = await a('/deals', { ...body, amount: '200' }, key);
    expect(other.status).toBe(409);
    expect(other.body.error.message).toMatch(/already used for a different deal/);
    const manager = await as('manager');
    expect((await manager('/deals', body, key)).status).toBe(409);
    const bad = await a('/deals', body, 'not-a-uuid');
    expect(bad.status).toBe(422);
    expect(bad.body.error.fieldErrors['Idempotency-Key']).toBeDefined();
    expect(await db.deal.count()).toBe(1);
  });

  it('without a key, every request still creates a deal (older clients)', async () => {
    const post = await as('salesA');
    const body = { contactId: await leadFor(post), title: 'Site', amount: '100', currency: 'EGP' };
    expect((await post('/deals', body)).status).toBe(201);
    expect((await post('/deals', body)).status).toBe(201);
    expect(await db.deal.count()).toBe(2);
    expect(await db.idempotencyRecord.count()).toBe(0);
  });
});

describe('proposal create with an Idempotency-Key (F17)', () => {
  it('a doubled create makes one proposal and uses one reference number', async () => {
    const post = await as('salesA');
    const deal = await post('/deals', {
      contactId: await leadFor(post),
      title: 'Site',
      amount: '100',
      currency: 'EGP',
    });
    const key = randomUUID();
    const body = { dealId: deal.body.data.id };
    const [a, b] = await Promise.all([
      post('/proposals', body, key),
      post('/proposals', body, key),
    ]);
    expect([a.status, b.status].sort()).toEqual([200, 201]);
    expect(a.body.data.id).toBe(b.body.data.id);
    expect((await post('/proposals', body, key)).status).toBe(200);
    expect(await db.proposal.count()).toBe(1);
    // The losing request rolled back, so its reference number was not used up either.
    const agency = await db.agency.findUniqueOrThrow({ where: { id: seeded.agencyId } });
    expect(agency.proposalSeq).toBe(1);
    // Without a key, a second create is a second proposal, as before.
    expect((await post('/proposals', body)).status).toBe(201);
    expect(await db.proposal.count()).toBe(2);
  });
});
