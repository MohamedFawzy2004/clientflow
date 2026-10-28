import request from 'supertest';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
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
import { makeClientOrg, makeDeal, makeProposal } from './proposal-fixtures.js';

const db = testDb();
let seeded: SeededAgency;
let t: TestApp;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
});
afterAll(() => db.$disconnect());

type Body = Record<string, unknown>;

async function as(email: string) {
  const { agent, csrf } = await login(t.app, email);
  const send = (method: 'post' | 'put' | 'patch', path: string, body: object = {}) =>
    agent[method](path).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(body);
  return {
    agent,
    get: (p: string) => agent.get(p),
    post: (p: string, b?: object) => send('post', p, b),
    put: (p: string, b: object) => send('put', p, b),
    patch: (p: string, b: object) => send('patch', p, b),
  };
}
const user = (key: string) => as(seeded.users[key]!.email);

const draftBody = (version: number, over: Body = {}) => ({
  version,
  title: 'Delivery tracking app',
  summary: 'A mobile app for drivers and a dashboard for dispatch.',
  inclusions: 'iOS and Android apps\nDispatch dashboard',
  exclusions: 'Hosting fees',
  assumptions: null,
  milestones: 'Design · Build · Launch',
  paymentTerms: '50% upfront, 50% on launch',
  terms: 'Standard terms.',
  internalNotes: 'Margin is thin: keep the discount at 10% max.',
  expiresOn: '2099-06-30',
  discountPercent: '10',
  taxRatePercent: '14',
  taxLabel: 'VAT',
  items: [
    { name: 'Design sprint', unit: 'day', quantity: '3', unitPrice: '1,500.50' },
    { name: 'Build', unit: 'hour', quantity: '0.5', unitPrice: '0.01' },
  ],
  ...over,
});

/** A salesperson's open deal with a contact, plus a proposal created through the API. */
async function salesProposal() {
  const sales = await user('salesA');
  const contact = (await sales.post('/api/v1/contacts', { fullName: 'Karim Nasser' })).body.data;
  const deal = (
    await sales.post('/api/v1/deals', {
      contactId: contact.id,
      title: 'Delivery app',
      amount: '50000',
      currency: 'EGP',
    })
  ).body.data;
  const res = await sales.post('/api/v1/proposals', { dealId: deal.id });
  expect(res.status).toBe(201);
  return { sales, contact, deal, proposal: res.body.data };
}

/** Takes the proposal through draft → submit → approve; returns the approved detail. */
async function approvedProposal() {
  const ctx = await salesProposal();
  const id = ctx.proposal.id;
  let detail = (await ctx.sales.put(`/api/v1/proposals/${id}/draft`, draftBody(1))).body.data;
  detail = (
    await ctx.sales.post(`/api/v1/proposals/${id}/submit`, { version: detail.current.version })
  ).body.data;
  const manager = await user('manager');
  const approved = await manager.post(`/api/v1/proposals/${id}/review`, {
    version: detail.current.version,
    decision: 'APPROVE',
  });
  expect(approved.status).toBe(200);
  return { ...ctx, manager, detail: approved.body.data };
}

/** Portal set up through the API: organization, invitation, acceptance by the client. */
async function setUpPortal(contactId: string, email = 'nadia@nasser.test') {
  const manager = await user('manager');
  const org = await manager.post(`/api/v1/contacts/${contactId}/client-org`, {
    name: 'Nasser Pharmacies',
  });
  expect(org.status).toBe(201);
  const invite = await manager.post(`/api/v1/client-orgs/${org.body.data.id}/invitations`, {
    email,
  });
  expect(invite.status).toBe(201);
  const token = t.mailer.lastToken('portal_invitation')!;
  const agent = request.agent(t.app);
  const pre = await getPreCsrf(agent);
  const accepted = await agent
    .post('/api/v1/invitations/accept')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', pre)
    .send({ token, name: 'Nadia Nasser', password: PASSWORD });
  expect(accepted.status).toBe(201);
  expect(accepted.body.data.user.role).toBe('CLIENT');
  return { orgId: org.body.data.id as string, client: await as(email) };
}

