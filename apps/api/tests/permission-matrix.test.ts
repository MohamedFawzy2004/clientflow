// Role × endpoint negative test matrix (SEC-01, SEC-02, FR-I11). The expected table is written
// by hand from spec §1.1 on purpose: it must not be derived from the implementation's matrix.
// Every new endpoint must be added here.
import { afterAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import type { Role } from '@clientflow/contracts';
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
} from './helpers.js';

const db = testDb();
afterAll(() => db.$disconnect());

/** One fresh record per mutating endpoint, so one call's version bump cannot affect another. */
interface Fixtures {
  userPatch: string;
  userDeactivate: string;
  userRevoke: string;
  contactRead: string;
  contactPatch: string;
  contactConvert: string;
  contactArchive: string;
  contactReassign: string;
  contactActivity: string;
  dealPatch: string;
  dealMove: string;
  dealLose: string;
  dealWin: string;
  dealReopen: string;
  dealReassign: string;
  stageId: string;
  salesB: string;
}

interface Endpoint {
  name: string;
  method: 'get' | 'post' | 'patch';
  path: (f: Fixtures) => string;
  body?: (role: Role, f: Fixtures) => object;
  allowed: Role[];
}

const STAFF: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER', 'FINANCE'];
const SALES_SIDE: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'];
const SALES_MANAGERS: Role[] = ['OWNER', 'ADMIN', 'SALES_MANAGER'];
const TEAM_ADMINS: Role[] = ['OWNER', 'ADMIN'];

