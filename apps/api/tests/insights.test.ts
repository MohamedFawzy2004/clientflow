// M5: dashboard (FR-F08, US-15, T-ACL-05), reminders (FR-A01), CSV export (US-22), agency
// settings (FR-I09) and proposal PDFs (FR-Q06), against the real database.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { agencyToday } from '../src/lib/agency-time.js';
import { csvCell } from '../src/modules/insights/service.js';
import { pdfText, renderProposalPdf } from '../src/modules/proposals/pdf.js';
import {
  login,
  makeApp,
  ORIGIN,
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

async function as(key: string) {
  const email = key.includes('@') ? key : seeded.users[key]!.email;
  const { agent, csrf } = await login(t.app, email);
  return {
    get: (p: string) => agent.get(p),
    patch: (p: string, b: object) =>
      agent.patch(p).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(b),
    post: (p: string, b: object = {}) =>
      agent.post(p).set('Origin', ORIGIN).set('X-CSRF-Token', csrf).send(b),
  };
}
const id = (k: string) => seeded.users[k]!.id;
const now = () => new Date();

/** salesA: open EGP 1,000 + open USD 50, one won EGP 300 and one lost; salesB: open EGP 7,000, won EGP 9,000. */
async function salesData() {
  const mk = (owner: string, title: string, amount: bigint, currency = 'EGP', extra: object = {}) =>
    makeDeal(db, seeded.agencyId, id(owner), { title, currency }).then((d) =>
      db.deal.update({ where: { id: d.id }, data: { amountMinor: amount, ...extra } }),
    );
  const closed = (status: 'WON' | 'LOST', by: string) => ({
    status,
    closedAt: now(),
    closedById: id(by),
    ...(status === 'LOST' ? { lostReason: 'Budget' } : {}),
  });
  await mk('salesA', 'A open EGP', 100_000n);
  await mk('salesA', 'A open USD', 5_000n, 'USD');
  await mk('salesA', 'A won', 30_000n, 'EGP', closed('WON', 'manager'));
  await mk('salesA', 'A lost', 10_000n, 'EGP', closed('LOST', 'salesA'));
  await mk('salesB', 'B open', 700_000n);
  await mk('salesB', 'B won', 900_000n, 'EGP', closed('WON', 'manager'));
}

describe('sales dashboard (FR-F08, US-15, T-ACL-05)', () => {
  it('managers see agency totals per currency, never added across currencies', async () => {
    await salesData();
    const res = await (await as('manager')).get('/api/v1/dashboard/sales');
    expect(res.status).toBe(200);
    const d = res.body.data;
    expect(d.pipeline).toEqual({ openDeals: 3, totals: { EGP: '800000', USD: '5000' } });
    expect(d.won).toEqual({ count: 2, totals: { EGP: '930000' } });
    expect(d.lost).toEqual({ count: 1 });
    expect(d.winRatePercent).toBe(67);
    expect(
      d.byOwner.map((r: { owner: { name: string }; openDeals: number }) => [
        r.owner.name,
        r.openDeals,
      ]),
    ).toEqual([
      ['salesA user', 2],
      ['salesB user', 1],
    ]);
  });

  it('a salesperson only ever gets their own numbers', async () => {
    await salesData();
    const a = await as('salesA');
    const d = (await a.get('/api/v1/dashboard/sales')).body.data;
    expect(d.owner).toEqual({ id: id('salesA'), name: 'salesA user' });
    expect(d.pipeline.totals).toEqual({ EGP: '100000', USD: '5000' });
    expect(d.won.totals).toEqual({ EGP: '30000' });
    expect(d.winRatePercent).toBe(50);
    expect(d.byOwner).toBeNull();
    const peek = await a.get(`/api/v1/dashboard/sales?ownerId=${id('salesB')}`);
    expect(peek.status).toBe(403);
  });

  it('managers can narrow to one owner; invalid owners and ranges are refused', async () => {
    await salesData();
    const m = await as('manager');
    const b = (await m.get(`/api/v1/dashboard/sales?ownerId=${id('salesB')}`)).body.data;
    expect(b.pipeline.totals).toEqual({ EGP: '700000' });
    expect(b.byOwner.map((r: { owner: { id: string } }) => r.owner.id)).toEqual([id('salesB')]);
    expect(
      (await m.get('/api/v1/dashboard/sales?ownerId=018f0000-0000-7000-8000-000000000000')).status,
    ).toBe(422);
    expect((await m.get('/api/v1/dashboard/sales?from=2026-10-10&to=2026-10-01')).status).toBe(422);
    expect((await m.get('/api/v1/dashboard/sales?extra=1')).status).toBe(422);
  });

  it('date range filters closed deals; numbers change after the database changes (US-15)', async () => {
    await salesData();
    const m = await as('manager');
    const past = (await m.get('/api/v1/dashboard/sales?from=2020-01-01&to=2020-12-31')).body.data;
    expect(past.won.count).toBe(0);
    expect(past.winRatePercent).toBeNull();
    const before = (await m.get('/api/v1/dashboard/sales')).body.data.won.count;
    const open = await db.deal.findFirstOrThrow({ where: { title: 'B open' } });
    await db.deal.update({
      where: { id: open.id },
      data: { status: 'WON', closedAt: now(), closedById: id('manager') },
    });
    const after = (await m.get('/api/v1/dashboard/sales')).body.data;
    expect(after.won.count).toBe(before + 1);
    expect(after.pipeline.openDeals).toBe(2);
  });

  it('counts proposals in review, awaiting the client and expiring, within scope', async () => {
    const dealA = await makeDeal(db, seeded.agencyId, id('salesA'));
    const dealB = await makeDeal(db, seeded.agencyId, id('salesB'));
    const today = agencyToday(now(), 'Africa/Cairo');
    const soon = new Date(`${today}T00:00:00Z`);
    soon.setUTCDate(soon.getUTCDate() + 3);
    await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: dealA.id,
      createdById: id('salesA'),
      status: 'IN_REVIEW',
    });
    await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: dealA.id,
      createdById: id('salesA'),
      status: 'SENT',
      expiresOn: soon.toISOString().slice(0, 10),
    });
    await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: dealB.id,
      createdById: id('salesB'),
      status: 'SENT',
    });
    const m = (await (await as('manager')).get('/api/v1/dashboard/sales')).body.data.proposals;
    expect(m).toMatchObject({ inReview: 1, awaitingClient: 2, expiringIn7Days: 1 });
    const a = (await (await as('salesA')).get('/api/v1/dashboard/sales')).body.data.proposals;
    expect(a).toMatchObject({ inReview: 1, awaitingClient: 1, expiringIn7Days: 1 });
    const b = (await (await as('salesB')).get('/api/v1/dashboard/sales')).body.data.proposals;
    expect(b).toMatchObject({ inReview: 0, awaitingClient: 1, expiringIn7Days: 0 });
  });

  it('roles without sales access get 403', async () => {
    for (const k of ['pm', 'member', 'finance']) {
      expect((await (await as(k)).get('/api/v1/dashboard/sales')).status).toBe(403);
    }
  });
});