async function sentProposal() {
  const ctx = await approvedProposal();
  const portal = await setUpPortal(ctx.contact.id);
  const sent = await ctx.sales.post(`/api/v1/proposals/${ctx.proposal.id}/send`, {
    version: ctx.detail.current.version,
  });
  expect(sent.status).toBe(200);
  return { ...ctx, ...portal, detail: sent.body.data };
}

describe('FR-Q02 / FR-Q03 drafts and exact totals', () => {
  it('creates P-0001 from an open deal with VAT 14%, deal currency and a 30-day expiry', async () => {
    const { proposal } = await salesProposal();
    expect(proposal.reference).toBe('P-0001');
    expect(proposal.current).toMatchObject({
      versionNo: 1,
      status: 'DRAFT',
      currency: 'EGP',
      taxRateBp: 1400,
      taxLabel: 'VAT',
      items: [],
    });
    expect(proposal.current.expiresOn > new Date().toISOString().slice(0, 10)).toBe(true);
  });

  it('computes totals on the server, half up at each explained step', async () => {
    const { sales, proposal } = await salesProposal();
    const res = await sales.put(`/api/v1/proposals/${proposal.id}/draft`, draftBody(1));
    expect(res.status).toBe(200);
    const v = res.body.data.current;
    // 3 × 1,500.50 = 4,501.50; 0.5 × 0.01 = 0.005 → 0.01; subtotal 4,501.51
    expect(v.items.map((i: Body) => i.lineTotalMinor)).toEqual(['450150', '1']);
    expect(v.subtotalMinor).toBe('450151');
    // 10% discount = 450.151 → 450.15; taxable 4,051.36; VAT 14% = 567.1904 → 567.19; total 4,618.55
    expect(v.discountMinor).toBe('45015');
    expect(v.taxMinor).toBe('56719');
    expect(v.totalMinor).toBe('461855');
    expect(v.internalNotes).toContain('Margin is thin');
  });

  it('refuses client-supplied totals and owner fields (strict schema)', async () => {
    const { sales, proposal } = await salesProposal();
    const res = await sales.put(
      `/api/v1/proposals/${proposal.id}/draft`,
      draftBody(1, { totalMinor: '1', currency: 'USD', status: 'SENT' }),
    );
    expect(res.status).toBe(422);
    const v = await db.proposalVersion.findFirstOrThrow({ where: { proposalId: proposal.id } });
    expect(v.totalMinor).toBe(0n);
    expect(v.status).toBe('DRAFT');
  });

  it('rejects bad quantities, prices and rates with field errors', async () => {
    const { sales, proposal } = await salesProposal();
    const res = await sales.put(
      `/api/v1/proposals/${proposal.id}/draft`,
      draftBody(1, {
        taxRatePercent: '101',
        items: [{ name: 'x', unit: 'h', quantity: '0', unitPrice: '1.234' }],
      }),
    );
    expect(res.status).toBe(422);
    expect(Object.keys(res.body.error.fieldErrors).sort()).toEqual([
      'items.0.quantity',
      'items.0.unitPrice',
      'taxRatePercent',
    ]);
  });

  it('stale draft edits get 409', async () => {
    const { sales, proposal } = await salesProposal();
    await sales.put(`/api/v1/proposals/${proposal.id}/draft`, draftBody(1)).expect(200);
    const stale = await sales.put(`/api/v1/proposals/${proposal.id}/draft`, draftBody(1));
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT_STALE_VERSION');
  });

  it('gives concurrent creates distinct reference numbers', async () => {
    const sales = await user('salesA');
    const deal = await makeDeal(db, seeded.agencyId, seeded.users.salesA!.id);
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map(() => sales.post('/api/v1/proposals', { dealId: deal.id })),
    );
    expect(results.map((r) => r.status)).toEqual([201, 201, 201, 201, 201]);
    const refs = results.map((r) => r.body.data.reference).sort();
    expect(refs).toEqual(['P-0001', 'P-0002', 'P-0003', 'P-0004', 'P-0005']);
  });

  it('hides proposals on other salespeople’s deals (404) and refuses their deals (422)', async () => {
    const { proposal, deal } = await salesProposal();
    const b = await user('salesB');
    expect((await b.get(`/api/v1/proposals/${proposal.id}`)).status).toBe(404);
    expect((await b.get('/api/v1/proposals')).body.data).toEqual([]);
    const create = await b.post('/api/v1/proposals', { dealId: deal.id });
    expect(create.status).toBe(422);
    expect(create.body.error.fieldErrors.dealId).toBeDefined();
  });
});

