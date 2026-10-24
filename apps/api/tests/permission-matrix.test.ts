// Role × endpoint negative test matrix (SEC-01, SEC-02, FR-I11). The expected table is written
// by hand from spec §1.1 on purpose: it must not be derived from the implementation's matrix.
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Role } from '@clientflow/contracts';
import { hashPassword } from '../src/lib/password.js';
import { login, makeApp, ORIGIN, PASSWORD, resetDb, seedAgency, testDb } from './helpers.js';

const db = testDb();
afterAll(() => db.$disconnect());

type Target = { patchId: string; deactivateId: string; revokeId: string };
interface Endpoint {
  name: string;
  method: 'get' | 'post' | 'patch';
  path: (t: Target) => string;
  body?: (role: Role) => object;
  allowed: Role[];
}

const STAFF: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER', 'FINANCE'];
const SALES_SIDE: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'];
const TEAM_ADMINS: Role[] = ['OWNER', 'ADMIN'];

const ENDPOINTS: Endpoint[] = [
  { name: 'GET /auth/me', method: 'get', path: () => '/api/v1/auth/me', allowed: STAFF },
  { name: 'GET /contacts', method: 'get', path: () => '/api/v1/contacts', allowed: SALES_SIDE },
  {
    name: 'POST /contacts',
    method: 'post',
    path: () => '/api/v1/contacts',
    body: (r) => ({ fullName: `Lead by ${r}` }),
    allowed: SALES_SIDE,
  },
  { name: 'GET /users', method: 'get', path: () => '/api/v1/users', allowed: TEAM_ADMINS },
  {
    name: 'PATCH /users/:id',
    method: 'patch',
    path: (t) => `/api/v1/users/${t.patchId}`,
    body: () => ({ role: 'PM', version: 1 }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /users/:id/deactivate',
    method: 'post',
    path: (t) => `/api/v1/users/${t.deactivateId}/deactivate`,
    body: () => ({ version: 1 }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /users/:id/revoke-sessions',
    method: 'post',
    path: (t) => `/api/v1/users/${t.revokeId}/revoke-sessions`,
    allowed: TEAM_ADMINS,
  },
  {
    name: 'GET /invitations',
    method: 'get',
    path: () => '/api/v1/invitations',
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /invitations',
    method: 'post',
    path: () => '/api/v1/invitations',
    body: (r) => ({ email: `invitee-${r.toLowerCase()}@agency.test`, role: 'SALES' }),
    allowed: TEAM_ADMINS,
  },
];

const KEY_FOR_ROLE: Record<string, string> = {
  OWNER: 'owner',
  ADMIN: 'admin',
  SALES_MANAGER: 'manager',
  SALES: 'salesA',
  PM: 'pm',
  MEMBER: 'member',
  FINANCE: 'finance',
};

async function freshTargets(agencyId: string): Promise<Target> {
  const passwordHash = await hashPassword(PASSWORD);
  const make = (n: string) =>
    db.user.create({
      data: { agencyId, emailNorm: `${n}@targets.test`, name: n, role: 'MEMBER', passwordHash },
    });
  const [p, d, r] = await Promise.all([
    make('patch-target'),
    make('deactivate-target'),
    make('revoke-target'),
  ]);
  return { patchId: p.id, deactivateId: d.id, revokeId: r.id };
}

describe('role × endpoint matrix', () => {
  it.each(STAFF)('%s gets exactly the access spec §1.1 grants', async (role) => {
    await resetDb();
    const seeded = await seedAgency();
    const targets = await freshTargets(seeded.agencyId);
    const { app } = makeApp();
    const { agent, csrf } = await login(app, seeded.users[KEY_FOR_ROLE[role]!]!.email);

    const outcomes: Record<string, number> = {};
    for (const ep of ENDPOINTS) {
      let req = agent[ep.method](ep.path(targets)).set('Origin', ORIGIN).set('X-CSRF-Token', csrf);
      if (ep.body) req = req.send(ep.body(role));
      const res = await req;
      outcomes[ep.name] = res.status;
    }

    const expected = Object.fromEntries(
      ENDPOINTS.map((ep) => [ep.name, ep.allowed.includes(role) ? 'allowed' : 'forbidden']),
    );
    const actual = Object.fromEntries(
      Object.entries(outcomes).map(([name, status]) => [
        name,
        status === 403
          ? 'forbidden'
          : status >= 200 && status < 300
            ? 'allowed'
            : `unexpected ${status}`,
      ]),
    );
    expect(actual).toEqual(expected);

    // Denied mutations changed nothing.
    if (!SALES_SIDE.includes(role)) expect(await db.contact.count()).toBe(0);
    if (!TEAM_ADMINS.includes(role)) {
      expect(await db.invitation.count()).toBe(0);
      const t = await db.user.findMany({ where: { id: { in: Object.values(targets) } } });
      expect(t.every((u) => u.role === 'MEMBER' && u.active && u.version === 1)).toBe(true);
    }
  });

  it('signed-out requests get 401 on every protected endpoint', async () => {
    await resetDb();
    const seeded = await seedAgency();
    const targets = await freshTargets(seeded.agencyId);
    const { app } = makeApp();
    for (const ep of ENDPOINTS) {
      let req = request(app)[ep.method](ep.path(targets)).set('Origin', ORIGIN);
      if (ep.body) req = req.send(ep.body('OWNER'));
      const res = await req;
      expect({ ep: ep.name, status: res.status }).toEqual({ ep: ep.name, status: 401 });
    }
  });
});
