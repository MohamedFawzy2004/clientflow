import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { hashPassword } from '../src/lib/password.js';
import {
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
  const send = (method: 'post' | 'patch', path: string, body: object = {}) =>
    agent[method](path).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body);
  return {
    agent,
    post: (p: string, b?: object) => send('post', p, b),
    patch: (p: string, b: object) => send('patch', p, b),
  };
}

const versionOf = async (key: string) =>
  (await db.user.findUniqueOrThrow({ where: { id: seeded.users[key]!.id } })).version;

describe('team list', () => {
  it('owners and admins see members with status and active session counts', async () => {
    await login(t.app, seeded.users.salesA!.email);
    const admin = await asUser('admin');
    const res = await admin.agent.get('/api/v1/users').expect(200);
    expect(res.body.data).toHaveLength(8);
    const sales = res.body.data.find(
      (m: { email: string }) => m.email === seeded.users.salesA!.email,
    );
    expect(sales).toMatchObject({
      role: 'SALES',
      status: 'ACTIVE',
      activeSessions: 1,
      isSelf: false,
    });
    expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|password_hash|argon2/);
  });

  it.each(['manager', 'salesA', 'pm', 'member', 'finance'])(
    '%s cannot list the team',
    async (key) => {
      const u = await asUser(key);
      await u.agent.get('/api/v1/users').expect(403);
    },
  );
});