describe('FR-Q05 / US-08 internal review before sending', () => {
  it('needs at least one line to submit', async () => {
    const { sales, proposal } = await salesProposal();
    const res = await sales.post(`/api/v1/proposals/${proposal.id}/submit`, { version: 1 });
    expect(res.status).toBe(422);
    expect(res.body.error.fieldErrors.items).toBeDefined();
  });

  it('salespeople cannot approve; a draft cannot be sent without approval', async () => {
    const { sales, proposal } = await salesProposal();
    let d = (await sales.put(`/api/v1/proposals/${proposal.id}/draft`, draftBody(1))).body.data;
    expect(
      (await sales.post(`/api/v1/proposals/${proposal.id}/send`, { version: d.current.version }))
        .status,
    ).toBe(409);
    d = (
      await sales.post(`/api/v1/proposals/${proposal.id}/submit`, { version: d.current.version })
    ).body.data;
    expect(d.current.status).toBe('IN_REVIEW');
    expect(d.current.contentHash).toMatch(/^[0-9a-f]{64}$/);
    const selfApprove = await sales.post(`/api/v1/proposals/${proposal.id}/review`, {
      version: d.current.version,
      decision: 'APPROVE',
    });
    expect(selfApprove.status).toBe(403);
    expect(
      (await sales.post(`/api/v1/proposals/${proposal.id}/send`, { version: d.current.version }))
        .status,
    ).toBe(409);
    // The database refuses an unapproved send too.
    await expect(
      db.proposalVersion.updateMany({
        where: { proposalId: proposal.id },
        data: { status: 'SENT', sentAt: new Date() },
      }),
    ).rejects.toThrow();
  });

  it('a manager can send it back with a comment; it is editable again', async () => {
    const { sales, proposal } = await salesProposal();
    let d = (await sales.put(`/api/v1/proposals/${proposal.id}/draft`, draftBody(1))).body.data;
    d = (
      await sales.post(`/api/v1/proposals/${proposal.id}/submit`, { version: d.current.version })
    ).body.data;
    const manager = await user('manager');
    const noComment = await manager.post(`/api/v1/proposals/${proposal.id}/review`, {
      version: d.current.version,
      decision: 'REQUEST_CHANGES',
    });
    expect(noComment.status).toBe(422);
    const back = await manager.post(`/api/v1/proposals/${proposal.id}/review`, {
      version: d.current.version,
      decision: 'REQUEST_CHANGES',
      comment: 'Discount too high',
    });
    expect(back.body.data.current.status).toBe('DRAFT');
    expect(back.body.data.current.reviews.map((r: Body) => r.decision)).toEqual([
      'SUBMITTED',
      'CHANGES_REQUESTED',
    ]);
    const edit = await sales.put(
      `/api/v1/proposals/${proposal.id}/draft`,
      draftBody(back.body.data.current.version, { discountPercent: '5' }),
    );
    expect(edit.status).toBe(200);
  });

  it('two reviewers at once: one decision wins, the other gets 409', async () => {
    const { sales, proposal } = await salesProposal();
    let d = (await sales.put(`/api/v1/proposals/${proposal.id}/draft`, draftBody(1))).body.data;
    d = (
      await sales.post(`/api/v1/proposals/${proposal.id}/submit`, { version: d.current.version })
    ).body.data;
    const [manager, owner] = await Promise.all([user('manager'), user('owner')]);
    const results = await Promise.all([
      manager.post(`/api/v1/proposals/${proposal.id}/review`, {
        version: d.current.version,
        decision: 'APPROVE',
      }),
      owner.post(`/api/v1/proposals/${proposal.id}/review`, {
        version: d.current.version,
        decision: 'REQUEST_CHANGES',
        comment: 'Wait',
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const reviews = await db.proposalReview.count({
      where: { decision: { in: ['APPROVED', 'CHANGES_REQUESTED'] } },
    });
    expect(reviews).toBe(1);
  });
});

describe('FR-Q04 / T-PROP-01 immutable versions', () => {
  it('a submitted version cannot be edited by API or by direct database writes', async () => {
    const { sales, proposal, detail } = await approvedProposal();
    const edit = await sales.put(
      `/api/v1/proposals/${proposal.id}/draft`,
      draftBody(detail.current.version),
    );
    expect(edit.status).toBe(409);
    const v = await db.proposalVersion.findFirstOrThrow({ where: { proposalId: proposal.id } });
    await expect(
      db.proposalVersion.update({ where: { id: v.id }, data: { title: 'Sneaky' } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.proposalItem.updateMany({ where: { versionId: v.id }, data: { unitPriceMinor: 1n } }),
    ).rejects.toThrow(/immutable/);
    await expect(
      db.proposalItem.create({
        data: {
          versionId: v.id,
          position: 9,
          name: 'Extra',
          unit: 'h',
          quantityCenti: 100,
          unitPriceMinor: 1n,
          lineTotalMinor: 1n,
        },
      }),
    ).rejects.toThrow(/immutable/);
    await expect(db.proposalReview.deleteMany({})).rejects.toThrow(/append-only/);
  });

  it('revising creates version 2 and leaves version 1 exactly as sent; sending v2 supersedes v1', async () => {
    const { sales, proposal, detail } = await sentProposal();
    const v1Before = await db.proposalVersion.findFirstOrThrow({
      where: { proposalId: proposal.id, versionNo: 1 },
      include: { items: true },
    });
    const revised = await sales.post(`/api/v1/proposals/${proposal.id}/revise`, {
      version: detail.version,
    });
    expect(revised.status).toBe(200);
    expect(revised.body.data.current).toMatchObject({ versionNo: 2, status: 'DRAFT' });
    expect(revised.body.data.current.totalMinor).toBe(v1Before.totalMinor.toString());

    const second = await sales.post(`/api/v1/proposals/${proposal.id}/revise`, {
      version: revised.body.data.version,
    });
    expect(second.status).toBe(409); // one version in preparation at a time

    const edited = await sales.put(
      `/api/v1/proposals/${proposal.id}/draft`,
      draftBody(revised.body.data.current.version, { discountPercent: '0' }),
    );
    expect(edited.body.data.current.discountMinor).toBe('0');
    const v1After = await db.proposalVersion.findFirstOrThrow({
      where: { proposalId: proposal.id, versionNo: 1 },
      include: { items: true },
    });
    expect(v1After.contentHash).toBe(v1Before.contentHash);
    expect(v1After.items).toEqual(v1Before.items);
    expect(v1After.discountMinor).toBe(v1Before.discountMinor);

    let d = (
      await sales.post(`/api/v1/proposals/${proposal.id}/submit`, {
        version: edited.body.data.current.version,
      })
    ).body.data;
    const manager = await user('manager');
    d = (
      await manager.post(`/api/v1/proposals/${proposal.id}/review`, {
        version: d.current.version,
        decision: 'APPROVE',
      })
    ).body.data;
    d = (await sales.post(`/api/v1/proposals/${proposal.id}/send`, { version: d.current.version }))
      .body.data;
    expect(d.versions.map((v: Body) => [v.versionNo, v.status])).toEqual([
      [2, 'SENT'],
      [1, 'SUPERSEDED'],
    ]);
  });
});

describe('client portal: setup, visibility and isolation (T-ACL-02 for proposals)', () => {
  it('sending needs a client organization with at least one portal user', async () => {
    const { sales, proposal, detail } = await approvedProposal();
    const res = await sales.post(`/api/v1/proposals/${proposal.id}/send`, {
      version: detail.current.version,
    });
    expect(res.status).toBe(409);
    expect(res.body.error.message).toMatch(/client portal/);
  });

  it('portal users see only what was sent to their organization, without internal notes', async () => {
    const { proposal, client } = await sentProposal();
    const list = await client.get('/api/v1/portal/proposals');
    expect(list.status).toBe(200);
    expect(list.body.data.map((p: Body) => p.reference)).toEqual(['P-0001']);
    const detail = await client.get(`/api/v1/portal/proposals/${proposal.id}`);
    expect(detail.status).toBe(200);
    const json = JSON.stringify(detail.body);
    expect(json).not.toContain('Margin is thin');
    expect(json).not.toContain('internalNotes');
    expect(json).not.toContain('reviews');
    expect(detail.body.data.current.totalMinor).toBe('461855');
    expect(detail.body.data.clientOrgName).toBe('Nasser Pharmacies');

    // The notification email links to the portal and carries no amounts or scope (SEC-24).
    await t.drainJobs(); // emails go through the outbox (ADR-058)
    const mail = t.mailer.messages.find((m) => m.kind === 'proposal_sent')!;
    expect(mail.to).toBe('nadia@nasser.test');
    expect(mail.text).toContain(`/portal/proposals/${proposal.id}`);
    expect(mail.text).not.toMatch(/4,?628|EGP|Delivery tracking/);
  });

  it('another organization’s portal user gets 404; drafts are never visible', async () => {
    const { proposal } = await sentProposal();
    const otherDeal = await makeDeal(db, seeded.agencyId, seeded.users.salesA!.id);
    const other = await makeClientOrg(db, seeded.agencyId, otherDeal.contactId, {
      email: 'other@rival.test',
    });
    const draftOnly = await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: otherDeal.id,
      createdById: seeded.users.salesA!.id,
      status: 'APPROVED_INTERNAL',
      clientOrgId: other.orgId,
    });
    const rival = await as(other.clientEmail);
    expect((await rival.get(`/api/v1/portal/proposals/${proposal.id}`)).status).toBe(404);
    expect((await rival.get(`/api/v1/portal/proposals/${draftOnly.proposalId}`)).status).toBe(404);
    expect((await rival.get('/api/v1/portal/proposals')).body.data).toEqual([]);
    const decide = await rival.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: 'a'.repeat(64),
    });
    expect(decide.status).toBe(404);
  });

  it('portal users reach no staff endpoint; staff cannot use the portal API', async () => {
    const { client, proposal, deal } = await sentProposal();
    for (const path of [
      '/api/v1/proposals',
      `/api/v1/proposals/${proposal.id}`,
      '/api/v1/contacts',
      `/api/v1/deals/${deal.id}`,
      '/api/v1/services',
      '/api/v1/users',
    ]) {
      expect({ path, status: (await client.get(path)).status }).toEqual({ path, status: 403 });
    }
    const owner = await user('owner');
    expect((await owner.get('/api/v1/portal/proposals')).status).toBe(403);
  });

  it('portal people stay off the team page and staff invitation list', async () => {
    await sentProposal();
    const owner = await user('owner');
    const team = await owner.get('/api/v1/users');
    expect(team.body.data.some((u: Body) => u.role === 'CLIENT')).toBe(false);
    const invites = await owner.get('/api/v1/invitations');
    expect(invites.body.data).toEqual([]);
  });

  it('deactivating a portal user ends their session at once', async () => {
    const { orgId, client } = await sentProposal();
    const manager = await user('manager');
    const org = (await manager.get(`/api/v1/client-orgs/${orgId}`)).body.data;
    const person = org.portalUsers[0];
    const res = await manager.post(`/api/v1/client-orgs/${orgId}/users/${person.id}/deactivate`, {
      version: person.version,
    });
    expect(res.status).toBe(200);
    expect((await client.get('/api/v1/portal/proposals')).status).toBe(401);
  });

  it('a salesperson cannot set up portal access', async () => {
    const { sales, contact } = await salesProposal();
    const res = await sales.post(`/api/v1/contacts/${contact.id}/client-org`, { name: 'X' });
    expect(res.status).toBe(403);
    expect(await db.clientOrganization.count()).toBe(0);
  });
});

describe('client decisions (FR-Q07–Q09, US-09, T-PROP-02, T-PROP-03)', () => {
  it('accepting records actor, time, version and terms hash, wins the deal and converts the lead', async () => {
    const { proposal, client, deal, contact } = await sentProposal();
    const view = (await client.get(`/api/v1/portal/proposals/${proposal.id}`)).body.data;
    const res = await client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: view.current.contentHash,
    });
    expect(res.status).toBe(200);
    expect(res.body.data.current.status).toBe('ACCEPTED');
    expect(res.body.data.current.decision.by).toBe('Nadia Nasser');

    const review = await db.proposalReview.findFirstOrThrow({ where: { kind: 'CLIENT' } });
    const clientUser = await db.user.findFirstOrThrow({ where: { role: 'CLIENT' } });
    expect(review).toMatchObject({
      decision: 'ACCEPTED',
      actorId: clientUser.id,
      contentHash: view.current.contentHash,
    });
    const won = await db.deal.findUniqueOrThrow({ where: { id: deal.id } });
    expect(won.status).toBe('WON');
    expect(won.wonOverrideReason).toBeNull();
    expect(won.closedById).toBe(clientUser.id);
    expect(won.acceptedProposalVersionId).toBe(view.current.id);
    expect((await db.contact.findUniqueOrThrow({ where: { id: contact.id } })).lifecycle).toBe(
      'CUSTOMER',
    );

    const sales = await user('salesA');
    const dealView = (await sales.get(`/api/v1/deals/${deal.id}`)).body.data;
    expect(dealView.acceptedProposal).toEqual({
      id: proposal.id,
      reference: 'P-0001',
      versionNo: 1,
    });
    // Accepted proposals are final.
    const revise = await sales.post(`/api/v1/proposals/${proposal.id}/revise`, {
      version: (await sales.get(`/api/v1/proposals/${proposal.id}`)).body.data.version,
    });
    expect(revise.status).toBe(409);
    await t.drainJobs(); // emails go through the outbox (ADR-058)
    expect(t.mailer.messages.some((m) => m.kind === 'proposal_decision')).toBe(true);
  });

  it('a stale or invented terms hash is refused', async () => {
    const { proposal, client } = await sentProposal();
    const res = await client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: 'b'.repeat(64),
    });
    expect(res.status).toBe(409);
    expect(await db.proposalReview.count({ where: { kind: 'CLIENT' } })).toBe(0);
  });

  it('T-PROP-03: three simultaneous accepts give one decision, one win, one event', async () => {
    const { proposal, client, deal } = await sentProposal();
    const hash = (await client.get(`/api/v1/portal/proposals/${proposal.id}`)).body.data.current
      .contentHash;
    const results = await Promise.all(
      [1, 2, 3].map(() =>
        client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
          decision: 'ACCEPT',
          contentHash: hash,
        }),
      ),
    );
    expect(results.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await db.proposalReview.count({ where: { kind: 'CLIENT' } })).toBe(1);
    expect(await db.activity.count({ where: { entityId: deal.id, eventType: 'deal.won' } })).toBe(
      1,
    );
  });

  it('accept and decline at the same moment: exactly one is recorded', async () => {
    const { proposal, client } = await sentProposal();
    const hash = (await client.get(`/api/v1/portal/proposals/${proposal.id}`)).body.data.current
      .contentHash;
    const results = await Promise.all([
      client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
        decision: 'ACCEPT',
        contentHash: hash,
      }),
      client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
        decision: 'REJECT',
        contentHash: hash,
        comment: 'Too expensive',
      }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.proposalReview.count({ where: { kind: 'CLIENT' } })).toBe(1);
  });

  it('T-PROP-02: superseded and expired versions cannot be accepted', async () => {
    const { sales, proposal, client, detail } = await sentProposal();
    const v1Hash = (await client.get(`/api/v1/portal/proposals/${proposal.id}`)).body.data.current
      .contentHash;
    // Version 2 is prepared, approved and sent, so version 1 is superseded.
    let d = (
      await sales.post(`/api/v1/proposals/${proposal.id}/revise`, { version: detail.version })
    ).body.data;
    d = (
      await sales.put(
        `/api/v1/proposals/${proposal.id}/draft`,
        draftBody(d.current.version, { discountPercent: '0' }),
      )
    ).body.data;
    d = (
      await sales.post(`/api/v1/proposals/${proposal.id}/submit`, { version: d.current.version })
    ).body.data;
    const manager = await user('manager');
    d = (
      await manager.post(`/api/v1/proposals/${proposal.id}/review`, {
        version: d.current.version,
        decision: 'APPROVE',
      })
    ).body.data;
    await sales.post(`/api/v1/proposals/${proposal.id}/send`, { version: d.current.version });
    const old = await client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: v1Hash,
    });
    expect(old.status).toBe(409);
    expect(old.body.error.message).toMatch(/newer version/);

    // An expired sent version (fixture dated in the past).
    const deal2 = await makeDeal(db, seeded.agencyId, seeded.users.salesA!.id);
    const orgId = (await db.user.findFirstOrThrow({ where: { role: 'CLIENT' } })).clientOrgId!;
    const expired = await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: deal2.id,
      createdById: seeded.users.salesA!.id,
      status: 'SENT',
      clientOrgId: orgId,
      expiresOn: '2020-01-31',
      hash: 'c'.repeat(64),
    });
    const view = await client.get(`/api/v1/portal/proposals/${expired.proposalId}`);
    expect(view.body.data.current.displayStatus).toBe('EXPIRED');
    const late = await client.post(`/api/v1/portal/proposals/${expired.proposalId}/decision`, {
      decision: 'ACCEPT',
      contentHash: 'c'.repeat(64),
    });
    expect(late.status).toBe(409);
    expect(late.body.error.message).toMatch(/expired/);
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal2.id } })).status).toBe('OPEN');
  });

  it('declining or asking for changes needs a reason and leaves the deal open for a new version', async () => {
    const { sales, proposal, client, deal } = await sentProposal();
    const hash = (await client.get(`/api/v1/portal/proposals/${proposal.id}`)).body.data.current
      .contentHash;
    const noReason = await client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
      decision: 'REQUEST_CHANGES',
      contentHash: hash,
    });
    expect(noReason.status).toBe(422);
    const res = await client.post(`/api/v1/portal/proposals/${proposal.id}/decision`, {
      decision: 'REQUEST_CHANGES',
      contentHash: hash,
      comment: 'Please split the build into two phases',
    });
    expect(res.status).toBe(200);
    expect((await db.deal.findUniqueOrThrow({ where: { id: deal.id } })).status).toBe('OPEN');
    const staff = (await sales.get(`/api/v1/proposals/${proposal.id}`)).body.data;
    expect(staff.status).toBe('CHANGES_REQUESTED');
    const revise = await sales.post(`/api/v1/proposals/${proposal.id}/revise`, {
      version: staff.version,
    });
    expect(revise.status).toBe(200);
  });
});

