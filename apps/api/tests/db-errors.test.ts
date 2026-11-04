// Database errors and limits (backend audit, batch 3): what the API answers when the database
// says no, is busy, or a lock is held too long — instead of a 500 or a request that never ends.
import { randomUUID } from 'node:crypto';
import express from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Db } from '../src/db/client.js';
import { classifyDbError, isUniqueViolation } from '../src/lib/db-errors.js';
import { errorHandler } from '../src/middleware/error-handler.js';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';

const db = testDb();
let seeded: SeededAgency;
/** Clients and lock connections a test opened; closed even when the test fails. */
const open: Array<{ end: () => Promise<unknown> }> = [];

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
});
afterEach(async () => {
  for (const c of open.splice(0)) await c.end().catch(() => undefined);
});
afterAll(() => db.$disconnect());

/** A client with a short lock timeout, so a held lock fails fast in tests. */
function quickDb(): Db {
  const d = createDb(process.env.DATABASE_URL!, { lockTimeoutMs: 300 });
  open.push({ end: () => d.$disconnect() });
  return d;
}

/** A separate connection inside an open transaction, holding whatever it locks. */
async function locker() {
  const c = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await c.connect();
  open.push({ end: () => c.end() });
  await c.query('BEGIN');
  return {
    query: (sql: string, params: unknown[]) => c.query(sql, params),
    release: () => c.query('COMMIT'),
  };
}

async function waitForWaiters(n: number) {
  for (let i = 0; i < 200; i++) {
    const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row!.n) >= n) return;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`fewer than ${n} transactions ever waited on a lock`);
}

const caught = (p: Promise<unknown>) =>
  p.then(
    () => {
      throw new Error('expected the database to refuse');
    },
    (err: unknown) => err,
  );

const newContact = () =>
  db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId: seeded.users.salesA!.id, fullName: 'Lock Test' },
  });

describe('database limits', () => {
  it('every client gets statement, lock and idle-in-transaction limits by default', async () => {
    const show = async (name: string) =>
      Object.values(
        (await db.$queryRawUnsafe<Array<Record<string, string>>>(`SHOW ${name}`))[0]!,
      )[0];
    expect(await show('statement_timeout')).toBe('15s');
    expect(await show('lock_timeout')).toBe('3s');
    expect(await show('idle_in_transaction_session_timeout')).toBe('2min');
  });
});

