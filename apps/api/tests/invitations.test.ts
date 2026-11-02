import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { INVITATION_TTL_MS } from '../src/modules/invitations/service.js';
import {
  getPreCsrf,
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
const STRONG = 'amber-orchard-signal-77';
let seeded: SeededAgency;
let t: TestApp;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
});
afterAll(() => db.$disconnect());

async function asUser(key: string) {
  const { agent, csrf } = await login(t.app, seeded.users[key]!.email);
  const post = (path: string, body: object = {}) =>
    agent.post(path).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body);
  return { agent, post };
}

async function invite(email: string, role = 'SALES', as = 'owner') {
  const u = await asUser(as);
  const res = await u.post('/api/v1/invitations', { email, role });
  const token = new URL(res.body.data?.acceptUrl ?? 'http://x/#token=').hash.replace('#token=', '');
  return { res, token, ...u };
}

/** Signed-out browser accepting an invite: fetches a pre-session CSRF token first. */
async function accept(token: string, name = 'New Person', password = STRONG) {
  const agent = request.agent(t.app);
  const pre = await getPreCsrf(agent);
  const res = await agent
    .post('/api/v1/invitations/accept')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', pre)
    .send({ token, name, password });
  return { agent, res };
}

describe('US-03 / FR-I04 create invitation', () => {
  it('creates a pending, hashed, 7-day invitation and emails a fragment link', async () => {
    const { res, token } = await invite('New.Hire@Agency.test', 'PM');
    expect(res.status).toBe(201);
    expect(res.body.data.invitation).toMatchObject({
      email: 'new.hire@agency.test',
      role: 'PM',
      status: 'PENDING',
    });
    expect(res.body.data.acceptUrl).toMatch(
      new RegExp(`^${ORIGIN}/activate-invite#token=[A-Za-z0-9_-]{43}$`),
    );
    expect(res.body.data.emailDelivery).toBe('sent_to_dev_sink');

    const row = await db.invitation.findFirstOrThrow();
    expect(row.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.tokenHash).not.toContain(token);
    const ttl = row.expiresAt.getTime() - row.createdAt.getTime();
    expect(ttl).toBe(INVITATION_TTL_MS);

    expect(t.mailer.messages).toHaveLength(1);
    expect(t.mailer.messages[0]).toMatchObject({ kind: 'invitation', to: 'new.hire@agency.test' });
    expect(t.mailer.lastToken('invitation')).toBe(token);
    expect(await db.auditEvent.count({ where: { action: 'invitation.create' } })).toBe(1);
  });

  it('is listed for admins with its status', async () => {
    await invite('a@agency.test');
    const admin = await asUser('admin');
    const list = await admin.agent.get('/api/v1/invitations').expect(200);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ email: 'a@agency.test', status: 'PENDING' });
    expect(JSON.stringify(list.body)).not.toMatch(/token/i);
  });

  it('replacing an open invite revokes the earlier link', async () => {
    const first = await invite('dup@agency.test');
    const second = await invite('dup@agency.test', 'MEMBER');
    expect(second.res.status).toBe(201);
    const rows = await db.invitation.findMany({ orderBy: { createdAt: 'asc' } });
    expect(rows.map((r) => Boolean(r.revokedAt))).toEqual([true, false]);
    expect((await accept(first.token)).res.status).toBe(400);
    expect((await accept(second.token)).res.status).toBe(201);
  });

  it('refuses to invite an existing member', async () => {
    const { res } = await invite(seeded.users.salesA!.email);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('only owners can invite owners; nobody can invite CLIENT staff', async () => {
    const asAdmin = await invite('boss@agency.test', 'OWNER', 'admin');
    expect(asAdmin.res.status).toBe(403);
    const asOwner = await invite('boss@agency.test', 'OWNER', 'owner');
    expect(asOwner.res.status).toBe(201);
    const client = await invite('client@agency.test', 'CLIENT', 'owner');
    expect(client.res.status).toBe(422);
    expect(await db.invitation.count()).toBe(1);
  });

  it.each(['manager', 'salesA', 'pm', 'member', 'finance'])('%s cannot invite', async (key) => {
    const { res } = await invite('x@agency.test', 'SALES', key);
    expect(res.status).toBe(403);
    expect(await db.invitation.count()).toBe(0);
  });

  it('rejects mass-assignment fields in the create body', async () => {
    const u = await asUser('owner');
    const res = await u.post('/api/v1/invitations', {
      email: 'x@agency.test',
      role: 'SALES',
      agencyId: '00000000-0000-0000-0000-000000000000',
      expiresAt: '2099-01-01T00:00:00Z',
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['agencyId', 'expiresAt']);
  });
});

describe('FR-I05 / T-AUTH-04 accept invitation', () => {
  it('previews a valid invite without exposing the token', async () => {
    const { token } = await invite('p@agency.test', 'FINANCE');
    const agent = request.agent(t.app);
    const pre = await getPreCsrf(agent);
    const res = await agent
      .post('/api/v1/invitations/preview')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ token })
      .expect(200);
    expect(res.body.data).toMatchObject({
      email: 'p@agency.test',
      role: 'FINANCE',
      agencyName: 'Test Agency',
    });
  });

  it('creates the user with the invited email and role and signs them in', async () => {
    const { token } = await invite('Joiner@Agency.test', 'PM');
    const { res, agent } = await accept(token, '  Jana Joiner ');
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({
      email: 'joiner@agency.test',
      role: 'PM',
      name: 'Jana Joiner',
    });
    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((c) =>
      c.startsWith('cf_session='),
    );
    expect(cookie).toMatch(/HttpOnly/i);
    await agent.get('/api/v1/auth/me').expect(200);

    const user = await db.user.findFirstOrThrow({ where: { emailNorm: 'joiner@agency.test' } });
    const inv = await db.invitation.findFirstOrThrow();
    expect(inv.acceptedUserId).toBe(user.id);
    expect(inv.acceptedAt).not.toBeNull();
    expect(await db.auditEvent.count({ where: { action: 'invitation.accept' } })).toBe(1);
  });

  it('T-AUTH-04: a token works exactly once', async () => {
    const { token } = await invite('once@agency.test');
    expect((await accept(token)).res.status).toBe(201);
    const again = await accept(token, 'Someone Else', 'another-strong-phrase-91');
    expect(again.res.status).toBe(400);
    expect(again.res.body.error.code).toBe('TOKEN_INVALID');
    expect(await db.user.count({ where: { emailNorm: 'once@agency.test' } })).toBe(1);
  });

  it('T-AUTH-04: concurrent acceptance of one token creates one user', async () => {
    const { token } = await invite('race@agency.test');
    const results = await Promise.all([
      accept(token, 'Racer One'),
      accept(token, 'Racer Two'),
      accept(token, 'Racer Three'),
    ]);
    const statuses = results.map((r) => r.res.status).sort();
    expect(statuses).toEqual([201, 400, 400]);
    expect(await db.user.count({ where: { emailNorm: 'race@agency.test' } })).toBe(1);
  });

  it('rejects expired, revoked, unknown and malformed tokens with one generic error', async () => {
    const expired = await invite('old@agency.test');
    await db.invitation.updateMany({
      where: { emailNorm: 'old@agency.test' },
      data: {
        createdAt: new Date(Date.now() - 9 * 86_400_000),
        expiresAt: new Date(Date.now() - 1000),
      },
    });
    const revoked = await invite('gone@agency.test');
    const inv = await db.invitation.findFirstOrThrow({ where: { emailNorm: 'gone@agency.test' } });
    await revoked.post(`/api/v1/invitations/${inv.id}/revoke`).expect(200);

    const bodies = [];
    for (const token of [expired.token, revoked.token, 'A'.repeat(43)]) {
      const { res } = await accept(token);
      expect(res.status).toBe(400);
      bodies.push({ ...res.body.error, requestId: undefined });
    }
    expect(new Set(bodies.map((b) => JSON.stringify(b))).size).toBe(1);
    expect((await accept('../../etc')).res.status).toBe(422);
    expect(
      await db.user.count({
        where: { emailNorm: { in: ['old@agency.test', 'gone@agency.test'] } },
      }),
    ).toBe(0);
  });

  it('applies the password policy with the invitee’s own details', async () => {
    const { token } = await invite('maryam.salah@agency.test');
    const weak = await accept(token, 'Maryam Salah', 'Password1234!');
    expect(weak.res.status).toBe(422);
    expect(weak.res.body.error.fieldErrors.password[0]).toMatch(/too common/);
    const personal = await accept(token, 'Maryam Salah', 'maryam-loves-blue-orchids');
    expect(personal.res.status).toBe(422);
    expect(personal.res.body.error.fieldErrors.password[0]).toMatch(/name or email/);
    // The invitation is still usable after a rejected attempt.
    expect((await accept(token, 'Maryam Salah')).res.status).toBe(201);
  });

  it('cannot change the email or role while accepting', async () => {
    const { token } = await invite('fixed@agency.test', 'MEMBER');
    const agent = request.agent(t.app);
    const pre = await getPreCsrf(agent);
    const res = await agent
      .post('/api/v1/invitations/accept')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ token, name: 'N', password: STRONG, email: 'other@evil.test', role: 'OWNER' });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual(['email', 'role']);
  });

  it('requires CSRF and an allowed origin', async () => {
    const { token } = await invite('csrf@agency.test');
    const noCsrf = await request(t.app)
      .post('/api/v1/invitations/accept')
      .set('Origin', ORIGIN)
      .send({ token, name: 'N', password: STRONG });
    expect(noCsrf.status).toBe(403);
    const agent = request.agent(t.app);
    const pre = await getPreCsrf(agent);
    const foreign = await agent
      .post('/api/v1/invitations/accept')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', pre)
      .send({ token, name: 'N', password: STRONG });
    expect(foreign.status).toBe(403);
    expect(await db.user.count({ where: { emailNorm: 'csrf@agency.test' } })).toBe(0);
  });
});

