// M11: production hardening — shared rate limits (ADR-062) and readiness (ADR-064).
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { PostgresRateLimitStore, pruneRateLimits } from '../src/middleware/rate-limit-store.js';
import { getPreCsrf, makeApp, ORIGIN, resetDb, seedAgency, testDb } from './helpers.js';

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