describe('reminders (FR-A01)', () => {
  it('lists the viewer’s own overdue follow-ups and, for approvers, proposals to review', async () => {
    const past = new Date(Date.now() - 3 * 86_400_000);
    const lead = await db.contact.create({
      data: {
        agencyId: seeded.agencyId,
        ownerId: id('salesA'),
        fullName: 'Late lead',
        nextActionAt: past,
      },
    });
    const deal = await makeDeal(db, seeded.agencyId, id('salesA'), { title: 'Late deal' });
    await db.deal.update({
      where: { id: deal.id },
      data: { nextStepAt: past, nextStep: 'Call back' },
    });
    await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: deal.id,
      createdById: id('salesA'),
      status: 'IN_REVIEW',
    });

    const a = (await (await as('salesA')).get('/api/v1/reminders')).body.data;
    expect(a.items.map((r: { kind: string; title: string }) => [r.kind, r.title])).toEqual([
      ['follow_up_overdue', 'Late lead'],
      ['follow_up_overdue', 'Late deal'],
    ]);
    expect(a.items[0].href).toBe(`/app/leads/${lead.id}`);
    const b = (await (await as('salesB')).get('/api/v1/reminders')).body.data;
    expect(b.total).toBe(0);
    const m = (await (await as('manager')).get('/api/v1/reminders')).body.data;
    expect(m.items.map((r: { kind: string }) => r.kind)).toEqual(['proposal_review']);
  });
});

