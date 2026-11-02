// M12.1 — two-step sign-in (ADR-069).
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import type { Express } from 'express';
import { loadEnv, mfaRequiredRoles } from '../src/config/env.js';
import {
  base32Decode,
  base32Encode,
  openSecret,
  sealSecret,
  stepAt,
  totpCode,
  verifyTotp,
} from '../src/lib/totp.js';
import {
  getPreCsrf,
  login,
  makeApp,
  MFA_KEY,
  ORIGIN,
  PASSWORD,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';

const db = testDb();

describe('TOTP (RFC 6238)', () => {
  // RFC 6238 appendix B, SHA-1 secret "12345678901234567890"; the last 6 digits of each value.
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('time %i gives %s', (seconds, code) => {
    expect(totpCode(secret, stepAt(seconds * 1000))).toBe(code);
  });

  it('accepts one step of clock drift either way, never an old step again', () => {
    const now = 1_800_000_000_000;
    const step = stepAt(now);
    expect(verifyTotp(secret, totpCode(secret, step - 1), now)).toBe(step - 1);
    expect(verifyTotp(secret, totpCode(secret, step + 1), now)).toBe(step + 1);
    expect(verifyTotp(secret, totpCode(secret, step - 2), now)).toBeNull();
    expect(verifyTotp(secret, totpCode(secret, step), now, step)).toBeNull();
    expect(verifyTotp(secret, 'abcdef', now)).toBeNull();
  });

  it('base32 and the secret seal round-trip; a changed byte is refused', () => {
    const raw = Buffer.from('a 20-byte secret!!!!');
    expect(base32Decode(base32Encode(raw)).equals(raw)).toBe(true);
    const sealed = sealSecret(MFA_KEY, raw);
    expect(openSecret(MFA_KEY, sealed).equals(raw)).toBe(true);
    sealed[sealed.length - 1]! ^= 1;
    expect(() => openSecret(MFA_KEY, sealed)).toThrow();
  });
});

describe('required roles', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/clientflow',
    APP_ORIGINS: 'https://crm.example.test',
    CSRF_SECRET: 'x'.repeat(40),
    FILE_ENCRYPTION_KEY: 'ab'.repeat(32),
    MAIL_TRANSPORT: 'disabled' as const,
  };
  it('defaults to Owner and Admin in production, none in a demo or in development', () => {
    expect(mfaRequiredRoles(loadEnv({ ...base, NODE_ENV: 'production' }))).toEqual([
      'OWNER',
      'ADMIN',
    ]);
    expect(
      mfaRequiredRoles(loadEnv({ ...base, NODE_ENV: 'production', DEMO_MODE: 'true' })),
    ).toEqual([]);
    expect(mfaRequiredRoles(loadEnv({ ...base }))).toEqual([]);
    expect(mfaRequiredRoles(loadEnv({ ...base, MFA_REQUIRED_ROLES: 'none' }))).toEqual([]);
    expect(mfaRequiredRoles(loadEnv({ ...base, MFA_REQUIRED_ROLES: 'owner, finance' }))).toEqual([
      'OWNER',
      'FINANCE',
    ]);
    expect(() => loadEnv({ ...base, MFA_REQUIRED_ROLES: 'OWNER,KING' })).toThrow(/KING/);
  });
});

/** Turns two-step sign-in on through the API and returns the secret and recovery codes. */
async function enroll(app: Express, email: string) {
  const s = await login(app, email);
  const start = await s.agent
    .post('/api/v1/auth/mfa/setup')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .send({ password: PASSWORD })
    .expect(200);
  const secret = base32Decode(start.body.data.secret);
  const enabled = await s.agent
    .post('/api/v1/auth/mfa/enable')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .send({ code: totpCode(secret, stepAt(Date.now())) })
    .expect(200);
  return { secret, recoveryCodes: enabled.body.data.recoveryCodes as string[], session: s };
}

/** Password step; returns an agent holding the challenge cookie and its pre-session token. */
async function passwordStep(app: Express, email: string) {
  const agent = request.agent(app);
  const pre = await getPreCsrf(agent);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', pre)
    .send({ email, password: PASSWORD })
    .expect(200);
  return { agent, pre, res };
}

