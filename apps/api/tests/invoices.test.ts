// M9: invoices, payments, cost rates and finance views (FR-F01 – FR-F10, SEC-14, SEC-15,
// T-PAY-01/02, T-ACL-04/05, US-14, US-18, US-23).
import { randomUUID } from 'node:crypto';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';
import { makeClientOrg, makeProject } from './proposal-fixtures.js';

const db = testDb();
afterAll(() => db.$disconnect());

type Agent = Awaited<ReturnType<typeof login>>;
let seeded: SeededAgency;
let app: ReturnType<typeof makeApp>['app'];
let finance: Agent;
let owner: Agent;
let admin: Agent;
let pm: Agent;
let client: Agent;
let clientB: Agent;
let projectId: string;
let milestoneId: string;
let changeId: string;
let orgId: string;

const send = (
  a: Agent,
  method: 'post' | 'patch' | 'put',
  path: string,
  body: object = {},
  headers: Record<string, string> = {},
) => {
  let r = a.agent[method](`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};
const get = (a: Agent, path: string) => a.agent.get(`/api/v1${path}`);
const pay = (a: Agent, id: string, body: object, key = randomUUID()) =>
  send(a, 'post', `/invoices/${id}/payments`, body, { 'Idempotency-Key': key });

/** A draft with a milestone line (1.5 × 1,000.33) and a change line (12,000.00). */
async function draft(dueOn = '2027-01-31') {
  const c = await send(finance, 'post', '/invoices', {
    clientOrgId: orgId,
    projectId,
    dueOn,
  }).expect(201);
  const d = await send(finance, 'put', `/invoices/${c.body.data.id}/draft`, {
    version: c.body.data.version,
    dueOn,
    taxRatePercent: '14',
    terms: 'Bank transfer to account 123, 30 days.',
    internalNote: 'Finance-only note',
    items: [
      {
        description: 'Kick-off milestone',
        quantity: '1.5',
        unitPrice: '1000.33',
        source: 'MILESTONE',
        sourceId: milestoneId,
      },
      {
        description: 'CR-1 Delivery tracking',
        quantity: '1',
        unitPrice: '12000.00',
        source: 'CHANGE',
        sourceId: changeId,
      },
    ],
  }).expect(200);
  return d.body.data as { id: string; version: number; totalMinor: string };
}

async function issued(dueOn?: string) {
  const d = await draft(dueOn);
  const i = await send(finance, 'post', `/invoices/${d.id}/issue`, { version: d.version }).expect(
    200,
  );
  return i.body.data as { id: string; version: number; totalMinor: string; reference: string };
}

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  ({ app } = makeApp());
  const ownerId = seeded.users.owner!.id;
  const contact = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId, fullName: 'Hany Fawzi' },
  });
  const org = await makeClientOrg(db, seeded.agencyId, contact.id, {
    name: 'Fawzi Logistics',
    email: 'hany@fawzi.test',
  });
  orgId = org.orgId;
  const contactB = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId, fullName: 'Other buyer' },
  });
  await makeClientOrg(db, seeded.agencyId, contactB.id, { email: 'buyer@other.test' });
  const p = await makeProject(db, {
    agencyId: seeded.agencyId,
    managerId: seeded.users.pm!.id,
    createdById: seeded.users.pm!.id,
    memberIds: [seeded.users.member!.id],
    clientOrgId: orgId,
  });
  projectId = p.projectId;
  milestoneId = p.milestoneId;
  await db.project.update({
    where: { id: projectId },
    data: { state: 'ACTIVE', budgetMinor: 6_000_000n, contactId: contact.id },
  });
  // An accepted change to bill for.
  const cr = await db.changeRequest.create({
    data: {
      agencyId: seeded.agencyId,
      projectId,
      number: 1,
      title: 'Delivery tracking',
      description: 'Map',
      requestedById: seeded.users.pm!.id,
      currentVersionNo: 1,
    },
  });
  const v = await db.changeVersion.create({
    data: {
      agencyId: seeded.agencyId,
      projectId,
      changeRequestId: cr.id,
      versionNo: 1,
      status: 'ACCEPTED',
      scope: 'Map',
      priceMinor: 1_200_000n,
      currency: 'EGP',
      taxMinor: 168_000n,
      totalMinor: 1_368_000n,
      sentAt: new Date(),
      sentById: seeded.users.pm!.id,
      contentHash: 'c'.repeat(64),
      createdById: seeded.users.pm!.id,
    },
  });
  await db.changeRequest.update({
    where: { id: cr.id },
    data: { status: 'ACCEPTED', acceptedVersionId: v.id },
  });
  changeId = cr.id;
  await db.agency.update({
    where: { id: seeded.agencyId },
    data: { contactEmail: 'billing@agency.test', address: '12 Nile St, Cairo' },
  });
  finance = await login(app, seeded.users.finance!.email);
  owner = await login(app, seeded.users.owner!.email);
  admin = await login(app, seeded.users.admin!.email);
  pm = await login(app, seeded.users.pm!.email);
  client = await login(app, 'hany@fawzi.test');
  clientB = await login(app, 'buyer@other.test');
});

describe('drafts and issued snapshots (FR-F01, FR-F02, FR-F10)', () => {
  it('computes exact totals; issuing numbers the invoice and freezes a snapshot', async () => {
    const d = await draft();
    const detail = (await get(finance, `/invoices/${d.id}`).expect(200)).body.data;
    // 1.5 × 1,000.33 = 1,500.495 → 1,500.50; + 12,000.00 = 13,500.50; VAT 14% = 1,890.07.
    expect(detail).toMatchObject({
      reference: 'Draft',
      number: null,
      status: 'DRAFT',
      subtotalMinor: '1350050',
      taxMinor: '189007',
      totalMinor: '1539057',
      currency: 'EGP',
      billedTo: null,
    });
    expect(detail.items.map((i: { lineTotalMinor: string }) => i.lineTotalMinor)).toEqual([
      '150050',
      '1200000',
    ]);

    // A draft deleted before issue does not use up a number.
    const spare = await send(finance, 'post', '/invoices', {
      clientOrgId: orgId,
      dueOn: '2027-01-31',
    }).expect(201);
    await send(finance, 'post', `/invoices/${spare.body.data.id}/delete`, { version: 1 }).expect(
      200,
    );

    // Empty drafts cannot be issued.
    const empty = await send(finance, 'post', '/invoices', {
      clientOrgId: orgId,
      dueOn: '2027-01-31',
    }).expect(201);
    await send(finance, 'post', `/invoices/${empty.body.data.id}/issue`, { version: 1 }).expect(
      409,
    );

    const i = await send(finance, 'post', `/invoices/${d.id}/issue`, { version: d.version }).expect(
      200,
    );
    expect(i.body.data).toMatchObject({
      reference: 'INV-0001',
      status: 'ISSUED',
      billedTo: { name: 'Fawzi Logistics', contact: 'Hany Fawzi' },
      issuer: { name: 'Test Agency', details: '12 Nile St, Cairo\nbilling@agency.test' },
    });
    const second = await issued();
    expect(second.reference).toBe('INV-0002');

    // Frozen: the API refuses edits, and so does the database.
    await send(finance, 'put', `/invoices/${d.id}/draft`, {
      version: i.body.data.version,
      dueOn: '2027-02-28',
      taxRatePercent: '0',
      items: [],
    }).expect(409);
    await expect(
      db.invoice.update({
        where: { id: d.id },
        data: { totalMinor: 1n, subtotalMinor: 1n, taxMinor: 0n },
      }),
    ).rejects.toThrow();
    await expect(db.invoiceItem.deleteMany({ where: { invoiceId: d.id } })).rejects.toThrow();
    await expect(db.invoice.delete({ where: { id: d.id } })).rejects.toThrow();
    // Renaming the client later does not change the issued invoice.
    await db.clientOrganization.update({ where: { id: orgId }, data: { name: 'Fawzi Group' } });
    expect((await get(finance, `/invoices/${d.id}`).expect(200)).body.data.billedTo.name).toBe(
      'Fawzi Logistics',
    );
  });

  it('lines must bill this project’s milestones or accepted changes; projects keep their currency', async () => {
    const other = await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: seeded.users.pm!.id,
      createdById: seeded.users.pm!.id,
      clientOrgId: orgId,
    });
    const c = await send(finance, 'post', '/invoices', {
      clientOrgId: orgId,
      projectId,
      dueOn: '2027-01-31',
    }).expect(201);
    const bad = await send(finance, 'put', `/invoices/${c.body.data.id}/draft`, {
      version: 1,
      dueOn: '2027-01-31',
      taxRatePercent: '14',
      items: [
        {
          description: 'Wrong',
          quantity: '1',
          unitPrice: '10',
          source: 'MILESTONE',
          sourceId: other.milestoneId,
        },
      ],
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.fieldErrors['items.0.sourceId']).toBeDefined();
    await send(finance, 'post', '/invoices', {
      clientOrgId: orgId,
      projectId,
      currency: 'USD',
      dueOn: '2027-01-31',
    }).expect(422);
    const otherOrg = await db.clientOrganization.findFirstOrThrow({
      where: { name: { not: 'Fawzi Logistics' } },
    });
    await send(finance, 'post', '/invoices', {
      clientOrgId: otherOrg.id,
      projectId,
      dueOn: '2027-01-31',
    }).expect(422);
  });
});

describe('payments (FR-F03, FR-F04, T-PAY-01, T-PAY-02, US-14, US-18)', () => {
  it('partial payments add up exactly; overpayment is refused; status follows the money', async () => {
    const i = await issued();
    const one = await pay(finance, i.id, {
      amount: '5000.00',
      receivedOn: '2026-10-20',
      reference: 'NBE-7731',
    }).expect(201);
    expect(one.body.data.invoice).toMatchObject({
      status: 'PARTIALLY_PAID',
      paidMinor: '500000',
      balanceMinor: '1039057',
    });
    await pay(finance, i.id, { amount: '0.01', receivedOn: '2026-10-21', method: 'CASH' }).expect(
      201,
    );
    const over = await pay(finance, i.id, { amount: '10390.57', receivedOn: '2026-10-22' });
    expect(over.status).toBe(409);
    expect(over.body.error.message).toMatch(/open balance is 10390\.56 EGP/);
    const last = await pay(finance, i.id, { amount: '10390.56', receivedOn: '2026-10-22' }).expect(
      201,
    );
    expect(last.body.data.invoice).toMatchObject({
      status: 'PAID',
      paidMinor: '1539057',
      balanceMinor: '0',
    });
    await pay(finance, i.id, { amount: '1.00', receivedOn: '2026-10-22' }).expect(409);
    expect(await db.payment.count()).toBe(3);
  });

  it('a retried request with the same Idempotency-Key records one payment; racing payments cannot overpay', async () => {
    const i = await issued();
    const key = randomUUID();
    const body = { amount: '100.00', receivedOn: '2026-10-20', reference: 'NBE-1' };
    const first = await pay(finance, i.id, body, key).expect(201);
    const again = await pay(finance, i.id, body, key).expect(200);
    expect(again.body.data.replayed).toBe(true);
    expect(again.body.data.invoice.paidMinor).toBe(first.body.data.invoice.paidMinor);
    await pay(finance, i.id, { ...body, amount: '200.00' }, key).expect(409);
    await send(finance, 'post', `/invoices/${i.id}/payments`, body).expect(422); // no key
    expect(await db.payment.count()).toBe(1);

    // Two people record the whole remaining balance at the same moment: only one lands.
    const rest = { amount: '15290.57', receivedOn: '2026-10-21' };
    const results = await Promise.all([pay(finance, i.id, rest), pay(owner, i.id, rest)]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: i.id } });
    expect(inv.paidMinor).toBe(inv.totalMinor);
  });

  it('mistakes are reversed, never edited; void needs a reason and no open payments', async () => {
    const i = await issued();
    const r = await pay(finance, i.id, { amount: '1000.00', receivedOn: '2026-10-20' }).expect(201);
    const paymentId = r.body.data.invoice.payments[0].id;
    await send(finance, 'post', `/invoices/${i.id}/void`, {
      version: r.body.data.invoice.version,
      reason: 'Wrong client',
    }).expect(409);
    const back = await send(finance, 'post', `/invoices/${i.id}/payments/${paymentId}/reverse`, {
      reason: 'Bounced transfer',
    }).expect(200);
    expect(back.body.data).toMatchObject({ status: 'ISSUED', paidMinor: '0' });
    expect(back.body.data.payments.map((p: { kind: string }) => p.kind)).toEqual([
      'PAYMENT',
      'REVERSAL',
    ]);
    await send(finance, 'post', `/invoices/${i.id}/payments/${paymentId}/reverse`, {
      reason: 'Again',
    }).expect(200);
    expect(await db.payment.count()).toBe(2);
    await expect(db.payment.updateMany({ data: { amountMinor: 1n } })).rejects.toThrow();
    await expect(db.payment.deleteMany({})).rejects.toThrow();

    await send(finance, 'post', `/invoices/${i.id}/void`, {
      version: back.body.data.version,
      reason: '',
    }).expect(422);
    const v = await send(finance, 'post', `/invoices/${i.id}/void`, {
      version: back.body.data.version,
      reason: 'Wrong client',
    }).expect(200);
    expect(v.body.data).toMatchObject({
      status: 'VOID',
      voidReason: 'Wrong client',
      reference: 'INV-0001',
    });
    await pay(finance, i.id, { amount: '1.00', receivedOn: '2026-10-20' }).expect(409);
    await expect(
      db.invoice.update({ where: { id: i.id }, data: { internalNote: 'x' } }),
    ).rejects.toThrow();
  });

  it('only Finance and the Owner record payments; sales and PMs cannot change invoices (T-PAY-02)', async () => {
    const i = await issued();
    const sales = await login(app, seeded.users.salesA!.email);
    await pay(sales, i.id, { amount: '1.00', receivedOn: '2026-10-20' }).expect(403);
    await pay(admin, i.id, { amount: '1.00', receivedOn: '2026-10-20' }).expect(403);
    await pay(pm, i.id, { amount: '1.00', receivedOn: '2026-10-20' }).expect(403);
    await pay(owner, i.id, { amount: '1.00', receivedOn: '2026-10-20' }).expect(201);
    // Admin manages invoices but not payment status (FR-F04).
    await send(admin, 'post', '/invoices', { clientOrgId: orgId, dueOn: '2027-01-31' }).expect(201);
    // The PM reads the project's invoices, without the finance note, and changes nothing.
    const seen = await get(pm, `/invoices/${i.id}`).expect(200);
    expect(seen.body.data.internalNote).toBeNull();
    expect(seen.body.data.access).toEqual({
      edit: false,
      issue: false,
      publish: false,
      void: false,
      recordPayment: false,
    });
    await send(pm, 'post', '/invoices', { clientOrgId: orgId, dueOn: '2027-01-31' }).expect(403);
    await get(sales, '/invoices').expect(403);
    const inv = await db.invoice.findUniqueOrThrow({ where: { id: i.id } });
    expect(inv.paidMinor).toBe(100n);
  });

  it('references never hold card numbers (SEC-14)', async () => {
    const i = await issued();
    await pay(finance, i.id, {
      amount: '1.00',
      receivedOn: '2026-10-20',
      reference: '4111 1111 1111 1111',
    }).expect(422);
    await expect(
      db.payment.create({
        data: {
          agencyId: seeded.agencyId,
          invoiceId: i.id,
          amountMinor: 1n,
          currency: 'EGP',
          receivedOn: new Date(),
          reference: '4111111111111111',
          recordedById: seeded.users.finance!.id,
        },
      }),
    ).rejects.toThrow();
  });

  it('overdue is derived from the due date and the open balance', async () => {
    const late = await issued('2020-01-31');
    const list = (await get(finance, '/invoices?status=OVERDUE').expect(200)).body.data.invoices;
    expect(list.map((x: { id: string; displayStatus: string }) => [x.id, x.displayStatus])).toEqual(
      [[late.id, 'OVERDUE']],
    );
    await pay(finance, late.id, { amount: '15390.57', receivedOn: '2026-10-20' }).expect(201);
    expect((await get(finance, `/invoices/${late.id}`).expect(200)).body.data.displayStatus).toBe(
      'PAID',
    );
  });
});

describe('client portal invoices (FR-X03, T-ACL-02)', () => {
  it('clients see only published invoices of their own organization, without internal data', async () => {
    const i = await issued();
    expect((await get(client, '/portal/invoices').expect(200)).body.data).toEqual([]);
    await get(client, `/portal/invoices/${i.id}`).expect(404);
    await send(finance, 'post', `/invoices/${i.id}/publish`, { version: i.version }).expect(200);
    const r = await pay(finance, i.id, {
      amount: '1000.00',
      receivedOn: '2026-10-20',
      note: 'Internal: early',
    }).expect(201);
    await send(
      finance,
      'post',
      `/invoices/${i.id}/payments/${r.body.data.invoice.payments[0].id}/reverse`,
      { reason: 'Bounced' },
    ).expect(200);
    await pay(finance, i.id, {
      amount: '2000.00',
      receivedOn: '2026-10-21',
      reference: 'NBE-9',
    }).expect(201);

    const seen = (await get(client, `/portal/invoices/${i.id}`).expect(200)).body.data;
    expect(seen).toMatchObject({
      reference: 'INV-0001',
      paidMinor: '200000',
      balanceMinor: '1339057',
    });
    expect(seen.payments).toEqual([
      { receivedOn: '2026-10-21', amountMinor: '200000', method: 'BANK_TRANSFER' },
    ]);
    const json = JSON.stringify(seen);
    for (const secret of ['Finance-only note', 'Internal: early', 'Bounced', 'NBE-9', 'sourceId']) {
      expect(json).not.toContain(secret);
    }
    const denied = () => db.auditEvent.count({ where: { action: 'portal.access_denied' } });
    const before = await denied();
    await get(clientB, `/portal/invoices/${i.id}`).expect(404);
    expect((await get(clientB, '/portal/invoices').expect(200)).body.data).toEqual([]);
    expect(await denied()).toBe(before + 1);
  });
});

describe('cost, margin and finance views (FR-F05 – FR-F09, US-23, T-ACL-04/05)', () => {
  it('estimates time cost from dated rates in the project currency and says how complete it is', async () => {
    const task = await db.task.create({
      data: {
        agencyId: seeded.agencyId,
        projectId,
        title: 'Build',
        createdById: seeded.users.pm!.id,
      },
    });
    const entry = (userId: string, workedOn: string, minutes: number) =>
      db.timeEntry.create({
        data: {
          agencyId: seeded.agencyId,
          projectId,
          taskId: task.id,
          userId,
          workedOn: new Date(workedOn),
          minutes,
        },
      });
    await entry(seeded.users.member!.id, '2026-09-30', 60); // before the rate starts: uncosted
    await entry(seeded.users.member!.id, '2026-10-05', 90);
    await entry(seeded.users.pm!.id, '2026-10-05', 30); // USD rate: never mixed with EGP
    await send(admin, 'post', `/users/${seeded.users.member!.id}/cost-rates`, {
      hourly: '300.00',
      currency: 'EGP',
      effectiveFrom: '2026-10-01',
    }).expect(200);
    await send(owner, 'post', `/users/${seeded.users.pm!.id}/cost-rates`, {
      hourly: '20.00',
      currency: 'USD',
      effectiveFrom: '2026-01-01',
    }).expect(200);
    await send(pm, 'post', `/users/${seeded.users.member!.id}/cost-rates`, {
      hourly: '1.00',
      currency: 'EGP',
      effectiveFrom: '2026-10-01',
    }).expect(403);

    const i = await issued();
    await pay(finance, i.id, { amount: '5000.00', receivedOn: '2026-10-20' }).expect(201);
    const f = (await get(finance, `/projects/${projectId}/finance`).expect(200)).body.data;
    expect(f).toMatchObject({
      currency: 'EGP',
      expectedMinor: '6000000',
      invoicedMinor: '1350050',
      invoicedTotalMinor: '1539057',
      receivedMinor: '500000',
      outstandingMinor: '1039057',
      // 90 minutes × 300.00/h = 450.00
      cost: {
        estimatedMinor: '45000',
        minutesCosted: 90,
        minutesTotal: 180,
        completenessPercent: 50,
        missingRates: ['member user', 'pm user'],
      },
      estimatedMarginMinor: '5955000',
      scope: 'full',
    });
    expect(f.billable.milestones[0]).toMatchObject({ id: milestoneId, invoiced: true });
    expect(f.billable.changes[0]).toMatchObject({ reference: 'CR-1', invoiced: true });

    // The PM sees the estimate, never individual rates or the billing list.
    const est = (await get(pm, `/projects/${projectId}/finance`).expect(200)).body.data;
    expect(est).toMatchObject({
      scope: 'estimate',
      billable: null,
      estimatedMarginMinor: '5955000',
    });
    expect(JSON.stringify(est)).not.toContain('30000');
    await get(pm, '/cost-rates').expect(403);
    const member = await login(app, seeded.users.member!.email);
    await get(member, `/projects/${projectId}/finance`).expect(403);

    const rates = (await get(finance, '/cost-rates').expect(200)).body.data;
    const m = rates.find((r: { user: { id: string } }) => r.user.id === seeded.users.member!.id);
    expect(m.current).toEqual({
      hourlyMinor: '30000',
      currency: 'EGP',
      effectiveFrom: '2026-10-01',
    });
    expect(await db.auditEvent.count({ where: { action: 'cost_rate.set' } })).toBe(2);
  });

  it('reports totals per currency with aging; sales get nothing; CSV is neutralized', async () => {
    const i = await issued('2020-01-31');
    await pay(finance, i.id, { amount: '390.57', receivedOn: '2026-10-20' }).expect(201);
    const usd = await send(finance, 'post', '/invoices', {
      clientOrgId: orgId,
      currency: 'USD',
      dueOn: '2099-01-31',
    }).expect(201);
    const ud = await send(finance, 'put', `/invoices/${usd.body.data.id}/draft`, {
      version: 1,
      dueOn: '2099-01-31',
      taxRatePercent: '0',
      items: [{ description: '=HYPERLINK("http://evil")', quantity: '2', unitPrice: '100.00' }],
    }).expect(200);
    await send(finance, 'post', `/invoices/${ud.body.data.id}/issue`, {
      version: ud.body.data.version,
    }).expect(200);
    await db.clientOrganization.update({ where: { id: orgId }, data: { name: '=cmd|calc' } });

    const report = (await get(finance, '/reports/finance').expect(200)).body.data;
    const egp = report.totals.find((t: { currency: string }) => t.currency === 'EGP');
    const usdT = report.totals.find((t: { currency: string }) => t.currency === 'USD');
    expect(egp).toMatchObject({
      invoiced: { count: 1, totalMinor: '1539057' },
      receivedMinor: '39057',
      outstandingMinor: '1500000',
      overdue: { count: 1, balanceMinor: '1500000' },
      aging: { over90: '1500000', current: '0' },
    });
    expect(usdT).toMatchObject({
      invoiced: { count: 1, totalMinor: '20000' },
      aging: { current: '20000' },
    });
    const filtered = (await get(finance, `/reports/finance?projectId=${projectId}`).expect(200))
      .body.data;
    expect(filtered.totals.map((t: { currency: string }) => t.currency)).toEqual(['EGP']);

    const sales = await login(app, seeded.users.salesA!.email);
    await get(sales, '/reports/finance').expect(403);
    await get(pm, '/reports/finance').expect(403);
    await get(sales, '/exports/invoices.csv').expect(403);

    const csv = await get(finance, '/exports/invoices.csv').expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain(`"'=cmd|calc"`);
    expect(csv.text).toContain('"INV-0001"');
    expect(csv.text).not.toContain('Finance-only note');
    expect(await db.auditEvent.count({ where: { action: 'export.invoices' } })).toBe(1);
  });

  it('T-ACL-04: finance sees money, never delivery notes, tasks or time', async () => {
    const i = await issued();
    const detail = (await get(finance, `/invoices/${i.id}`).expect(200)).body.data;
    expect(detail.internalNote).toBe('Finance-only note');
    await get(finance, `/projects/${projectId}/tasks`).expect(403);
    await get(finance, `/projects/${projectId}/time`).expect(403);
    await get(finance, `/projects/${projectId}`).expect(403);
  });
});
