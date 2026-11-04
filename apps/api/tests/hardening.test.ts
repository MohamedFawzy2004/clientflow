// M11: production hardening — shared rate limits (ADR-062) and readiness (ADR-064).
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { pruneExpiredAuth, pruneIdempotencyRecords } from '../src/lib/retention.js';
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
    // Supertest connects over loopback; behind Render this is the visitor's public IP.
    expect(res.body.data.clientIp).toMatch(/127\.0\.0\.1|::1/);
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

describe('retention of short-lived security records (NFR-12)', () => {
  it('removes sessions and reset links 30 days after they ended, and keeps the rest', async () => {
    const user = await db.user.findFirstOrThrow({ where: { emailNorm: 'owner@agency.test' } });
    const day = 86_400_000;
    const at = (d: number) => new Date(Date.now() + d * day);
    const mk = (n: string, expiresAt: Date, revokedAt: Date | null = null) =>
      db.session.create({
        data: {
          userId: user.id,
          tokenHash: n.padEnd(64, '0'),
          createdAt: new Date(expiresAt.getTime() - 7 * day),
          expiresAt,
          revokedAt,
        },
      });
    await mk('a', at(-31));
    await mk('b', at(-29));
    await mk('c', at(5), at(-40));
    await mk('d', at(5));
    await db.passwordResetToken.createMany({
      data: [
        { userId: user.id, tokenHash: 'e'.padEnd(64, '0'), createdAt: at(-32), expiresAt: at(-31) },
        { userId: user.id, tokenHash: 'f'.padEnd(64, '0'), createdAt: at(-2), expiresAt: at(-1) },
      ],
    });
    // Security audit F17: challenges, used recovery codes and dead invitations go the same way.
    await db.mfaChallenge.createMany({
      data: [
        { userId: user.id, tokenHash: 'g'.padEnd(64, '0'), createdAt: at(-32), expiresAt: at(-31) },
        { userId: user.id, tokenHash: 'h'.padEnd(64, '0'), createdAt: at(-2), expiresAt: at(-1) },
      ],
    });
    await db.mfaRecoveryCode.createMany({
      data: [
        { userId: user.id, codeHash: 'i'.padEnd(64, '0'), createdAt: at(-60), usedAt: at(-31) },
        { userId: user.id, codeHash: 'j'.padEnd(64, '0'), createdAt: at(-60), usedAt: at(-1) },
        { userId: user.id, codeHash: 'k'.padEnd(64, '0'), createdAt: at(-60) },
      ],
    });
    const invite = (n: string, expiresAt: Date, extra: object = {}) => ({
      agencyId: user.agencyId,
      emailNorm: `${n}@agency.test`,
      role: 'SALES' as const,
      tokenHash: Buffer.from(n).toString('hex').padEnd(64, '0'),
      createdAt: at(-60),
      expiresAt,
      invitedById: user.id,
      ...extra,
    });
    await db.invitation.createMany({
      data: [
        invite('l', at(-31)), // expired long ago: removed
        invite('m', at(5), { revokedAt: at(-40) }), // revoked long ago: removed
        invite('n', at(-1)), // expired recently: kept
        invite('o', at(5)), // still open: kept
      ],
    });
    const accepted = await db.user.findFirstOrThrow({ where: { role: 'SALES' } });
    await db.invitation.create({
      data: invite('p', at(-50), { acceptedAt: at(-55), acceptedUserId: accepted.id }),
    });

    expect(await pruneExpiredAuth(db)).toEqual({
      sessions: 2,
      resetTokens: 1,
      mfaChallenges: 1,
      recoveryCodes: 1,
      invitations: 2,
    });
    expect((await db.session.findMany()).map((s) => s.tokenHash[0]).sort()).toEqual(['b', 'd']);
    expect((await db.mfaRecoveryCode.findMany()).map((c) => c.codeHash[0]).sort()).toEqual([
      'j',
      'k',
    ]);
    expect((await db.invitation.findMany()).map((i) => i.emailNorm[0]).sort()).toEqual([
      'n',
      'o',
      'p',
    ]);
  });

  it('removes idempotency records after 30 days, when no retry can still arrive', async () => {
    const user = await db.user.findFirstOrThrow({ where: { emailNorm: 'owner@agency.test' } });
    const at = (d: number) => new Date(Date.now() + d * 86_400_000);
    const rec = (scope: string, createdAt: Date) => ({
      agencyId: user.agencyId,
      actorId: user.id,
      scope,
      key: crypto.randomUUID(),
      requestHash: '0'.repeat(64),
      resultId: crypto.randomUUID(),
      createdAt,
    });
    await db.idempotencyRecord.createMany({
      data: [rec('old', at(-31)), rec('recent', at(-29)), rec('today', at(0))],
    });
    expect(await pruneIdempotencyRecords(db)).toEqual({ idempotencyRecords: 1 });
    expect((await db.idempotencyRecord.findMany()).map((r) => r.scope).sort()).toEqual([
      'recent',
      'today',
    ]);
  });
});

describe('file storage startup check (ADR-067)', () => {
  it('passes for a writable folder and fails when the path is not a folder', async () => {
    const { LocalEncryptedStorage } = await import('../src/modules/files/storage.js');
    const dir = mkdtempSync(join(tmpdir(), 'cf-store-'));
    const key = Buffer.alloc(32, 1);
    expect(() => new LocalEncryptedStorage(join(dir, 'files'), key).checkWritable()).not.toThrow();
    writeFileSync(join(dir, 'not-a-folder'), 'x');
    expect(() =>
      new LocalEncryptedStorage(join(dir, 'not-a-folder'), key).checkWritable(),
    ).toThrow();
  });
});