const verify = (s: { agent: ReturnType<typeof request.agent>; pre: string }, body: object) =>
  s.agent
    .post('/api/v1/auth/mfa/verify')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', s.pre)
    .send(body);

// The enrolment used the current step, so the next valid code is one step ahead.
const nextCode = (secret: Buffer) => totpCode(secret, stepAt(Date.now()) + 1);

describe('two-step sign-in', () => {
  let seeded: SeededAgency;
  let app: Express;

  beforeEach(async () => {
    await resetDb();
    seeded = await seedAgency();
    app = makeApp().app;
  });

  it('setup needs the password, a correct code, and ends the other sessions', async () => {
    const email = seeded.users.salesA!.email;
    const other = await login(app, email);
    const s = await login(app, email);
    await s.agent
      .post('/api/v1/auth/mfa/setup')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', s.csrf)
      .send({ password: 'wrong password entirely' })
      .expect(422);
    const start = await s.agent
      .post('/api/v1/auth/mfa/setup')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', s.csrf)
      .send({ password: PASSWORD })
      .expect(200);
    expect(start.body.data.otpauthUrl).toMatch(
      /^otpauth:\/\/totp\/ClientFlow%3Asalesa%40agency\.test\?secret=/,
    );
    await s.agent
      .post('/api/v1/auth/mfa/enable')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', s.csrf)
      .send({ code: '000000' })
      .expect(422);
    const secret = base32Decode(start.body.data.secret);
    const enabled = await s.agent
      .post('/api/v1/auth/mfa/enable')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', s.csrf)
      .send({ code: totpCode(secret, stepAt(Date.now())) })
      .expect(200);
    expect(enabled.body.data.recoveryCodes).toHaveLength(10);

    const me = await s.agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.mfa).toEqual({ enabled: true, required: false });
    await other.agent.get('/api/v1/auth/me').expect(401);

    // Stored encrypted, recovery codes hashed.
    const user = await db.user.findUniqueOrThrow({ where: { id: seeded.users.salesA!.id } });
    expect(Buffer.from(user.mfaSecretEnc!).includes(secret)).toBe(false);
    const codes = await db.mfaRecoveryCode.findMany({ where: { userId: user.id } });
    expect(codes.map((c) => c.codeHash)).not.toContain(enabled.body.data.recoveryCodes[0]);
    const actions = (await db.auditEvent.findMany({ where: { actorId: user.id } })).map(
      (a) => a.action,
    );
    expect(actions).toEqual(expect.arrayContaining(['mfa.setup_started', 'mfa.enabled']));
  });

  it('sign-in waits for a code; no session before it, and a code works only once', async () => {
    const email = seeded.users.salesA!.email;
    const { secret } = await enroll(app, email);

    const step1 = await passwordStep(app, email);
    expect(step1.res.body.data).toEqual({ mfaRequired: true });
    const cookies = String(step1.res.headers['set-cookie']);
    expect(cookies).not.toMatch(/cf_session=/);
    expect(cookies).toMatch(/cf_mfa=.*HttpOnly.*SameSite=Strict/i);
    await step1.agent.get('/api/v1/auth/me').expect(401);

    expect((await verify(step1, { code: '123456' })).status).toBe(422);
    const code = nextCode(secret);
    const ok = await verify(step1, { code }).expect(200);
    expect(ok.body.data.user.mfa.enabled).toBe(true);
    await step1.agent.get('/api/v1/auth/me').expect(200);

    // Same code again, on a new challenge: refused (no replay).
    const step2 = await passwordStep(app, email);
    expect((await verify(step2, { code })).status).toBe(422);
  });

  it('five wrong codes end the challenge, even for a right code after', async () => {
    const email = seeded.users.salesA!.email;
    const { secret } = await enroll(app, email);
    const s = await passwordStep(app, email);
    for (let i = 0; i < 4; i++) expect((await verify(s, { code: '000000' })).status).toBe(422);
    expect((await verify(s, { code: '000000' })).status).toBe(401);
    const after = await verify(s, { code: nextCode(secret) });
    expect(after.status).toBe(401);
    expect(after.body.error.code).toBe('TOKEN_INVALID');
    const failures = await db.auditEvent.count({
      where: { action: 'auth.mfa_verify', outcome: 'FAILURE' },
    });
    expect(failures).toBe(5);
  });

  // Security audit F1: a password holder used to get five new guesses with every challenge.
  it('wrong codes are limited per account across challenges, and the person is emailed', async () => {
    const t = makeApp();
    const email = seeded.users.salesA!.email;
    const { secret } = await enroll(t.app, email);
    for (let round = 0; round < 2; round++) {
      const s = await passwordStep(t.app, email);
      for (let i = 0; i < 5; i++) {
        expect([401, 422]).toContain((await verify(s, { code: '000000' })).status);
      }
    }
    // A third challenge still opens (the password was right), but no code is checked now.
    const s = await passwordStep(t.app, email);
    const locked = await verify(s, { code: nextCode(secret) });
    expect(locked.status).toBe(429);
    expect(locked.body.error.code).toBe('RATE_LIMITED');
    expect(t.mailer.messages.filter((m) => m.kind === 'mfa_locked')).toHaveLength(1);
    expect(await db.auditEvent.count({ where: { action: 'mfa.account_locked' } })).toBe(1);
    expect(await db.auditEvent.count({ where: { action: 'mfa.check_refused' } })).toBe(1);

    // After the pause the right code works and the budget starts again.
    const past = new Date(Date.now() - 16 * 60_000);
    await db.user.update({
      where: { id: seeded.users.salesA!.id },
      data: { mfaLockedUntil: past, mfaFailureWindowAt: past },
    });
    const later = await passwordStep(t.app, email);
    await verify(later, { code: nextCode(secret) }).expect(200);
    const user = await db.user.findUniqueOrThrow({ where: { id: seeded.users.salesA!.id } });
    expect(user.mfaFailedAttempts).toBe(0);
    expect(user.mfaLockedUntil).toBeNull();
  });

  // F2: the try is reserved before the code is compared, so parallel guesses cannot add up.
  it('parallel guesses on one challenge stop at five, without errors, all audited', async () => {
    const email = seeded.users.salesA!.email;
    await enroll(app, email);
    const s = await passwordStep(app, email);
    const results = await Promise.all(
      Array.from({ length: 12 }, () => verify(s, { code: '000000' })),
    );
    const statuses = results.map((r) => r.status);
    expect(statuses).not.toContain(500);
    expect(statuses.filter((x) => x === 422).length).toBeLessThanOrEqual(4);
    const failures = await db.auditEvent.count({
      where: { action: 'auth.mfa_verify', outcome: 'FAILURE' },
    });
    expect(failures).toBe(5);
    const challenge = await db.mfaChallenge.findFirstOrThrow({
      where: { userId: seeded.users.salesA!.id },
    });
    expect(challenge.attempts).toBe(5);
  });

  // F3: a stolen session could test passwords and codes without limit, then mint new
  // recovery codes. Wrong passwords and wrong codes now spend the same budget as sign-in.
  it('signed-in password and code checks share the account budget', async () => {
    const email = seeded.users.salesA!.email;
    const { secret, session } = await enroll(app, email);
    const post = (path: string, body: object) =>
      session.agent
        .post(`/api/v1/auth/mfa/${path}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', session.csrf)
        .send(body);
    for (let i = 0; i < 5; i++) {
      expect((await post('setup', { password: `wrong password number ${i}` })).status).toBe(422);
    }
    for (let i = 0; i < 5; i++) {
      const res = await post('recovery-codes', { password: PASSWORD, code: '000000' });
      expect(res.status).toBe(422);
    }
    const blocked = await post('recovery-codes', { password: PASSWORD, code: nextCode(secret) });
    expect(blocked.status).toBe(429);
    expect(await db.mfaRecoveryCode.count({ where: { usedAt: null } })).toBe(10); // unchanged
  });

  it('a right answer clears earlier wrong ones', async () => {
    const email = seeded.users.salesA!.email;
    const { secret } = await enroll(app, email);
    const s = await passwordStep(app, email);
    for (let i = 0; i < 4; i++) expect((await verify(s, { code: '000000' })).status).toBe(422);
    await verify(s, { code: nextCode(secret) }).expect(200);
    const user = await db.user.findUniqueOrThrow({ where: { id: seeded.users.salesA!.id } });
    expect(user.mfaFailedAttempts).toBe(0);
  });

  it('an expired challenge is refused', async () => {
    const email = seeded.users.salesA!.email;
    const { secret } = await enroll(app, email);
    const s = await passwordStep(app, email);
    await db.mfaChallenge.updateMany({
      data: { createdAt: new Date(Date.now() - 600_000), expiresAt: new Date(Date.now() - 1) },
    });
    expect((await verify(s, { code: nextCode(secret) })).status).toBe(401);
  });

  it('a recovery code signs in once, then never again', async () => {
    const email = seeded.users.salesA!.email;
    const { recoveryCodes } = await enroll(app, email);
    const first = await passwordStep(app, email);
    await verify(first, { recoveryCode: recoveryCodes[0]!.toLowerCase().replace(/-/g, '') }).expect(
      200,
    );
    const second = await passwordStep(app, email);
    expect((await verify(second, { recoveryCode: recoveryCodes[0] })).status).toBe(422);
    expect(await db.auditEvent.count({ where: { action: 'mfa.recovery_code_used' } })).toBe(1);
  });

  it('a role that requires it can only set it up until it is on', async () => {
    const strict = makeApp({ mfa: { key: MFA_KEY, requiredRoles: ['OWNER', 'ADMIN'] } }).app;
    const admin = await login(strict, seeded.users.admin!.email);
    const me = await admin.agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.mfa).toEqual({ enabled: false, required: true });
    const blocked = await admin.agent.get('/api/v1/contacts').expect(403);
    expect(blocked.body.error.code).toBe('MFA_SETUP_REQUIRED');
    await admin.agent
      .post('/api/v1/contacts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', admin.csrf)
      .send({ fullName: 'Blocked' })
      .expect(403);
    // Other roles are not affected.
    const sales = await login(strict, seeded.users.salesA!.email);
    await sales.agent.get('/api/v1/contacts').expect(200);

    const { secret } = await enroll(strict, seeded.users.admin!.email);
    const s = await passwordStep(strict, seeded.users.admin!.email);
    await verify(s, { code: nextCode(secret) }).expect(200);
    await s.agent.get('/api/v1/contacts').expect(200);

    // And it cannot be turned off while the role requires it.
    const csrf = (await s.agent.get('/api/v1/auth/csrf')).body.data.csrfToken;
    await s.agent
      .post('/api/v1/auth/mfa/disable')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ password: PASSWORD, code: '000000' })
      .expect(403);
  });

  it('others can turn it off with their password and a code', async () => {
    const email = seeded.users.salesA!.email;
    const { secret, session } = await enroll(app, email);
    await session.agent
      .post('/api/v1/auth/mfa/disable')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', session.csrf)
      .send({ password: PASSWORD, code: nextCode(secret) })
      .expect(200);
    const again = await passwordStep(app, email);
    expect(again.res.body.data.user).toBeDefined(); // straight in, no code
    expect(await db.mfaRecoveryCode.count()).toBe(0);
  });

  it('an Owner can reset someone else, who is signed out; nobody else can', async () => {
    const adminEmail = seeded.users.admin!.email;
    const { session: adminSession } = await enroll(app, adminEmail);
    const owner = await login(app, seeded.users.owner!.email);
    const reset = (s: { agent: ReturnType<typeof request.agent>; csrf: string }, id: string) =>
      s.agent
        .post(`/api/v1/users/${id}/mfa-reset`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', s.csrf)
        .send({});

    expect((await passwordStep(app, adminEmail)).res.body.data.mfaRequired).toBe(true);
    expect((await reset(adminSession, seeded.users.salesA!.id)).status).toBe(403); // Admin: not allowed
    expect((await reset(owner, seeded.users.owner!.id)).status).toBe(403); // not yourself
    await reset(owner, seeded.users.admin!.id).expect(200);

    await adminSession.agent.get('/api/v1/auth/me').expect(401);
    const after = await passwordStep(app, adminEmail);
    expect(after.res.body.data.user.mfa.enabled).toBe(false);
    const audit = await db.auditEvent.findFirst({ where: { action: 'mfa.reset' } });
    expect(audit?.targetId).toBe(seeded.users.admin!.id);
  });
});
