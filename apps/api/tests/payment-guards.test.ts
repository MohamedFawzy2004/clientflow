// Payment rules in the database (backend audit, batch 5, F11). The services already keep them;
// these tests write directly, as a bug, a script or a future service could, and expect a refusal.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { classifyDbError } from '../src/lib/db-errors.js';
import { resetDb, seedAgency, testDb, type SeededAgency } from './helpers.js';
import { makeClientOrg } from './proposal-fixtures.js';

const db = testDb();
let seeded: SeededAgency;
let financeId: string;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  financeId = seeded.users.finance!.id;
});
afterAll(() => db.$disconnect());

let number = 0;
async function issued(currency = 'EGP') {
  const contact = await db.contact.create({
    data: { agencyId: seeded.agencyId, ownerId: seeded.users.owner!.id, fullName: 'Client' },
  });
  const { orgId } = await makeClientOrg(db, seeded.agencyId, contact.id, {
    email: `c${++number}@client.test`,
  });
  return db.invoice.create({
    data: {
      agencyId: seeded.agencyId,
      clientOrgId: orgId,
      number,
      status: 'ISSUED',
      currency,
      dueOn: new Date('2099-01-31'),
      issuedOn: new Date('2026-10-01'),
      issuedAt: new Date('2026-10-01T08:00:00Z'),
      issuedById: financeId,
      subtotalMinor: 100_000n,
      taxMinor: 14_000n,
      totalMinor: 114_000n,
      createdById: financeId,
    },
  });
}

const payment = (
  invoiceId: string,
  extra: { amountMinor?: bigint; currency?: string; kind?: 'REVERSAL'; reversesId?: string } = {},
) =>
  db.payment.create({
    data: {
      agencyId: seeded.agencyId,
      invoiceId,
      amountMinor: 40_000n,
      currency: 'EGP',
      receivedOn: new Date('2026-10-05'),
      recordedById: financeId,
      ...extra,
    },
  });
const setPaid = (invoiceId: string, paidMinor: bigint) =>
  db.invoice.update({
    where: { id: invoiceId },
    data: { paidMinor, status: paidMinor === 0n ? 'ISSUED' : 'PARTIALLY_PAID' },
  });

const refused = async (p: Promise<unknown>, message: RegExp) => {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err, 'the database accepted it').not.toBeNull();
  expect(String((err as Error).message)).toMatch(message);
  expect(classifyDbError(err)).toBe('conflict'); // the API answers 409, never 500
};

describe('payment rules in the database (F11)', () => {
  it('a payment and its paid total, written together, are accepted', async () => {
    const inv = await issued();
    await db.$transaction([payment(inv.id), setPaid(inv.id, 40_000n)]);
    const [p] = await db.payment.findMany({ where: { invoiceId: inv.id } });
    await db.$transaction([
      payment(inv.id, { kind: 'REVERSAL', reversesId: p!.id }),
      setPaid(inv.id, 0n),
    ]);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paidMinor).toBe(0n);
  });

  it('a payment must be in the invoice currency', async () => {
    const inv = await issued('EGP');
    await refused(
      db.$transaction([payment(inv.id, { currency: 'USD' }), setPaid(inv.id, 40_000n)]),
      /does not match invoice currency/,
    );
  });

  it('a reversal must undo a payment of the same invoice, for the same amount', async () => {
    const a = await issued();
    const b = await issued();
    await db.$transaction([payment(a.id), setPaid(a.id, 40_000n)]);
    const [p] = await db.payment.findMany({ where: { invoiceId: a.id } });
    await refused(
      db.$transaction([
        payment(a.id, { kind: 'REVERSAL', reversesId: p!.id, amountMinor: 10_000n }),
        setPaid(a.id, 30_000n),
      ]),
      /reversal must undo one payment/,
    );
    await refused(
      db.$transaction([payment(b.id, { kind: 'REVERSAL', reversesId: p!.id }), setPaid(b.id, 0n)]),
      /reversal must undo one payment/,
    );
  });

  it('the paid total cannot drift from the payments, in either direction', async () => {
    const inv = await issued();
    // A paid total with no payment behind it.
    await refused(setPaid(inv.id, 40_000n), /records 40000 paid, but its payments add up to 0/);
    // A payment the paid total does not include.
    await refused(payment(inv.id), /records 0 paid, but its payments add up to 40000/);
    expect(await db.payment.count()).toBe(0);
    expect((await db.invoice.findUniqueOrThrow({ where: { id: inv.id } })).paidMinor).toBe(0n);
  });
});