describe('classifying database errors', () => {
  it('sorts real PostgreSQL refusals into conflict, not found and retryable', async () => {
    const agency = await db.agency.findUniqueOrThrow({ where: { id: seeded.agencyId } });

    const unique = await caught(db.agency.create({ data: { name: 'x', slug: agency.slug } }));
    expect(isUniqueViolation(unique)).toBe(true);
    expect(classifyDbError(unique)).toBe('conflict');

    // The same violation from a raw query arrives as P2010; the old helpers missed it.
    const rawUnique = await caught(
      db.$executeRaw`INSERT INTO agencies (id, name, slug, updated_at) VALUES (gen_random_uuid(), 'x', ${agency.slug}, now())`,
    );
    expect(isUniqueViolation(rawUnique)).toBe(true);

    const fk = await caught(
      db.contact.create({
        data: { agencyId: agency.id, ownerId: randomUUID(), fullName: 'x' },
      }),
    );
    expect(classifyDbError(fk)).toBe('conflict');
    expect(isUniqueViolation(fk)).toBe(false);

    const check = await caught(db.agency.update({ where: { id: agency.id }, data: { name: '' } }));
    expect(classifyDbError(check)).toBe('conflict');

    const missing = await caught(
      db.agency.update({ where: { id: randomUUID() }, data: { name: 'gone' } }),
    );
    expect(classifyDbError(missing)).toBe('not_found');

    const slow = await caught(
      db.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = '50ms'`);
        await tx.$queryRaw`SELECT pg_sleep(1)::text AS s`;
      }),
    );
    expect(classifyDbError(slow)).toBe('retryable');

    expect(classifyDbError(new Error('timeout exceeded when trying to connect'))).toBe('retryable');
    expect(classifyDbError(new Error('something else'))).toBeUndefined();
    expect(classifyDbError(new TypeError('a bug'))).toBeUndefined();
  });

  it('a held row lock ends the waiting statement after lock_timeout, as retryable', async () => {
    const contact = await newContact();
    const hold = await locker();
    await hold.query('SELECT id FROM contacts WHERE id = $1 FOR UPDATE', [contact.id]);
    const started = Date.now();
    const err = await caught(
      quickDb().contact.update({ where: { id: contact.id }, data: { fullName: 'blocked' } }),
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(classifyDbError(err)).toBe('retryable');
    await hold.release();
  });
});

describe('the API answer', () => {
  it('a request blocked by a lock gets 503 with Retry-After, then succeeds once it is free', async () => {
    const quick = quickDb();
    const { app, logs } = makeApp({}, quick);
    const sales = await login(app, seeded.users.salesA!.email);
    const contact = await newContact();
    const patch = (fullName: string) =>
      sales.agent
        .patch(`/api/v1/contacts/${contact.id}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', sales.csrf)
        .send({ version: contact.version, fullName });

    const hold = await locker();
    await hold.query('SELECT id FROM contacts WHERE id = $1 FOR UPDATE', [contact.id]);
    const started = Date.now();
    const blocked = await patch('Blocked');
    expect(Date.now() - started).toBeLessThan(5000);
    expect(blocked.status).toBe(503);
    expect(blocked.headers['retry-after']).toBe('2');
    expect(blocked.body.error.code).toBe('SERVICE_UNAVAILABLE');
    // Nothing about the database reaches the client.
    expect(JSON.stringify(blocked.body)).not.toMatch(/lock|contacts|postgres|55P03|P20/i);
    expect(logs.join('')).toMatch(/"sqlState":"55P03"/);
    expect(logs.join('')).not.toMatch(/Unhandled error/);
    await hold.release();

    const after = await patch('Unblocked');
    expect(after.status, JSON.stringify(after.body)).toBe(200);
  });

  it('a constraint the code did not expect answers 409, never 500, and names nothing', async () => {
    const agency = await db.agency.findUniqueOrThrow({ where: { id: seeded.agencyId } });
    const app = express();
    app.get('/unique', async (_req, _res, next) => {
      next(await caught(db.agency.create({ data: { name: 'x', slug: agency.slug } })));
    });
    app.get('/raw-unique', async (_req, _res, next) => {
      next(
        await caught(
          db.$executeRaw`INSERT INTO agencies (id, name, slug, updated_at) VALUES (gen_random_uuid(), 'x', ${agency.slug}, now())`,
        ),
      );
    });
    app.get('/bug', (_req, _res, next) => next(new TypeError('x is undefined')));
    app.use(errorHandler);

    for (const path of ['/unique', '/raw-unique']) {
      const res = await request(app).get(path);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('CONFLICT');
      expect(JSON.stringify(res.body)).not.toMatch(/slug|agencies|unique|P20|23505/i);
      expect(res.headers['retry-after']).toBeUndefined();
    }
    const bug = await request(app).get('/bug');
    expect(bug.status).toBe(500);
    expect(bug.body.error.code).toBe('INTERNAL_ERROR');
  });

  it('a second import still waits its turn beyond the short default lock timeout', async () => {
    const quick = quickDb();
    const { app } = makeApp({}, quick);
    const manager = await login(app, seeded.users.manager!.email);
    const send = (path: string, body: object, headers: Record<string, string> = {}) => {
      let r = manager.agent
        .post(`/api/v1${path}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', manager.csrf);
      for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
      return r.send(body);
    };
    const csv = 'Name,Email\r\nQueued Person,queued@x.test';
    const p = (
      await send('/imports/preview', { kind: 'contacts', filename: 'q.csv', csv }).expect(200)
    ).body.data;

    // Another import of the same agency holds the import lock for longer than 300 ms.
    const hold = await locker();
    await hold.query(`SELECT pg_advisory_xact_lock(hashtext('clientflow.import'), hashtext($1))`, [
      seeded.agencyId,
    ]);
    const pending = send(
      '/imports',
      { kind: 'contacts', filename: 'q.csv', csv, mapping: p.mapping, fileSha256: p.fileSha256 },
      { 'Idempotency-Key': randomUUID() },
    ).then((r) => r);
    await waitForWaiters(1);
    await new Promise((r) => setTimeout(r, 800));
    await hold.release();
    const res = await pending;
    expect(res.status, JSON.stringify(res.body)).toBe(201);
    expect(await db.contact.count({ where: { fullName: 'Queued Person' } })).toBe(1);
  });
});
