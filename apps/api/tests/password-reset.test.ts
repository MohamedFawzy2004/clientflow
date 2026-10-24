import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { RESET_TOKEN_TTL_MS } from '../src/modules/auth/password-reset.js';
import {
  getPreCsrf,
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

const db = testDb();
const NEW_PASSWORD = 'quiet-harbor-lantern-58';
let seeded: SeededAgency;
let t: TestApp;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
});
afterAll(() => db.$disconnect());

async function form(path: string, body: object) {
  const agent = request.agent(t.app);
  const pre = await getPreCsrf(agent);
  return agent.post(path).set('Origin', ORIGIN).set('X-CSRF-Token', pre).send(body);
}

async function requestReset(email: string) {
  const res = await form('/api/v1/auth/password-reset/request', { email });
  await t.settled();
  return res;
}

describe('FR-I06 request', () => {
  it('answers the same 202 for known, unknown and deactivated accounts', async () => {
    await db.user.update({ where: { id: seeded.users.member!.id }, data: { active: false } });
    const known = await requestReset(seeded.users.salesA!.email);
    const unknown = await requestReset('nobody@agency.test');
    const inactive = await requestReset(seeded.users.member!.email);
    for (const res of [known, unknown, inactive]) expect(res.status).toBe(202);
    const strip = (r: typeof known) => ({ ...r.body, meta: undefined });
    expect(strip(known)).toEqual(strip(unknown));
    expect(strip(known)).toEqual(strip(inactive));

    // Only the active account gets an email and a token.
    expect(t.mailer.messages.map((m) => m.to)).toEqual([seeded.users.salesA!.email]);
    expect(await db.passwordResetToken.count()).toBe(1);
  });

  it('stores only a hash, expires in 30 minutes, and links with a URL fragment', async () => {
    await requestReset(seeded.users.salesA!.email);
    const token = t.mailer.lastToken('password_reset')!;
    expect(t.mailer.messages[0]!.text).toContain(`${ORIGIN}/reset-password#token=`);
    const row = await db.passwordResetToken.findFirstOrThrow();
    expect(row.tokenHash).not.toContain(token);
    expect(row.expiresAt.getTime() - row.createdAt.getTime()).toBe(RESET_TOKEN_TTL_MS);
  });

  it('a new request invalidates the previous link', async () => {
    await requestReset(seeded.users.salesA!.email);
    const first = t.mailer.lastToken('password_reset')!;
    await requestReset(seeded.users.salesA!.email);
    const second = t.mailer.lastToken('password_reset')!;
    expect(second).not.toBe(first);
    const old = await form('/api/v1/auth/password-reset/confirm', {
      token: first,
      password: NEW_PASSWORD,
    });
    expect(old.status).toBe(400);
    const fresh = await form('/api/v1/auth/password-reset/confirm', {
      token: second,
      password: NEW_PASSWORD,
    });
    expect(fresh.status).toBe(200);
  });

  it('throttles repeated requests for one email', async () => {
    const app = makeApp({ rateLimits: { resetRequestsPerEmail: 2 } });
    t = app;
    const statuses = [];
    for (let i = 0; i < 4; i++)
      statuses.push((await requestReset(seeded.users.salesA!.email)).status);
    expect(statuses).toEqual([202, 202, 429, 429]);
    expect(app.mailer.messages).toHaveLength(2);
  });

  it('requires CSRF', async () => {
    const res = await request(t.app)
      .post('/api/v1/auth/password-reset/request')
      .set('Origin', ORIGIN)
      .send({ email: seeded.users.salesA!.email });
    expect(res.status).toBe(403);
  });
});

describe('FR-I06 confirm', () => {
  it('sets the new password, revokes every session and sends a notification', async () => {
    const before = await login(t.app, seeded.users.salesA!.email);
    await requestReset(seeded.users.salesA!.email);
    const token = t.mailer.lastToken('password_reset')!;

    const res = await form('/api/v1/auth/password-reset/confirm', {
      token,
      password: NEW_PASSWORD,
    });
    expect(res.status).toBe(200);
    // Not signed in automatically: the user signs in with the new password.
    expect(
      (res.headers['set-cookie'] as unknown as string[] | undefined)?.some((c) =>
        c.startsWith('cf_session='),
      ) ?? false,
    ).toBe(false);

    await before.agent.get('/api/v1/auth/me').expect(401);
    await expect(login(t.app, seeded.users.salesA!.email, PASSWORD)).rejects.toThrow(/401/);
    await login(t.app, seeded.users.salesA!.email, NEW_PASSWORD);

    expect(t.mailer.messages.at(-1)).toMatchObject({
      kind: 'password_changed',
      to: seeded.users.salesA!.email,
    });
    expect(await db.auditEvent.count({ where: { action: 'auth.password_reset' } })).toBe(1);
  });

  it('a token is single-use, also under concurrency', async () => {
    await requestReset(seeded.users.salesA!.email);
    const token = t.mailer.lastToken('password_reset')!;
    const results = await Promise.all([
      form('/api/v1/auth/password-reset/confirm', { token, password: NEW_PASSWORD }),
      form('/api/v1/auth/password-reset/confirm', { token, password: 'second-amber-violin-34' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 400]);
  });

  it('rejects expired tokens and tokens of deactivated users', async () => {
    await requestReset(seeded.users.salesA!.email);
    const token = t.mailer.lastToken('password_reset')!;
    await db.passwordResetToken.updateMany({
      data: { createdAt: new Date(Date.now() - 3_600_000), expiresAt: new Date(Date.now() - 1000) },
    });
    const expired = await form('/api/v1/auth/password-reset/confirm', {
      token,
      password: NEW_PASSWORD,
    });
    expect(expired.status).toBe(400);
    expect(expired.body.error.code).toBe('TOKEN_INVALID');

    await requestReset(seeded.users.salesB!.email);
    const tokenB = t.mailer.lastToken('password_reset')!;
    await db.user.update({ where: { id: seeded.users.salesB!.id }, data: { active: false } });
    const inactive = await form('/api/v1/auth/password-reset/confirm', {
      token: tokenB,
      password: NEW_PASSWORD,
    });
    expect(inactive.status).toBe(400);
  });

  it('enforces the password policy and keeps the token usable after a rejection', async () => {
    await requestReset(seeded.users.salesA!.email);
    const token = t.mailer.lastToken('password_reset')!;
    const weak = await form('/api/v1/auth/password-reset/confirm', {
      token,
      password: 'qwertyuiop12',
    });
    expect(weak.status).toBe(422);
    expect(weak.body.error.fieldErrors.password).toHaveLength(1);
    const ok = await form('/api/v1/auth/password-reset/confirm', { token, password: NEW_PASSWORD });
    expect(ok.status).toBe(200);
  });

  it('logs never contain reset tokens', async () => {
    await requestReset(seeded.users.salesA!.email);
    const token = t.mailer.lastToken('password_reset')!;
    await form('/api/v1/auth/password-reset/confirm', { token, password: NEW_PASSWORD });
    const all = t.logs.join('\n');
    expect(all).not.toContain(token);
    expect(all).not.toContain(NEW_PASSWORD);
  });
});
