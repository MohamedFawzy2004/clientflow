import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { BootstrapError, bootstrapOwner } from '../src/modules/auth/bootstrap.js';
import { SESSION_IDLE_MS } from '../src/modules/auth/session.js';
import {
  CSRF_SECRET,
  getPreCsrf,
  login,
  makeApp,
  ORIGIN,
  PASSWORD,
  resetDb,
  seedAgency,
  testDb,
} from './helpers.js';

const db = testDb();

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe('T-AUTH-01 owner bootstrap', () => {
  const input = {
    agencyName: 'Lumen Studio',
    ownerName: 'Mona Adel',
    ownerEmail: 'Owner@Lumen.test',
    password: 'violet-lantern-meadow-42',
  };

  it('creates exactly one agency and owner, and a second run changes nothing', async () => {
    await bootstrapOwner(db, input);
    const before = {
      agencies: await db.agency.count(),
      users: await db.user.count(),
      audits: await db.auditEvent.count(),
    };
    expect(before).toEqual({ agencies: 1, users: 1, audits: 1 });
    const owner = await db.user.findFirstOrThrow();
    expect(owner.role).toBe('OWNER');
    expect(owner.emailNorm).toBe('owner@lumen.test');
    expect(owner.passwordHash).not.toContain(input.password);

    await expect(bootstrapOwner(db, { ...input, ownerEmail: 'second@lumen.test' })).rejects.toMatchObject({
      reason: 'already_bootstrapped',
    });
    expect({
      agencies: await db.agency.count(),
      users: await db.user.count(),
      audits: await db.auditEvent.count(),
    }).toEqual(before);
  });

  it('serializes concurrent bootstraps so only one succeeds', async () => {
    const results = await Promise.allSettled([
      bootstrapOwner(db, input),
      bootstrapOwner(db, { ...input, ownerEmail: 'other@lumen.test' }),
    ]);
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
    expect(await db.user.count()).toBe(1);
  });

  it('rejects weak passwords before writing anything', async () => {
    await expect(bootstrapOwner(db, { ...input, password: 'short' })).rejects.toBeInstanceOf(BootstrapError);
    expect(await db.agency.count()).toBe(0);
  });
});

describe('login', () => {
  it('US-02: valid credentials issue an HttpOnly SameSite session cookie', async () => {
    await seedAgency();
    const { app } = makeApp();
    const { res, agent, csrf } = await login(app, 'Owner@Agency.test');
    const cookie = res.headers['set-cookie'] as unknown as string[];
    const session = cookie.find((c) => c.startsWith('cf_session='))!;
    expect(session).toMatch(/HttpOnly/i);
    expect(session).toMatch(/SameSite=Lax/i);
    expect(session).toMatch(/Path=\//);
    expect(res.body.data.user).toMatchObject({ email: 'owner@agency.test', role: 'OWNER' });
    expect(res.body.data.user.passwordHash).toBeUndefined();
    expect(csrf).toBeTruthy();

    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.agency).toMatchObject({ defaultCurrency: 'EGP', timezone: 'Africa/Cairo' });

    // Only the hash of the token is stored.
    const raw = session.split(';')[0]!.split('=')[1]!;
    const stored = await db.session.findFirstOrThrow();
    expect(stored.tokenHash).not.toBe(raw);
    expect(stored.tokenHash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('T-AUTH-02: wrong password and unknown email return the same generic 401', async () => {
    await seedAgency();
    const { app } = makeApp();
    const attempt = async (email: string, password: string) => {
      const agent = request.agent(app);
      const pre = await getPreCsrf(agent);
      return agent
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', pre)
        .send({ email, password });
    };
    const wrongPassword = await attempt('owner@agency.test', 'not-the-password');
    const unknownEmail = await attempt('nobody@agency.test', 'not-the-password');
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    const strip = (b: { error: { requestId: string } }) => ({ ...b.error, requestId: undefined });
    expect(strip(wrongPassword.body)).toEqual(strip(unknownEmail.body));
    expect(wrongPassword.body.error.message).toBe('Email or password is incorrect.');

    const failures = await db.auditEvent.count({ where: { action: 'auth.login', outcome: 'FAILURE' } });
    expect(failures).toBe(2);
  });

  it('rejects deactivated users with the same generic error', async () => {
    const { users } = await seedAgency();
    await db.user.update({ where: { id: users.salesA!.id }, data: { active: false } });
    const { app } = makeApp();
    await expect(login(app, users.salesA!.email)).rejects.toThrow(/401/);
  });

  it('T-SEC-04: repeated failures for one account are throttled with 429', async () => {
    await seedAgency();
    const { app } = makeApp({ rateLimits: { loginFailuresPerEmail: 3 } });
    const agent = request.agent(app);
    const pre = await getPreCsrf(agent);
    const statuses: number[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await agent
        .post('/api/v1/auth/login')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', pre)
        .send({ email: 'owner@agency.test', password: `wrong-${i}` });
      statuses.push(res.status);
    }
    expect(statuses).toEqual([401, 401, 401, 429, 429]);

    // The limit holds even with the correct password, so guessing cannot continue.
    const blocked = await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ email: 'owner@agency.test', password: PASSWORD });
    expect(blocked.status).toBe(429);
    expect(blocked.body.error.code).toBe('RATE_LIMITED');
  });

  it('validates the login body', async () => {
    await seedAgency();
    const { app } = makeApp();
    const agent = request.agent(app);
    const pre = await getPreCsrf(agent);
    const res = await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ email: 'not-an-email', password: '', role: 'OWNER' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['email', 'password', 'role']);
  });
});