describe('FR-Q01 service catalog', () => {
  it('admins manage the catalog, sales read it, and proposal lines keep their own copy', async () => {
    const admin = await user('admin');
    const created = await admin.post('/api/v1/services', {
      name: 'UX audit',
      unit: 'day',
      rate: '4,000',
      currency: 'EGP',
    });
    expect(created.status).toBe(201);
    expect(created.body.data.rateMinor).toBe('400000');
    const sales = await user('salesA');
    expect((await sales.get('/api/v1/services')).body.data).toHaveLength(1);
    expect(
      (await sales.post('/api/v1/services', { name: 'x', unit: 'h', rate: '1', currency: 'EGP' }))
        .status,
    ).toBe(403);

    const { proposal } = await salesProposal();
    const withService = await sales.put(
      `/api/v1/proposals/${proposal.id}/draft`,
      draftBody(1, {
        items: [
          {
            serviceId: created.body.data.id,
            name: 'UX audit',
            unit: 'day',
            quantity: '2',
            unitPrice: '4000',
          },
        ],
      }),
    );
    expect(withService.status).toBe(200);
    await admin
      .patch(`/api/v1/services/${created.body.data.id}`, {
        version: 1,
        rate: '9,999',
        currency: 'EGP',
      })
      .expect(200);
    const item = await db.proposalItem.findFirstOrThrow({});
    expect(item.unitPriceMinor).toBe(400000n);

    const archived = await admin.post(`/api/v1/services/${created.body.data.id}/archive`, {
      version: 2,
    });
    expect(archived.body.data.archivedAt).not.toBeNull();
    expect((await sales.get('/api/v1/services')).body.data).toHaveLength(0);
  });
});
