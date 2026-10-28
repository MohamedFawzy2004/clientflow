// M11: production hardening — shared rate limits (ADR-062) and readiness (ADR-064).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresRateLimitStore, pruneRateLimits } from '../src/middleware/rate-limit-store.js';
import { getPreCsrf, login, makeApp, ORIGIN, resetDb, seedAgency, testDb } from './helpers.js';

const db = testDb();
afterAll(() => db.$disconnect());
beforeEach(async () => {
  await resetDb();
  await seedAgency();
});

async function wrongLogin(app: ReturnType<typeof makeApp>['app']) {
  const agent = request.agent(app);
  const pre = await getPreCsrf(agent);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', pre)
    .send({ email: 'owner@agency.test', password: 'definitely-wrong' });
  return res.status;
}

describe('shared rate limits (ADR-062, O1)', () => {
  it('two API instances count failed sign-ins for one account together, and a restart keeps the count', async () => {
    const limits = { rateLimits: { loginFailuresPerEmail: 3 } };
    const a = makeApp(limits, db, { sharedRateLimits: true }).app;
    const b = makeApp(limits, db, { sharedRateLimits: true }).app;
    expect([await wrongLogin(a), await wrongLogin(b), await wrongLogin(a)]).toEqual([
      401, 401, 401,
    ]);
    expect(await wrongLogin(b)).toBe(429);
    // A "restarted" instance reads the same counters.
    const c = makeApp(limits, db, { sharedRateLimits: true }).app;
    expect(await wrongLogin(c)).toBe(429);
    // Keys hold a hash, never the email address.
    const keys = (await db.rateLimitCounter.findMany()).map((r) => r.key);
    expect(keys.some((k) => k.startsWith('login-email:email:'))).toBe(true);
    expect(keys.join(' ')).not.toContain('owner@agency.test');
    // Without the shared store, a separate instance starts from zero (the old behaviour).
    expect(await wrongLogin(makeApp(limits).app)).toBe(401);
  });

  it('counts atomically under concurrency, starts a new window when one ends, and prunes old rows', async () => {
    const store = new PostgresRateLimitStore(db, 'test');
    store.init({ windowMs: 60_000 } as Parameters<PostgresRateLimitStore['init']>[0]);
    const results = await Promise.all(Array.from({ length: 20 }, () => store.increment('k')));
    expect(results.map((r) => r.totalHits).sort((x, y) => x - y)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );
    await store.decrement('k');
    expect((await store.get('k'))?.totalHits).toBe(19);
    await db.rateLimitCounter.update({
      where: { key: 'test:k' },
      data: { resetAt: new Date(Date.now() - 1000) },
    });
    expect(await store.get('k')).toBeUndefined();
    expect((await store.increment('k')).totalHits).toBe(1);
    await store.resetKey('k');
    expect(await store.get('k')).toBeUndefined();
    await store.increment('old');
    await db.rateLimitCounter.update({
      where: { key: 'test:old' },
      data: { resetAt: new Date(Date.now() - 1000) },
    });
    expect(await pruneRateLimits(db)).toBe(1);
  });
});

describe('monitoring (ADR-064)', () => {
  it('readiness reports a lagging job queue as degraded, without taking the instance out', async () => {
    const { app } = makeApp();
    const agencyId = (await db.agency.findFirstOrThrow()).id;
    expect((await request(app).get('/health/ready').expect(200)).body.status).toBe('ok');
    await db.outboxJob.create({
      data: {
        agencyId,
        kind: 'reminders.scan',
        payload: { agencyId },
        availableAt: new Date(Date.now() - 20 * 60_000),
      },
    });
    const res = await request(app).get('/health/ready').expect(200);
    expect(res.body).toEqual({ status: 'degraded', checks: { database: 'ok', jobs: 'lagging' } });
  });

  it('owners and admins see system status with numbers only; others get 403', async () => {
    const { app } = makeApp({}, db, { sharedRateLimits: true });
    const owner = await login(app, 'owner@agency.test');
    const res = await owner.agent.get('/api/v1/ops/status').expect(200);
    expect(res.body.data).toMatchObject({
      rateLimits: 'postgres',
      jobs: { pending: 0, dead: 0, oldestDueSeconds: 0, lagging: false },
    });
    expect(res.body.data.database.latencyMs).toBeGreaterThanOrEqual(0);
    expect(JSON.stringify(res.body)).not.toMatch(/postgres(ql)?:\/\/|password|5433|secret/i);
    for (const who of ['pm@agency.test', 'finance@agency.test', 'salesa@agency.test']) {
      const a = await login(app, who);
      await a.agent.get('/api/v1/ops/status').expect(403);
    }
    await request(app).get('/api/v1/ops/status').expect(401);
  });
});

describe('compression (ADR-065, NFR-03)', () => {
  it('compresses the web app’s files but never API JSON', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'clientflow-web-'));
    mkdirSync(join(dir, 'assets'));
    writeFileSync(
      join(dir, 'index.html'),
      `<!doctype html><div id="root"></div>${' '.repeat(4000)}`,
    );
    writeFileSync(
      join(dir, 'assets', 'app-abc123.js'),
      `console.log(1);${'/* pad */'.repeat(2000)}`,
    );
    const { app } = makeApp({ webDistDir: dir });
    const asset = await request(app).get('/assets/app-abc123.js').set('Accept-Encoding', 'gzip');
    expect(asset.headers['content-encoding']).toBe('gzip');
    const page = await request(app).get('/app/dashboard').set('Accept-Encoding', 'gzip');
    expect(page.headers['content-encoding']).toBe('gzip');
    const api = await request(app).get('/api/v1/auth/csrf').set('Accept-Encoding', 'gzip');
    expect(api.headers['content-encoding']).toBeUndefined();
  });
});