describe('revoke and resend', () => {
  it('resend issues a new link and kills the old one', async () => {
    const first = await invite('again@agency.test', 'FINANCE');
    const inv = await db.invitation.findFirstOrThrow();
    const res = await first.post(`/api/v1/invitations/${inv.id}/resend`);
    expect(res.status).toBe(201);
    expect(res.body.data.invitation.role).toBe('FINANCE');
    const newToken = new URL(res.body.data.acceptUrl).hash.replace('#token=', '');
    expect(newToken).not.toBe(first.token);
    expect((await accept(first.token)).res.status).toBe(400);
    expect((await accept(newToken)).res.status).toBe(201);
  });

  it('accepted invitations cannot be revoked or resent', async () => {
    const first = await invite('done@agency.test');
    await accept(first.token);
    const inv = await db.invitation.findFirstOrThrow();
    expect((await first.post(`/api/v1/invitations/${inv.id}/revoke`)).status).toBe(409);
    expect((await first.post(`/api/v1/invitations/${inv.id}/resend`)).status).toBe(409);
  });

  it('admins cannot revoke an owner invitation; other agencies’ invitations are 404', async () => {
    await invite('owner2@agency.test', 'OWNER', 'owner');
    const inv = await db.invitation.findFirstOrThrow();
    const admin = await asUser('admin');
    expect((await admin.post(`/api/v1/invitations/${inv.id}/revoke`)).status).toBe(403);
    expect(
      (await admin.post('/api/v1/invitations/018f0000-0000-7000-8000-000000000000/revoke')).status,
    ).toBe(404);
  });
});