describe('CSV export (US-22)', () => {
  it('neutralizes spreadsheet formulas and quotes every cell', () => {
    expect(csvCell('=HYPERLINK("http://evil.example","x")')).toBe(
      '"\'=HYPERLINK(""http://evil.example"",""x"")"',
    );
    for (const bad of ['+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rcmd']) {
      expect(csvCell(bad).startsWith(`"'`)).toBe(true);
    }
    expect(csvCell('Normal, text')).toBe('"Normal, text"');
    expect(csvCell(null)).toBe('""');
  });

  it('exports only permitted deals with exact amounts; salespeople cannot export', async () => {
    await salesData();
    const evil = await makeDeal(db, seeded.agencyId, id('salesA'), { title: '=cmd|"/c calc"!A1' });
    await db.deal.update({ where: { id: evil.id }, data: { amountMinor: 1_250_050n } });
    const m = await as('manager');
    const res = await m.get('/api/v1/exports/deals.csv');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/text\/csv/);
    expect(res.headers['content-disposition']).toMatch(/attachment; filename="deals-/);
    expect(res.headers['cache-control']).toMatch(/no-store/);
    const text = res.text;
    expect(text.charCodeAt(0)).toBe(0xfeff);
    const lines = text.slice(1).trim().split('\r\n');
    expect(lines).toHaveLength(1 + 7);
    expect(text).toContain('"\'=cmd|""/c calc""!A1"');
    expect(text).toContain('"12500.50"');
    expect(await db.auditEvent.count({ where: { action: 'export.deals' } })).toBe(1);

    const onlyB = (await m.get(`/api/v1/exports/deals.csv?ownerId=${id('salesB')}`)).text;
    expect(onlyB).toContain('B open');
    expect(onlyB).not.toContain('A open');
    expect((await (await as('salesA')).get('/api/v1/exports/deals.csv')).status).toBe(403);
  });
});

describe('agency settings (FR-I09)', () => {
  it('owners update the profile with optimistic locking and validated values', async () => {
    const owner = await as('owner');
    const s = (await owner.get('/api/v1/agency')).body.data;
    expect(s).toMatchObject({
      defaultCurrency: 'EGP',
      timeZone: 'Africa/Cairo',
      workingDays: [0, 1, 2, 3, 4],
    });
    const body = {
      version: s.version,
      name: 'Lumen Digital Studio',
      contactEmail: ' Hello@Lumen.TEST ',
      phone: '+20 100 000 0000',
      address: 'Maadi, Cairo',
      defaultCurrency: 'USD',
      timeZone: 'Africa/Cairo',
      workingDays: [4, 0, 1, 1, 2, 3],
    };
    const res = await owner.patch('/api/v1/agency', body);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({
      contactEmail: 'hello@lumen.test',
      defaultCurrency: 'USD',
      workingDays: [0, 1, 2, 3, 4],
      version: s.version + 1,
    });
    expect((await owner.patch('/api/v1/agency', body)).status).toBe(409);
    const bad = await owner.patch('/api/v1/agency', {
      ...body,
      version: s.version + 1,
      timeZone: 'Mars/Olympus',
      workingDays: [],
      defaultCurrency: 'XYZ',
    });
    expect(bad.status).toBe(422);
    expect(Object.keys(bad.body.error.fieldErrors).sort()).toEqual([
      'defaultCurrency',
      'timeZone',
      'workingDays',
    ]);
    // The session reflects the new profile on the next request.
    expect((await owner.get('/api/v1/auth/me')).body.data.agency.defaultCurrency).toBe('USD');
  });

  it('only owners and admins can read or change settings', async () => {
    for (const k of ['manager', 'salesA', 'finance']) {
      const u = await as(k);
      expect((await u.get('/api/v1/agency')).status).toBe(403);
      expect((await u.patch('/api/v1/agency', { version: 1 })).status).toBe(403);
    }
  });
});

/** Text drawn in an uncompressed PDF: decodes the hex strings inside every TJ array. */
function pdfStrings(buf: Buffer): string {
  const s = buf.toString('latin1');
  return [...s.matchAll(/\[(.*?)\] TJ/g)]
    .map((m) =>
      [...m[1]!.matchAll(/<([0-9a-f]+)>/g)]
        .map((h) => Buffer.from(h[1]!, 'hex').toString('latin1'))
        .join(''),
    )
    .join('\n');
}