const ENDPOINTS: Endpoint[] = [
  { name: 'GET /auth/me', method: 'get', path: () => '/api/v1/auth/me', allowed: STAFF },
  // Contacts
  { name: 'GET /contacts', method: 'get', path: () => '/api/v1/contacts', allowed: SALES_SIDE },
  {
    name: 'GET /contacts/:id',
    method: 'get',
    path: (f) => `/api/v1/contacts/${f.contactRead}`,
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts',
    method: 'post',
    path: () => '/api/v1/contacts',
    body: (r) => ({ fullName: `Lead by ${r}` }),
    allowed: SALES_SIDE,
  },
  {
    name: 'PATCH /contacts/:id',
    method: 'patch',
    path: (f) => `/api/v1/contacts/${f.contactPatch}`,
    body: () => ({ version: 1, companyName: 'Changed' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/convert',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactConvert}/convert`,
    body: () => ({ version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/archive',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactArchive}/archive`,
    body: () => ({ version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/activities',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactActivity}/activities`,
    body: () => ({ kind: 'NOTE', body: 'Matrix note' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /contacts/:id/reassign',
    method: 'post',
    path: (f) => `/api/v1/contacts/${f.contactReassign}/reassign`,
    body: (_r, f) => ({ ownerId: f.salesB, version: 1 }),
    allowed: SALES_MANAGERS,
  },
  // Deals and pipeline
  {
    name: 'GET /pipelines/default',
    method: 'get',
    path: () => '/api/v1/pipelines/default',
    allowed: SALES_SIDE,
  },
  { name: 'GET /deals', method: 'get', path: () => '/api/v1/deals', allowed: SALES_SIDE },
  {
    name: 'GET /deals/board',
    method: 'get',
    path: () => '/api/v1/deals/board',
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals',
    method: 'post',
    path: () => '/api/v1/deals',
    body: (_r, f) => ({
      contactId: f.contactRead,
      title: 'Matrix deal',
      amount: '100',
      currency: 'EGP',
    }),
    allowed: SALES_SIDE,
  },
  {
    name: 'PATCH /deals/:id',
    method: 'patch',
    path: (f) => `/api/v1/deals/${f.dealPatch}`,
    body: () => ({ version: 1, title: 'Changed' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals/:id/move',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealMove}/move`,
    body: (_r, f) => ({ stageId: f.stageId, version: 1 }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals/:id/close (LOST)',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealLose}/close`,
    body: () => ({ outcome: 'LOST', version: 1, reason: 'Matrix test' }),
    allowed: SALES_SIDE,
  },
  {
    name: 'POST /deals/:id/close (WON override)',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealWin}/close`,
    body: () => ({ outcome: 'WON', version: 1, overrideReason: 'Matrix test' }),
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /deals/:id/reopen',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealReopen}/reopen`,
    body: () => ({ version: 1, reason: 'Matrix test' }),
    allowed: SALES_MANAGERS,
  },
  {
    name: 'POST /deals/:id/reassign',
    method: 'post',
    path: (f) => `/api/v1/deals/${f.dealReassign}/reassign`,
    body: (_r, f) => ({ ownerId: f.salesB, version: 1 }),
    allowed: SALES_MANAGERS,
  },
  { name: 'GET /follow-ups', method: 'get', path: () => '/api/v1/follow-ups', allowed: SALES_SIDE },
  {
    name: 'GET /sales/assignable-owners',
    method: 'get',
    path: () => '/api/v1/sales/assignable-owners',
    allowed: SALES_MANAGERS,
  },
  // Team
  { name: 'GET /users', method: 'get', path: () => '/api/v1/users', allowed: TEAM_ADMINS },
  {
    name: 'PATCH /users/:id',
    method: 'patch',
    path: (f) => `/api/v1/users/${f.userPatch}`,
    body: () => ({ role: 'PM', version: 1 }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /users/:id/deactivate',
    method: 'post',
    path: (f) => `/api/v1/users/${f.userDeactivate}/deactivate`,
    body: () => ({ version: 1 }),
    allowed: TEAM_ADMINS,
  },
  {
    name: 'POST /users/:id/revoke-sessions',
    method: 'post',
    path: (f) => `/api/v1/users/${f.userRevoke}/revoke-sessions`,
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

/** Sales records are owned by salesA, so SALES (salesA) is in scope and managers see them too. */
async function freshFixtures(seeded: SeededAgency): Promise<Fixtures> {
  const { agencyId } = seeded;
  const ownerId = seeded.users.salesA!.id;
  const passwordHash = await hashPassword(PASSWORD);
  const user = (n: string) =>
    db.user.create({
      data: { agencyId, emailNorm: `${n}@targets.test`, name: n, role: 'MEMBER', passwordHash },
    });
  const contact = (n: string) => db.contact.create({ data: { agencyId, ownerId, fullName: n } });
  const pipeline = await db.pipeline.findFirstOrThrow({
    where: { agencyId },
    include: { stages: { orderBy: { position: 'asc' } } },
  });
  const base = {
    agencyId,
    ownerId,
    pipelineId: pipeline.id,
    stageId: pipeline.stages[0]!.id,
    amountMinor: 1000n,
    currency: 'EGP',
  };
  const dealContact = await contact('Deal holder');
  const deal = (title: string, extra: object = {}) =>
    db.deal.create({ data: { ...base, contactId: dealContact.id, title, ...extra } });

  const [userPatch, userDeactivate, userRevoke] = await Promise.all([
    user('patch-target'),
    user('deactivate-target'),
    user('revoke-target'),
  ]);
  const [
    contactRead,
    contactPatch,
    contactConvert,
    contactArchive,
    contactReassign,
    contactActivity,
  ] = await Promise.all(
    ['read', 'patch', 'convert', 'archive', 'reassign', 'activity'].map((n) =>
      contact(`Contact ${n}`),
    ),
  );
  const [dealPatch, dealMove, dealLose, dealWin, dealReassign] = await Promise.all(
    ['patch', 'move', 'lose', 'win', 'reassign'].map((n) => deal(`Deal ${n}`)),
  );
  const dealReopen = await deal('Deal reopen', {
    status: 'LOST',
    closedAt: new Date(),
    closedById: ownerId,
    lostReason: 'Fixture',
  });
  return {
    userPatch: userPatch.id,
    userDeactivate: userDeactivate.id,
    userRevoke: userRevoke.id,
    contactRead: contactRead!.id,
    contactPatch: contactPatch!.id,
    contactConvert: contactConvert!.id,
    contactArchive: contactArchive!.id,
    contactReassign: contactReassign!.id,
    contactActivity: contactActivity!.id,
    dealPatch: dealPatch!.id,
    dealMove: dealMove!.id,
    dealLose: dealLose!.id,
    dealWin: dealWin!.id,
    dealReopen: dealReopen.id,
    dealReassign: dealReassign!.id,
    stageId: pipeline.stages[2]!.id,
    salesB: seeded.users.salesB!.id,
  };
}

describe('role × endpoint matrix', () => {
  it.each(STAFF)('%s gets exactly the access spec §1.1 grants', async (role) => {
    await resetDb();
    const seeded = await seedAgency();
    const f = await freshFixtures(seeded);
    const { app } = makeApp();
    const { agent, csrf } = await login(app, seeded.users[KEY_FOR_ROLE[role]!]!.email);

    const before = {
      contacts: await db.contact.findMany({ select: { id: true, version: true, ownerId: true } }),
      deals: await db.deal.findMany({
        select: { id: true, version: true, status: true, ownerId: true },
      }),
    };

    const outcomes: Record<string, number> = {};
    for (const ep of ENDPOINTS) {
      let req = agent[ep.method](ep.path(f)).set('Origin', ORIGIN).set('X-CSRF-Token', csrf);
      if (ep.body) req = req.send(ep.body(role, f));
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
    if (!SALES_SIDE.includes(role)) {
      expect(
        await db.contact.findMany({ select: { id: true, version: true, ownerId: true } }),
      ).toEqual(before.contacts);
      expect(
        await db.deal.findMany({
          select: { id: true, version: true, status: true, ownerId: true },
        }),
      ).toEqual(before.deals);
      expect(await db.activity.count({ where: { body: 'Matrix note' } })).toBe(0);
    }
    if (role === 'SALES') {
      // SALES may edit, but never reassign, win by override or reopen.
      const reassigned = await db.contact.findUniqueOrThrow({ where: { id: f.contactReassign } });
      expect(reassigned.ownerId).toBe(seeded.users.salesA!.id);
      expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealWin } })).status).toBe('OPEN');
      expect((await db.deal.findUniqueOrThrow({ where: { id: f.dealReopen } })).status).toBe(
        'LOST',
      );
    }
    if (!TEAM_ADMINS.includes(role)) {
      expect(await db.invitation.count()).toBe(0);
      const t = await db.user.findMany({
        where: { id: { in: [f.userPatch, f.userDeactivate, f.userRevoke] } },
      });
      expect(t.every((u) => u.role === 'MEMBER' && u.active && u.version === 1)).toBe(true);
    }
  });

  it('signed-out requests get 401 on every protected endpoint', async () => {
    await resetDb();
    const seeded = await seedAgency();
    const f = await freshFixtures(seeded);
    const { app } = makeApp();
    for (const ep of ENDPOINTS) {
      let req = request(app)[ep.method](ep.path(f)).set('Origin', ORIGIN);
      if (ep.body) req = req.send(ep.body('OWNER', f));
      const res = await req;
      expect({ ep: ep.name, status: res.status }).toEqual({ ep: ep.name, status: 401 });
    }
  });
});