describe('US-19 / FR-I08 deactivate and reactivate', () => {
  it('deactivation blocks the member immediately, everywhere', async () => {
    const sales = await login(t.app, seeded.users.salesA!.email);
    await sales.agent.get('/api/v1/contacts').expect(200);
    const admin = await asUser('admin');

    const res = await admin.post(`/api/v1/users/${seeded.users.salesA!.id}/deactivate`, {
      version: await versionOf('salesA'),
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'DEACTIVATED', activeSessions: 0 });

    await sales.agent.get('/api/v1/contacts').expect(401);
    await expect(login(t.app, seeded.users.salesA!.email)).rejects.toThrow(/401/);
    expect(await db.auditEvent.count({ where: { action: 'team.deactivate' } })).toBe(1);

    await admin
      .post(`/api/v1/users/${seeded.users.salesA!.id}/reactivate`, {
        version: await versionOf('salesA'),
      })
      .expect(200);
    await login(t.app, seeded.users.salesA!.email);
  });

  it('deactivation also voids unused password reset links', async () => {
    await db.passwordResetToken.create({
      data: {
        userId: seeded.users.salesA!.id,
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    const admin = await asUser('admin');
    await admin
      .post(`/api/v1/users/${seeded.users.salesA!.id}/deactivate`, {
        version: await versionOf('salesA'),
      })
      .expect(200);
    const token = await db.passwordResetToken.findFirstOrThrow();
    expect(token.usedAt).not.toBeNull();
  });

  it('nobody can deactivate themselves', async () => {
    const admin = await asUser('admin');
    const res = await admin.post(`/api/v1/users/${seeded.users.admin!.id}/deactivate`, {
      version: await versionOf('admin'),
    });
    expect(res.status).toBe(403);
  });
});

describe('sole-owner and owner protection', () => {
  it('a demoted owner loses owner powers at once and cannot remove the remaining owner', async () => {
    // Self-changes are blocked, so the actor is always another active owner. The last-owner
    // lock (409) is defense in depth for races, covered by the concurrent test below.
    const secondOwner = await db.user.create({
      data: {
        agencyId: seeded.agencyId,
        emailNorm: 'owner2@agency.test',
        name: 'Second Owner',
        role: 'OWNER',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const { agent, csrf } = await login(t.app, 'owner2@agency.test');
    const patch = (p: string, b: object) =>
      agent.patch(p).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(b);

    // Demoting the first owner is fine: owner2 remains.
    await patch(`/api/v1/users/${seeded.users.owner!.id}`, {
      role: 'ADMIN',
      version: await versionOf('owner'),
    }).expect(200);

    // Now owner2 is the only owner. The first owner (now admin) cannot remove them.
    const firstOwnerNowAdmin = await login(t.app, seeded.users.owner!.email);
    const res = await firstOwnerNowAdmin.agent
      .post(`/api/v1/users/${secondOwner.id}/deactivate`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', firstOwnerNowAdmin.csrf)
      .send({ version: 1 });
    expect(res.status).toBe(403);
    expect(await db.user.count({ where: { role: 'OWNER', active: true } })).toBe(1);
  });

  it('two owners demoting each other at the same time cannot leave zero owners', async () => {
    const other = await db.user.create({
      data: {
        agencyId: seeded.agencyId,
        emailNorm: 'owner2@agency.test',
        name: 'Second Owner',
        role: 'OWNER',
        passwordHash: await hashPassword(PASSWORD),
      },
    });
    const a = await login(t.app, seeded.users.owner!.email);
    const b = await login(t.app, 'owner2@agency.test');
    const results = await Promise.all([
      a.agent
        .patch(`/api/v1/users/${other.id}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', a.csrf)
        .send({ role: 'ADMIN', version: 1 }),
      b.agent
        .patch(`/api/v1/users/${seeded.users.owner!.id}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', b.csrf)
        .send({ role: 'ADMIN', version: 1 }),
    ]);
    const statuses = results.map((r) => r.status).sort();
    expect(statuses[0]).toBe(200);
    expect([401, 403, 409]).toContain(statuses[1]);
    expect(await db.user.count({ where: { role: 'OWNER', active: true } })).toBe(1);
  });

  it('admins cannot modify owners or grant the owner role', async () => {
    const admin = await asUser('admin');
    const ownerId = seeded.users.owner!.id;
    expect((await admin.post(`/api/v1/users/${ownerId}/deactivate`, { version: 1 })).status).toBe(
      403,
    );
    expect((await admin.post(`/api/v1/users/${ownerId}/revoke-sessions`)).status).toBe(403);
    expect(
      (await admin.patch(`/api/v1/users/${ownerId}`, { role: 'SALES', version: 1 })).status,
    ).toBe(403);
    const promote = await admin.patch(`/api/v1/users/${seeded.users.salesA!.id}`, {
      role: 'OWNER',
      version: 1,
    });
    expect(promote.status).toBe(403);
    expect((await db.user.findUniqueOrThrow({ where: { id: seeded.users.salesA!.id } })).role).toBe(
      'SALES',
    );
  });
});

describe('FR-I03 role change rotates sessions', () => {
  it('changing a role revokes the member’s sessions and records from/to', async () => {
    const sales = await login(t.app, seeded.users.salesA!.email);
    const owner = await asUser('owner');
    const res = await owner.patch(`/api/v1/users/${seeded.users.salesA!.id}`, {
      role: 'SALES_MANAGER',
      version: 1,
    });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ role: 'SALES_MANAGER', version: 2, activeSessions: 0 });
    await sales.agent.get('/api/v1/auth/me').expect(401);
    const audit = await db.auditEvent.findFirstOrThrow({ where: { action: 'team.role_change' } });
    expect(audit.metadataRedacted).toMatchObject({ from: 'SALES', to: 'SALES_MANAGER' });
  });

  it('stale versions get 409 and change nothing', async () => {
    const owner = await asUser('owner');
    await owner
      .patch(`/api/v1/users/${seeded.users.salesA!.id}`, { role: 'PM', version: 1 })
      .expect(200);
    const stale = await owner.patch(`/api/v1/users/${seeded.users.salesA!.id}`, {
      role: 'FINANCE',
      version: 1,
    });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT_STALE_VERSION');
    expect((await db.user.findUniqueOrThrow({ where: { id: seeded.users.salesA!.id } })).role).toBe(
      'PM',
    );
  });

  it('T-ACL-03: only role and version are accepted', async () => {
    const owner = await asUser('owner');
    const res = await owner.patch(`/api/v1/users/${seeded.users.salesA!.id}`, {
      role: 'PM',
      version: 1,
      name: 'Hacked',
      email: 'x@evil.test',
      active: false,
      agencyId: '00000000-0000-0000-0000-000000000000',
    });
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      'active',
      'agencyId',
      'email',
      'name',
    ]);
    expect((await db.user.findUniqueOrThrow({ where: { id: seeded.users.salesA!.id } })).role).toBe(
      'SALES',
    );
  });

  it('cannot grant CLIENT through the team API', async () => {
    const owner = await asUser('owner');
    expect(
      (
        await owner.patch(`/api/v1/users/${seeded.users.salesA!.id}`, {
          role: 'CLIENT',
          version: 1,
        })
      ).status,
    ).toBe(422);
  });

  it('revoke-sessions signs a member out without changing the account', async () => {
    const sales = await login(t.app, seeded.users.salesA!.email);
    const admin = await asUser('admin');
    const res = await admin.post(`/api/v1/users/${seeded.users.salesA!.id}/revoke-sessions`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ status: 'ACTIVE', activeSessions: 0 });
    await sales.agent.get('/api/v1/auth/me').expect(401);
    await login(t.app, seeded.users.salesA!.email);
  });

  it('members of another agency are 404', async () => {
    const other = await db.agency.create({ data: { name: 'Other', slug: 'other' } });
    const stranger = await db.user.create({
      data: {
        agencyId: other.id,
        emailNorm: 's@other.test',
        name: 'S',
        role: 'SALES',
        passwordHash: 'x',
      },
    });
    const owner = await asUser('owner');
    expect(
      (await owner.post(`/api/v1/users/${stranger.id}/deactivate`, { version: 1 })).status,
    ).toBe(404);
    expect(
      (await owner.patch(`/api/v1/users/${stranger.id}`, { role: 'PM', version: 1 })).status,
    ).toBe(404);
    expect((await owner.post('/api/v1/users/not-a-uuid/revoke-sessions')).status).toBe(404);
    expect((await db.user.findUniqueOrThrow({ where: { id: stranger.id } })).active).toBe(true);
  });
});