describe('proposal PDF (FR-Q06)', () => {
  it('renders reference, totals, terms hash and dated acceptance, without internal data', async () => {
    const buf = await renderProposalPdf(
      {
        agency: {
          name: 'Lumen Studio',
          contactEmail: 'hello@lumen.test',
          phone: null,
          address: null,
        },
        clientName: 'Nile Bakery',
        reference: 'P-0042',
        content: {
          versionNo: 2,
          title: 'Ordering website',
          summary: 'Online ordering.',
          inclusions: 'Website',
          exclusions: 'Hosting',
          assumptions: null,
          milestones: null,
          paymentTerms: '50% upfront',
          terms: null,
          currency: 'EGP',
          expiresOn: '2099-01-31',
          discountBp: 1000,
          taxRateBp: 1400,
          taxLabel: 'VAT',
          items: [
            {
              id: 'i1',
              position: 0,
              serviceId: null,
              name: 'Design',
              description: null,
              unit: 'day',
              quantity: '3',
              quantityCenti: 300,
              unitPriceMinor: '150050',
              lineTotalMinor: '450150',
            },
          ],
          subtotalMinor: '450150',
          discountMinor: '45015',
          taxMinor: '56719',
          totalMinor: '461854',
        },
        contentHash: 'c'.repeat(64),
        statusLabel: 'Accepted',
        sentAt: new Date('2026-10-20T08:00:00Z'),
        acceptance: { by: 'Nadia Nasser', at: new Date('2026-10-21T09:30:00Z') },
        timeZone: 'Africa/Cairo',
      },
      { compress: false },
    );
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    const text = pdfStrings(buf).replace(/\u00a0/g, ' ');
    for (const expected of [
      'P-0042',
      'Ordering website',
      'Hosting',
      'EGP 4,618.54',
      'VAT 14% of EGP 4,051.35',
      'Accepted by Nadia Nasser on 21 Oct 2026, 12:30', // Cairo summer time (UTC+3)
      'c'.repeat(64),
    ]) {
      expect({ expected, found: text.includes(expected) }).toEqual({ expected, found: true });
    }
  });

  it('maps characters the built-in fonts cannot draw', () => {
    expect(pdfText('A − B')).toBe('A - B');
    expect(pdfText('Café €5')).toBe('Café €5');
    expect(pdfText('سلمى')).toBe('????');
  });

  it('staff download frozen versions only; portal users get their own organization’s PDF', async () => {
    const deal = await makeDeal(db, seeded.agencyId, id('salesA'));
    const org = await makeClientOrg(db, seeded.agencyId, deal.contactId);
    const sent = await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: deal.id,
      createdById: id('salesA'),
      status: 'SENT',
      clientOrgId: org.orgId,
    });
    const draft = await makeProposal(db, {
      agencyId: seeded.agencyId,
      dealId: deal.id,
      createdById: id('salesA'),
      status: 'DRAFT',
    });
    const a = await as('salesA');
    const ok = await a.get(`/api/v1/proposals/${sent.proposalId}/versions/1/pdf`);
    expect(ok.status).toBe(200);
    expect(ok.headers['content-type']).toBe('application/pdf');
    expect(ok.headers['content-disposition']).toMatch(/P-\d{4}-v1\.pdf/);
    expect((await a.get(`/api/v1/proposals/${draft.proposalId}/versions/1/pdf`)).status).toBe(409);
    expect(
      (await (await as('salesB')).get(`/api/v1/proposals/${sent.proposalId}/versions/1/pdf`))
        .status,
    ).toBe(404);

    const client = await as(org.clientEmail);
    const mine = await client.get(`/api/v1/portal/proposals/${sent.proposalId}/pdf`);
    expect(mine.status).toBe(200);
    expect(mine.headers['content-type']).toBe('application/pdf');
    expect((await client.get(`/api/v1/portal/proposals/${draft.proposalId}/pdf`)).status).toBe(404);
    const other = await makeDeal(db, seeded.agencyId, id('salesB'));
    const rival = await makeClientOrg(db, seeded.agencyId, other.contactId, {
      email: 'rival@x.test',
    });
    expect(
      (await (await as(rival.clientEmail)).get(`/api/v1/portal/proposals/${sent.proposalId}/pdf`))
        .status,
    ).toBe(404);
    expect((await a.get(`/api/v1/portal/proposals/${sent.proposalId}/pdf`)).status).toBe(403);
  });
});