describe('T-SEC-01 CSRF and origin checks', () => {
  it('rejects login without the pre-session CSRF token', async () => {
    await seedAgency();
    const { app } = makeApp();
    const res = await request(app)
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .send({ email: 'owner@agency.test', password: PASSWORD });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('CSRF_INVALID');
  });

  it('rejects a CSRF header that does not match the cookie', async () => {
    await seedAgency();
    const { app } = makeApp();
    const agent = request.agent(app);
    await getPreCsrf(agent);
    const other = await getPreCsrf(request.agent(app));
    const res = await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', other)
      .send({ email: 'owner@agency.test', password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it('rejects authenticated mutations without a valid session CSRF token', async () => {
    await seedAgency();
    const { app } = makeApp();
    const { agent } = await login(app, 'owner@agency.test');
    const missing = await agent.post('/api/v1/contacts').set('Origin', ORIGIN).send({ fullName: 'X' });
    expect(missing.status).toBe(403);
    expect(missing.body.error.code).toBe('CSRF_INVALID');
    const wrong = await agent
      .post('/api/v1/contacts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', 'forged-token')
      .send({ fullName: 'X' });
    expect(wrong.status).toBe(403);
    expect(await db.contact.count()).toBe(0);
  });

  it('rejects mutations from a foreign or missing origin', async () => {
    await seedAgency();
    const { app } = makeApp();
    const { agent, csrf } = await login(app, 'owner@agency.test');
    const foreign = await agent
      .post('/api/v1/contacts')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', csrf)
      .send({ fullName: 'X' });
    expect(foreign.status).toBe(403);
    const none = await agent.post('/api/v1/contacts').set('X-CSRF-Token', csrf).send({ fullName: 'X' });
    expect(none.status).toBe(403);
    expect(await db.contact.count()).toBe(0);
  });

  it('serves a session-bound CSRF token to signed-in users', async () => {
    await seedAgency();
    const { app } = makeApp();
    const { agent, csrf } = await login(app, 'owner@agency.test');
    const res = await agent.get('/api/v1/auth/csrf').expect(200);
    expect(res.body.data.csrfToken).toBe(csrf);
    expect(CSRF_SECRET).not.toContain(csrf);
  });
});

describe('T-AUTH-03 session lifecycle', () => {
  it('rejects the session after logout', async () => {
    await seedAgency();
    const { app } = makeApp();
    const { agent, csrf, res } = await login(app, 'owner@agency.test');
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('cf_session='),
    )!;
    await agent.post('/api/v1/auth/logout').set('Origin', ORIGIN).set('X-CSRF-Token', csrf).expect(200);

    // Replaying the old cookie from a different client must fail.
    const replay = await request(app).get('/api/v1/auth/me').set('Cookie', cookie.split(';')[0]!);
    expect(replay.status).toBe(401);
    const stored = await db.session.findFirstOrThrow();
    expect(stored.revokedAt).not.toBeNull();
    expect(await db.auditEvent.count({ where: { action: 'auth.logout' } })).toBe(1);
  });

  it('rejects sessions past their absolute expiry or idle timeout', async () => {
    await seedAgency();
    const { app } = makeApp();
    const first = await login(app, 'owner@agency.test');
    // created_at moves too: the schema requires expires_at > created_at.
    await db.session.updateMany({
      data: { createdAt: new Date(Date.now() - 8 * 86_400_000), expiresAt: new Date(Date.now() - 1000) },
    });
    await first.agent.get('/api/v1/auth/me').expect(401);

    const second = await login(app, 'owner@agency.test');
    await db.session.updateMany({
      where: { revokedAt: null },
      data: { lastSeenAt: new Date(Date.now() - SESSION_IDLE_MS - 1000) },
    });
    await second.agent.get('/api/v1/auth/me').expect(401);
  });

  it('rejects existing sessions once the user is deactivated', async () => {
    const { users } = await seedAgency();
    const { app } = makeApp();
    const { agent } = await login(app, users.salesA!.email);
    await agent.get('/api/v1/auth/me').expect(200);
    await db.user.update({ where: { id: users.salesA!.id }, data: { active: false } });
    await agent.get('/api/v1/auth/me').expect(401);
  });

  it('rotates the session on a new login from the same browser', async () => {
    await seedAgency();
    const { app } = makeApp();
    const { agent } = await login(app, 'owner@agency.test');
    const pre = await getPreCsrf(agent);
    await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ email: 'owner@agency.test', password: PASSWORD })
      .expect(200);
    const sessions = await db.session.findMany({ orderBy: { createdAt: 'asc' } });
    expect(sessions).toHaveLength(2);
    expect(sessions[0]!.revokedAt).not.toBeNull();
    expect(sessions[1]!.revokedAt).toBeNull();
  });

  it('ignores malformed session cookies', async () => {
    const { app } = makeApp();
    await request(app).get('/api/v1/auth/me').set('Cookie', 'cf_session=<script>').expect(401);
  });
});
