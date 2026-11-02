// Invoice tracking (FR-F01 – FR-F09, SEC-14, SEC-15). ClientFlow records invoices and confirmed
// payments; it never moves money. Every amount is BigInt minor units.
import { createHash } from 'node:crypto';
import {
  can,
  changeReference,
  computeProposalTotals,
  formatQuantity,
  invoiceReference,
  MAX_AMOUNT_MINOR,
  minorToDecimalString,
  parseMoneyToMinor,
  parsePercentToBp,
  parseQuantityToCenti,
  type BillableItems,
  type CostRateView,
  type Currency,
  type FinanceReport,
  type FinanceTotals,
  type InvoiceDetail,
  type InvoiceDisplayStatus,
  type InvoiceSummary,
  type PortalInvoiceDetail,
  type PortalInvoiceSummary,
  type ProjectFinance,
  type costRateSchema,
  type financeReportQuerySchema,
  type invoiceCreateSchema,
  type invoiceDraftSchema,
  type invoiceListQuerySchema,
  type paymentCreateSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { agencyToday, formatDateOnly, parseDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { csvCell, EXPORT_ROW_LIMIT } from '../insights/service.js';
import { canManage, findReadable, projectReadScope, type Tx } from '../projects/access.js';
import { logPortalDenied } from '../portal/scope.js';
import { DEFAULT_TAX_RATE_BP } from '../proposals/service.js';

const PAYMENT_SCOPE = 'invoice.payment';
const OPEN: Array<'ISSUED' | 'PARTIALLY_PAID'> = ['ISSUED', 'PARTIALLY_PAID'];

// ---------------------------------------------------------------------------
// Access (spec §1.1 "Manage invoice state": A for Owner/Admin/Finance, Read P for PM)
// ---------------------------------------------------------------------------

function invoiceScope(actor: AuthUser): Prisma.InvoiceWhereInput {
  if (can(actor.role, 'invoices.read.all')) return { agencyId: actor.agencyId };
  if (can(actor.role, 'invoices.read.project')) {
    return { agencyId: actor.agencyId, project: projectReadScope(actor) };
  }
  throw forbidden('Your role does not have access to invoices.');
}

function requireManage(actor: AuthUser) {
  if (!can(actor.role, 'invoices.manage'))
    throw forbidden('Only finance, an owner or an admin can change invoices.');
}

async function lockInvoice(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM invoices WHERE id = CAST(${id} AS uuid) FOR UPDATE`;
}

function displayStatus(
  i: { status: InvoiceSummary['status']; dueOn: Date; paidMinor: bigint; totalMinor: bigint },
  today: string,
): InvoiceDisplayStatus {
  if (
    OPEN.includes(i.status as 'ISSUED') &&
    formatDateOnly(i.dueOn) < today &&
    i.paidMinor < i.totalMinor
  ) {
    return 'OVERDUE';
  }
  return i.status;
}

/** OVERDUE as a query: open, balance left, due before today (agency timezone). */
function statusFilter(status: string | undefined, today: string): Prisma.InvoiceWhereInput {
  if (!status) return {};
  if (status === 'OVERDUE') return { status: { in: OPEN }, dueOn: { lt: parseDateOnly(today) } };
  return { status: status as InvoiceSummary['status'] };
}

async function agencyTz(db: Db | Tx, agencyId: string) {
  const a = await db.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { timezone: true },
  });
  return a.timezone;
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const summaryInclude = {
  clientOrg: { select: { id: true, name: true } },
  project: { select: { id: true, title: true } },
} as const satisfies Prisma.InvoiceInclude;
type SummaryRow = Prisma.InvoiceGetPayload<{ include: typeof summaryInclude }>;

function toSummary(i: SummaryRow, today: string): InvoiceSummary {
  return {
    id: i.id,
    reference: invoiceReference(i.number),
    number: i.number,
    status: i.status,
    displayStatus: displayStatus(i, today),
    clientOrg: i.clientOrg,
    project: i.project,
    currency: i.currency as Currency,
    dueOn: formatDateOnly(i.dueOn),
    issuedOn: i.issuedOn ? formatDateOnly(i.issuedOn) : null,
    totalMinor: i.totalMinor.toString(),
    paidMinor: i.paidMinor.toString(),
    balanceMinor: (i.status === 'VOID' ? 0n : i.totalMinor - i.paidMinor).toString(),
    published: i.publishedAt !== null,
    version: i.version,
  };
}

const detailInclude = {
  ...summaryInclude,
  items: { orderBy: { position: 'asc' } },
  payments: {
    orderBy: { createdAt: 'asc' },
    include: { recordedBy: { select: { name: true } }, reversedBy: { select: { id: true } } },
  },
} as const satisfies Prisma.InvoiceInclude;

export async function getInvoice(db: Db, actor: AuthUser, id: string): Promise<InvoiceDetail> {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const i = await db.invoice.findFirst({
    where: { AND: [invoiceScope(actor), { id }] },
    include: detailInclude,
  });
  if (!i) throw notFound();
  const today = agencyToday(new Date(), await agencyTz(db, actor.agencyId));
  const manage = can(actor.role, 'invoices.manage');
  return {
    ...toSummary(i, today),
    taxRateBp: i.taxRateBp,
    subtotalMinor: i.subtotalMinor.toString(),
    taxMinor: i.taxMinor.toString(),
    terms: i.terms,
    // The finance note stays with the people who manage invoices.
    internalNote: manage ? i.internalNote : null,
    billedTo: i.billedToName ? { name: i.billedToName, contact: i.billedToContact } : null,
    issuer: i.issuerName ? { name: i.issuerName, details: i.issuerDetails } : null,
    items: i.items.map((it) => ({
      id: it.id,
      position: it.position,
      description: it.description,
      quantity: formatQuantity(it.quantityCenti),
      quantityCenti: it.quantityCenti,
      unitPriceMinor: it.unitPriceMinor.toString(),
      lineTotalMinor: it.lineTotalMinor.toString(),
      source: it.source,
      sourceId: it.sourceId,
    })),
    payments: i.payments.map((p) => ({
      id: p.id,
      kind: p.kind,
      amountMinor: p.amountMinor.toString(),
      receivedOn: formatDateOnly(p.receivedOn),
      method: p.method,
      reference: p.reference,
      note: p.note,
      recordedBy: p.recordedBy.name,
      createdAt: p.createdAt.toISOString(),
      reversedBy: p.reversedBy?.id ?? null,
    })),
    voidReason: i.voidReason,
    access: {
      edit: manage && i.status === 'DRAFT',
      issue: manage && i.status === 'DRAFT',
      publish: manage && i.status !== 'DRAFT' && i.status !== 'VOID' && !i.publishedAt,
      void: manage && i.status !== 'VOID' && i.paidMinor === 0n,
      recordPayment: can(actor.role, 'payments.record') && OPEN.includes(i.status as 'ISSUED'),
    },
  };
}

export async function listInvoices(
  db: Db,
  actor: AuthUser,
  query: z.output<typeof invoiceListQuerySchema>,
) {
  const today = agencyToday(new Date(), await agencyTz(db, actor.agencyId));
  const rows = await db.invoice.findMany({
    where: {
      AND: [
        invoiceScope(actor),
        statusFilter(query.status, today),
        query.projectId ? { projectId: query.projectId } : {},
      ],
    },
    include: summaryInclude,
    orderBy: [{ createdAt: 'desc' }],
    take: 500,
  });
  return {
    invoices: rows.map((i) => toSummary(i, today)),
    access: { create: can(actor.role, 'invoices.manage') },
  };
}

/** Client organizations and their projects, for the New invoice form (names, ids, currency). */
export async function invoiceOptions(db: Db, actor: AuthUser) {
  requireManage(actor);
  const orgs = await db.clientOrganization.findMany({
    where: { agencyId: actor.agencyId, archivedAt: null },
    select: {
      id: true,
      name: true,
      projects: {
        where: { state: { not: 'ARCHIVED' } },
        select: { id: true, title: true, currency: true },
        orderBy: { title: 'asc' },
      },
    },
    orderBy: { name: 'asc' },
    take: 500,
  });
  return orgs;
}

// ---------------------------------------------------------------------------
// Drafts, issue, publish, void (FR-F01, FR-F02)
// ---------------------------------------------------------------------------

export async function createInvoice(
  db: Db,
  actor: AuthUser,
  input: z.output<typeof invoiceCreateSchema>,
  requestId: string,
) {
  requireManage(actor);
  const org = await db.clientOrganization.findFirst({
    where: { id: input.clientOrgId, agencyId: actor.agencyId, archivedAt: null },
  });
  if (!org) throw validationFailed({ clientOrgId: ['Choose an active client organization.'] });
  let project: { id: string; currency: string; taxRateBp: number | null } | null = null;
  if (input.projectId) {
    const p = await db.project.findFirst({
      where: { id: input.projectId, agencyId: actor.agencyId },
      include: { baselineVersion: { select: { taxRateBp: true } } },
    });
    if (!p || p.clientOrgId !== org.id) {
      throw validationFailed({ projectId: ['Choose a project of this client organization.'] });
    }
    project = { id: p.id, currency: p.currency, taxRateBp: p.baselineVersion?.taxRateBp ?? null };
    // A project's invoices use its currency, so its money is never mixed (spec §8.2).
    if (input.currency && input.currency !== p.currency) {
      throw validationFailed({ currency: [`This project is priced in ${p.currency}.`] });
    }
  }
  const agency = await db.agency.findUniqueOrThrow({ where: { id: actor.agencyId } });
  const inv = await db.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        agencyId: actor.agencyId,
        clientOrgId: org.id,
        projectId: project?.id ?? null,
        currency: project?.currency ?? input.currency ?? agency.defaultCurrency,
        taxRateBp: project?.taxRateBp ?? DEFAULT_TAX_RATE_BP,
        dueOn: parseDateOnly(input.dueOn),
        createdById: actor.id,
      },
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'invoice.create',
      outcome: 'SUCCESS',
      targetType: 'invoice',
      targetId: created.id,
      requestId,
    });
    return created;
  });
  return getInvoice(db, actor, inv.id);
}

async function findManageableDraft(tx: Tx, actor: AuthUser, id: string, version: number) {
  requireManage(actor);
  if (!UUID_PATTERN.test(id)) throw notFound();
  const found = await tx.invoice.findFirst({ where: { id, agencyId: actor.agencyId } });
  if (!found) throw notFound();
  await lockInvoice(tx, found.id);
  const i = await tx.invoice.findUniqueOrThrow({ where: { id: found.id } });
  if (i.version !== version) throw staleVersion();
  return i;
}

export async function saveInvoiceDraft(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof invoiceDraftSchema>,
) {
  await db.$transaction(async (tx) => {
    const i = await findManageableDraft(tx, actor, id, input.version);
    if (i.status !== 'DRAFT')
      throw conflict('Issued invoices cannot be edited. Void it and issue a new one.');
    const taxRateBp = parsePercentToBp(input.taxRatePercent)!;
    const currency = i.currency as Currency;
    const fieldErrors: Record<string, string[]> = {};
    const items = input.items.map((it, n) => {
      const unitPriceMinor = parseMoneyToMinor(it.unitPrice, currency);
      if (unitPriceMinor === null) fieldErrors[`items.${n}.unitPrice`] = ['Use a valid amount.'];
      return {
        ...it,
        quantityCenti: parseQuantityToCenti(it.quantity)!,
        unitPriceMinor: unitPriceMinor ?? '0',
      };
    });
    // Lines that bill a milestone or change must point at this invoice's project (J5 step 3).
    for (const [n, it] of items.entries()) {
      if (it.source === 'OTHER') continue;
      const ok =
        i.projectId &&
        (it.source === 'MILESTONE'
          ? await tx.projectMilestone.findFirst({
              where: { id: it.sourceId!, projectId: i.projectId },
            })
          : await tx.changeRequest.findFirst({
              where: { id: it.sourceId!, projectId: i.projectId, status: 'ACCEPTED' },
            }));
      if (!ok) {
        fieldErrors[`items.${n}.sourceId`] = [
          it.source === 'MILESTONE'
            ? 'Choose a milestone of this invoice’s project.'
            : 'Choose an accepted change of this invoice’s project.',
        ];
      }
    }
    if (Object.keys(fieldErrors).length) throw validationFailed(fieldErrors);
    const totals = computeProposalTotals({ items, discountBp: 0, taxRateBp });
    if (BigInt(totals.totalMinor) > MAX_AMOUNT_MINOR) {
      throw validationFailed({ items: ['This total is too large to store.'] });
    }
    await tx.invoiceItem.deleteMany({ where: { invoiceId: i.id } });
    if (items.length) {
      await tx.invoiceItem.createMany({
        data: items.map((it, n) => ({
          invoiceId: i.id,
          position: n,
          description: it.description,
          quantityCenti: it.quantityCenti,
          unitPriceMinor: BigInt(it.unitPriceMinor),
          lineTotalMinor: BigInt(totals.lineTotalsMinor[n]!),
          source: it.source,
          sourceId: it.source === 'OTHER' ? null : it.sourceId!,
        })),
      });
    }
    await tx.invoice.update({
      where: { id: i.id },
      data: {
        dueOn: parseDateOnly(input.dueOn),
        taxRateBp,
        terms: input.terms,
        internalNote: input.internalNote,
        subtotalMinor: BigInt(totals.subtotalMinor),
        taxMinor: BigInt(totals.taxMinor),
        totalMinor: BigInt(totals.totalMinor),
        version: { increment: 1 },
      },
    });
  });
  return getInvoice(db, actor, id);
}

/**
 * Issues a draft (FR-F02): the next agency-wide number, today's date, and a snapshot of who is
 * billed and who bills. From here on the content is frozen (DB trigger).
 */
export async function issueInvoice(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const i = await findManageableDraft(tx, actor, id, version);
    if (i.status !== 'DRAFT') throw conflict('This invoice was already issued.');
    const lines = await tx.invoiceItem.count({ where: { invoiceId: i.id } });
    if (lines === 0 || i.totalMinor <= 0n) {
      throw conflict('Add at least one line with an amount before issuing.');
    }
    // Numbers come from one atomic counter, so they are unique and without gaps.
    const agency = await tx.agency.update({
      where: { id: actor.agencyId },
      data: { invoiceSeq: { increment: 1 } },
    });
    const org = await tx.clientOrganization.findUniqueOrThrow({ where: { id: i.clientOrgId } });
    const contact = i.projectId
      ? ((
          await tx.project.findUniqueOrThrow({
            where: { id: i.projectId },
            select: { contact: { select: { fullName: true } } },
          })
        ).contact?.fullName ?? null)
      : null;
    const issuerDetails = [agency.address, agency.contactEmail, agency.phone]
      .filter(Boolean)
      .join('\n');
    const now = new Date();
    await tx.invoice.update({
      where: { id: i.id },
      data: {
        status: 'ISSUED',
        number: agency.invoiceSeq,
        issuedOn: parseDateOnly(agencyToday(now, agency.timezone)),
        issuedAt: now,
        issuedById: actor.id,
        billedToName: org.name,
        billedToContact: contact,
        issuerName: agency.name,
        issuerDetails: issuerDetails || null,
        version: { increment: 1 },
      },
    });
    const ref = invoiceReference(agency.invoiceSeq);
    if (i.projectId) {
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: i.projectId,
        eventType: 'invoice.issued',
        summary: `${actor.name} issued ${ref}`,
      });
    }
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'invoice.issue',
      outcome: 'SUCCESS',
      targetType: 'invoice',
      targetId: i.id,
      requestId,
      metadata: {
        number: agency.invoiceSeq,
        totalMinor: i.totalMinor.toString(),
        currency: i.currency,
      },
    });
  });
  return getInvoice(db, actor, id);
}

/** Makes an issued invoice visible to the client organization in the portal (FR-X03). */
export async function publishInvoice(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const i = await findManageableDraft(tx, actor, id, version);
    if (i.status === 'DRAFT') throw conflict('Issue the invoice before showing it to the client.');
    if (i.status === 'VOID') throw conflict('Void invoices are not shown to the client.');
    if (i.publishedAt) return; // already visible: idempotent
    await tx.invoice.update({
      where: { id: i.id },
      data: { publishedAt: new Date(), version: { increment: 1 } },
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'invoice.publish',
      outcome: 'SUCCESS',
      targetType: 'invoice',
      targetId: i.id,
      requestId,
    });
  });
  return getInvoice(db, actor, id);
}

/** Void keeps the invoice and its number as history (spec J5). Paid money must be reversed first. */
export async function voidInvoice(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  reason: string,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const i = await findManageableDraft(tx, actor, id, version);
    if (i.status === 'VOID') return;
    if (i.paidMinor > 0n) {
      throw conflict('Payments were recorded on this invoice. Reverse them before voiding it.');
    }
    await tx.invoice.update({
      where: { id: i.id },
      data: {
        status: 'VOID',
        voidedAt: new Date(),
        voidedById: actor.id,
        voidReason: reason,
        version: { increment: 1 },
      },
    });
    if (i.projectId) {
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: i.projectId,
        eventType: 'invoice.void',
        summary: `${actor.name} voided ${invoiceReference(i.number)}`,
        body: reason,
      });
    }
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'invoice.void',
      outcome: 'SUCCESS',
      targetType: 'invoice',
      targetId: i.id,
      requestId,
    });
  });
  return getInvoice(db, actor, id);
}

export async function deleteDraft(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const i = await findManageableDraft(tx, actor, id, version);
    if (i.status !== 'DRAFT') throw conflict('Issued invoices are kept; void them instead.');
    await tx.invoice.delete({ where: { id: i.id } });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'invoice.delete_draft',
      outcome: 'SUCCESS',
      targetType: 'invoice',
      targetId: i.id,
      requestId,
    });
  });
  return { deleted: true };
}

// ---------------------------------------------------------------------------
// Payments (FR-F03, FR-F04, T-PAY-01, US-14, US-18)
// ---------------------------------------------------------------------------

function statusFor(paid: bigint, total: bigint) {
  if (paid === 0n) return 'ISSUED' as const;
  return paid >= total ? ('PAID' as const) : ('PARTIALLY_PAID' as const);
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Records a confirmed payment. Additive and exact: the invoice row is locked, the amount may not
 * exceed the open balance (no overpayment, no negative balance), and the Idempotency-Key makes a
 * retried request return the same payment instead of a second one (SEC-15).
 */
export async function recordPayment(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  key: string,
  input: z.output<typeof paymentCreateSchema>,
  requestId: string,
): Promise<{ invoice: InvoiceDetail; replayed: boolean }> {
  const { db } = deps;
  if (!can(actor.role, 'payments.record')) {
    throw forbidden('Only finance or the owner can record payments.');
  }
  if (!UUID_PATTERN.test(id)) throw notFound();
  const hash = createHash('sha256')
    .update(
      JSON.stringify([
        id,
        input.amount,
        input.receivedOn,
        input.method,
        input.reference,
        input.note,
      ]),
    )
    .digest('hex');
  const replay = async (tx: Db | Tx) => {
    const rec = await tx.idempotencyRecord.findUnique({
      where: { agencyId_scope_key: { agencyId: actor.agencyId, scope: PAYMENT_SCOPE, key } },
    });
    if (!rec) return null;
    if (rec.requestHash !== hash || rec.actorId !== actor.id) {
      throw conflict('This Idempotency-Key was already used for a different payment.');
    }
    return rec.resultId;
  };
  if (await replay(db)) return { invoice: await getInvoice(db, actor, id), replayed: true };

  try {
    await db.$transaction(async (tx) => {
      const found = await tx.invoice.findFirst({ where: { id, agencyId: actor.agencyId } });
      if (!found) throw notFound();
      await lockInvoice(tx, found.id);
      if (await replay(tx)) return;
      const i = await tx.invoice.findUniqueOrThrow({ where: { id: found.id } });
      if (!OPEN.includes(i.status as 'ISSUED')) {
        throw conflict(
          i.status === 'PAID'
            ? 'This invoice is fully paid.'
            : 'Payments can only be recorded on issued invoices.',
        );
      }
      const currency = i.currency as Currency;
      const amount = BigInt(parseMoneyToMinor(input.amount, currency) ?? '0');
      if (amount <= 0n) throw validationFailed({ amount: ['Enter an amount above 0.'] });
      const balance = i.totalMinor - i.paidMinor;
      if (amount > balance) {
        throw conflict(
          `The open balance is ${minorToDecimalString(balance, currency)} ${currency}. Overpayments are not recorded: agree a refund or credit with the client and record only what settles this invoice.`,
        );
      }
      const tz = await agencyTz(tx, actor.agencyId);
      if (input.receivedOn > agencyToday(new Date(), tz)) {
        throw validationFailed({ receivedOn: ['Record payments once they are received.'] });
      }
      const p = await tx.payment.create({
        data: {
          agencyId: actor.agencyId,
          invoiceId: i.id,
          amountMinor: amount,
          currency,
          receivedOn: parseDateOnly(input.receivedOn),
          method: input.method,
          reference: input.reference,
          note: input.note,
          recordedById: actor.id,
        },
      });
      const paid = i.paidMinor + amount;
      await tx.invoice.update({
        where: { id: i.id },
        data: { paidMinor: paid, status: statusFor(paid, i.totalMinor), version: { increment: 1 } },
      });
      if (i.projectId) {
        await recordActivity(tx, actor, {
          entityType: 'project',
          entityId: i.projectId,
          eventType: 'invoice.payment',
          summary: `${actor.name} recorded a payment on ${invoiceReference(i.number)}`,
        });
      }
      await writeAudit(tx, {
        agencyId: actor.agencyId,
        actorId: actor.id,
        action: 'payment.record',
        outcome: 'SUCCESS',
        targetType: 'invoice',
        targetId: i.id,
        requestId,
        metadata: { amountMinor: amount.toString(), currency, paymentId: p.id },
      });
      await tx.idempotencyRecord.create({
        data: {
          agencyId: actor.agencyId,
          actorId: actor.id,
          scope: PAYMENT_SCOPE,
          key,
          requestHash: hash,
          resultId: p.id,
        },
      });
    });
  } catch (err) {
    // A concurrent request with the same key committed first: answer with its result.
    if (!isUniqueViolation(err)) throw err;
    if (!(await replay(db))) throw err;
    return { invoice: await getInvoice(db, actor, id), replayed: true };
  }
  return { invoice: await getInvoice(db, actor, id), replayed: false };
}

/** Undoes one payment with an equal reversal row (payments are never edited or deleted). */
export async function reversePayment(
  db: Db,
  actor: AuthUser,
  invoiceId: string,
  paymentId: string,
  reason: string,
  requestId: string,
) {
  if (!can(actor.role, 'payments.record')) {
    throw forbidden('Only finance or the owner can change payments.');
  }
  if (!UUID_PATTERN.test(invoiceId) || !UUID_PATTERN.test(paymentId)) throw notFound();
  try {
    await db.$transaction(async (tx) => {
      const found = await tx.invoice.findFirst({
        where: { id: invoiceId, agencyId: actor.agencyId },
      });
      if (!found) throw notFound();
      await lockInvoice(tx, found.id);
      const i = await tx.invoice.findUniqueOrThrow({ where: { id: found.id } });
      const p = await tx.payment.findFirst({
        where: { id: paymentId, invoiceId: i.id, kind: 'PAYMENT' },
        include: { reversedBy: true },
      });
      if (!p) throw notFound();
      if (p.reversedBy) return; // already reversed: idempotent
      const tz = await agencyTz(tx, actor.agencyId);
      await tx.payment.create({
        data: {
          agencyId: actor.agencyId,
          invoiceId: i.id,
          kind: 'REVERSAL',
          amountMinor: p.amountMinor,
          currency: p.currency,
          receivedOn: parseDateOnly(agencyToday(new Date(), tz)),
          method: p.method,
          reference: p.reference,
          note: reason,
          reversesId: p.id,
          recordedById: actor.id,
        },
      });
      const paid = i.paidMinor - p.amountMinor;
      await tx.invoice.update({
        where: { id: i.id },
        data: { paidMinor: paid, status: statusFor(paid, i.totalMinor), version: { increment: 1 } },
      });
      await writeAudit(tx, {
        agencyId: actor.agencyId,
        actorId: actor.id,
        action: 'payment.reverse',
        outcome: 'SUCCESS',
        targetType: 'invoice',
        targetId: i.id,
        requestId,
        metadata: { paymentId: p.id, amountMinor: p.amountMinor.toString() },
      });
    });
  } catch (err) {
    // Two reversals raced for the same payment: the unique link let one through.
    if (!isUniqueViolation(err)) throw err;
  }
  return getInvoice(db, actor, invoiceId);
}

// ---------------------------------------------------------------------------
// Project money and cost (FR-F05 – FR-F07, US-23)
// ---------------------------------------------------------------------------

/**
 * Time cost: minutes × the person's rate in effect on that day, rounded half up once at the
 * end. Rates in another currency are left out and counted as missing: amounts in different
 * currencies are never added (spec §8.2).
 */
async function timeCost(db: Db | Tx, projectId: string, currency: string) {
  const entries = await db.timeEntry.findMany({
    where: { projectId },
    select: { userId: true, minutes: true, workedOn: true, user: { select: { name: true } } },
  });
  const userIds = [...new Set(entries.map((e) => e.userId))];
  const rates = await db.costRate.findMany({
    where: { userId: { in: userIds } },
    orderBy: { effectiveFrom: 'desc' },
  });
  let minuteMinor = 0n; // Σ minutes × hourly, divided by 60 at the end
  let costed = 0;
  let total = 0;
  const missing = new Set<string>();
  for (const e of entries) {
    total += e.minutes;
    const rate = rates.find((r) => r.userId === e.userId && r.effectiveFrom <= e.workedOn);
    if (!rate || rate.currency !== currency) {
      missing.add(e.user.name);
      continue;
    }
    costed += e.minutes;
    minuteMinor += BigInt(e.minutes) * rate.hourlyMinor;
  }
  return {
    estimatedMinor: (minuteMinor + 30n) / 60n,
    minutesCosted: costed,
    minutesTotal: total,
    completenessPercent: total === 0 ? 100 : Math.floor((costed * 100) / total),
    missingRates: [...missing].sort(),
  };
}

export async function getBillable(db: Db | Tx, projectId: string): Promise<BillableItems> {
  const p = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    include: {
      milestones: { orderBy: { sequence: 'asc' } },
      changeRequests: {
        where: { status: 'ACCEPTED' },
        include: { acceptedVersion: { select: { priceMinor: true } } },
        orderBy: { number: 'asc' },
      },
    },
  });
  const billed = await db.invoiceItem.findMany({
    where: {
      invoice: { projectId, status: { notIn: ['DRAFT', 'VOID'] } },
      source: { not: 'OTHER' },
    },
    select: { sourceId: true },
  });
  const invoiced = new Set(billed.map((b) => b.sourceId));
  const agg = await db.invoice.aggregate({
    where: { projectId, status: { notIn: ['DRAFT', 'VOID'] } },
    _sum: { subtotalMinor: true },
  });
  return {
    currency: p.currency as Currency,
    budgetMinor: p.budgetMinor.toString(),
    invoicedMinor: (agg._sum.subtotalMinor ?? 0n).toString(),
    milestones: p.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      invoiced: invoiced.has(m.id),
    })),
    changes: p.changeRequests.map((c) => ({
      id: c.id,
      reference: changeReference(c.number),
      title: c.title,
      priceMinor: (c.acceptedVersion?.priceMinor ?? 0n).toString(),
      invoiced: invoiced.has(c.id),
    })),
  };
}

export async function getProjectFinance(
  db: Db,
  actor: AuthUser,
  projectId: string,
): Promise<ProjectFinance> {
  const full = can(actor.role, 'finance.view');
  if (!full && !can(actor.role, 'projects.manage')) {
    throw forbidden('Project money is for finance and the project manager.');
  }
  if (!UUID_PATTERN.test(projectId)) throw notFound();
  // Finance reads every project; a PM only the ones they manage (spec §1.1 "P estimate only").
  const p = full
    ? await db.project.findFirst({ where: { id: projectId, agencyId: actor.agencyId } })
    : await findReadable(db, actor, projectId);
  if (!p) throw notFound();
  if (!full && !canManage(actor, p)) {
    throw forbidden('Only the project manager sees the project estimate.');
  }
  const issued = await db.invoice.aggregate({
    where: { projectId: p.id, status: { notIn: ['DRAFT', 'VOID'] } },
    _sum: { subtotalMinor: true, totalMinor: true, paidMinor: true },
  });
  const cost = await timeCost(db, p.id, p.currency);
  const invoicedTotal = issued._sum.totalMinor ?? 0n;
  const received = issued._sum.paidMinor ?? 0n;
  return {
    currency: p.currency as Currency,
    expectedMinor: p.budgetMinor.toString(),
    invoicedMinor: (issued._sum.subtotalMinor ?? 0n).toString(),
    invoicedTotalMinor: invoicedTotal.toString(),
    receivedMinor: received.toString(),
    outstandingMinor: (invoicedTotal - received).toString(),
    cost: { ...cost, estimatedMinor: cost.estimatedMinor.toString() },
    estimatedMarginMinor: (p.budgetMinor - cost.estimatedMinor).toString(),
    scope: full ? 'full' : 'estimate',
    billable: full ? await getBillable(db, p.id) : null,
  };
}

// ---------------------------------------------------------------------------
// Cost rates (FR-F06, FR-A06)
// ---------------------------------------------------------------------------

export async function listCostRates(db: Db, actor: AuthUser): Promise<CostRateView[]> {
  if (!can(actor.role, 'finance.view')) throw forbidden('Cost rates are for finance and admins.');
  const users = await db.user.findMany({
    where: { agencyId: actor.agencyId, role: { not: 'CLIENT' } },
    include: {
      costRates: {
        orderBy: { effectiveFrom: 'desc' },
        include: { setBy: { select: { name: true } } },
      },
    },
    orderBy: { name: 'asc' },
  });
  const today = agencyToday(new Date(), await agencyTz(db, actor.agencyId));
  return users.map((u) => {
    const current = u.costRates.find((r) => formatDateOnly(r.effectiveFrom) <= today) ?? null;
    return {
      user: { id: u.id, name: u.name, role: u.role },
      current: current
        ? {
            hourlyMinor: current.hourlyMinor.toString(),
            currency: current.currency as Currency,
            effectiveFrom: formatDateOnly(current.effectiveFrom),
          }
        : null,
      history: u.costRates.map((r) => ({
        hourlyMinor: r.hourlyMinor.toString(),
        currency: r.currency as Currency,
        effectiveFrom: formatDateOnly(r.effectiveFrom),
        setBy: r.setBy.name,
      })),
    };
  });
}

/** Sets a rate from a date on; the same date replaces that row. Every change is audited (FR-A06). */
export async function setCostRate(
  db: Db,
  actor: AuthUser,
  userId: string,
  input: z.output<typeof costRateSchema>,
  requestId: string,
) {
  if (!can(actor.role, 'costs.manage')) throw forbidden('Only an owner or admin sets cost rates.');
  if (!UUID_PATTERN.test(userId)) throw notFound();
  const u = await db.user.findFirst({
    where: { id: userId, agencyId: actor.agencyId, role: { not: 'CLIENT' } },
  });
  if (!u) throw notFound();
  const hourly = parseMoneyToMinor(input.hourly, input.currency);
  if (hourly === null) throw validationFailed({ hourly: ['Use a valid amount.'] });
  const effectiveFrom = parseDateOnly(input.effectiveFrom);
  await db.$transaction(async (tx) => {
    await tx.costRate.upsert({
      where: { userId_effectiveFrom: { userId: u.id, effectiveFrom } },
      create: {
        agencyId: actor.agencyId,
        userId: u.id,
        hourlyMinor: BigInt(hourly),
        currency: input.currency,
        effectiveFrom,
        setById: actor.id,
      },
      update: { hourlyMinor: BigInt(hourly), currency: input.currency, setById: actor.id },
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'cost_rate.set',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: u.id,
      requestId,
      metadata: {
        hourlyMinor: hourly,
        currency: input.currency,
        effectiveFrom: input.effectiveFrom,
      },
    });
  });
  return listCostRates(db, actor);
}

// ---------------------------------------------------------------------------
// Finance report and export (FR-F08, FR-F09, T-ACL-05)
// ---------------------------------------------------------------------------

function reportWhere(q: z.output<typeof financeReportQuerySchema>, actor: AuthUser, today: string) {
  return {
    AND: [
      { agencyId: actor.agencyId, status: { not: 'DRAFT' as const } },
      statusFilter(q.status, today),
      q.from ? { issuedOn: { gte: parseDateOnly(q.from) } } : {},
      q.to ? { issuedOn: { lte: parseDateOnly(q.to) } } : {},
      q.projectId ? { projectId: q.projectId } : {},
      q.managerId ? { project: { managerId: q.managerId } } : {},
    ],
  } satisfies Prisma.InvoiceWhereInput;
}

export async function getFinanceReport(
  db: Db,
  actor: AuthUser,
  q: z.output<typeof financeReportQuerySchema>,
): Promise<FinanceReport> {
  if (!can(actor.role, 'finance.view'))
    throw forbidden('Finance reports are for finance and admins.');
  const today = agencyToday(new Date(), await agencyTz(db, actor.agencyId));
  const rows = await db.invoice.findMany({
    where: reportWhere(q, actor, today),
    include: summaryInclude,
    orderBy: [{ issuedOn: 'desc' }, { number: 'desc' }],
    take: EXPORT_ROW_LIMIT,
  });
  const byCurrency = new Map<string, FinanceTotals & { _raw: Record<string, bigint> }>();
  for (const i of rows) {
    if (i.status === 'VOID') continue;
    const t =
      byCurrency.get(i.currency) ??
      ({
        currency: i.currency as Currency,
        invoiced: { count: 0, totalMinor: '0' },
        receivedMinor: '0',
        outstandingMinor: '0',
        overdue: { count: 0, balanceMinor: '0' },
        aging: { current: '0', d1to30: '0', d31to60: '0', d61to90: '0', over90: '0' },
        _raw: {
          total: 0n,
          received: 0n,
          open: 0n,
          overdue: 0n,
          current: 0n,
          d1to30: 0n,
          d31to60: 0n,
          d61to90: 0n,
          over90: 0n,
        },
      } as FinanceTotals & { _raw: Record<string, bigint> });
    const balance = i.totalMinor - i.paidMinor;
    t.invoiced.count += 1;
    t._raw.total! += i.totalMinor;
    t._raw.received! += i.paidMinor;
    t._raw.open! += balance;
    if (balance > 0n) {
      const due = formatDateOnly(i.dueOn);
      const late = Math.round((Date.parse(today) - Date.parse(due)) / 86_400_000);
      const bucket =
        late <= 0
          ? 'current'
          : late <= 30
            ? 'd1to30'
            : late <= 60
              ? 'd31to60'
              : late <= 90
                ? 'd61to90'
                : 'over90';
      t._raw[bucket]! += balance;
      if (late > 0) {
        t.overdue.count += 1;
        t._raw.overdue! += balance;
      }
    }
    byCurrency.set(i.currency, t);
  }
  const totals: FinanceTotals[] = [...byCurrency.values()].map(({ _raw, ...t }) => ({
    ...t,
    invoiced: { count: t.invoiced.count, totalMinor: _raw.total!.toString() },
    receivedMinor: _raw.received!.toString(),
    outstandingMinor: _raw.open!.toString(),
    overdue: { count: t.overdue.count, balanceMinor: _raw.overdue!.toString() },
    aging: {
      current: _raw.current!.toString(),
      d1to30: _raw.d1to30!.toString(),
      d31to60: _raw.d31to60!.toString(),
      d61to90: _raw.d61to90!.toString(),
      over90: _raw.over90!.toString(),
    },
  }));
  return {
    totals,
    invoices: rows.map((i) => toSummary(i, today)),
    filters: { from: q.from ?? null, to: q.to ?? null },
  };
}

export async function exportInvoicesCsv(
  db: Db,
  actor: AuthUser,
  q: z.output<typeof financeReportQuerySchema>,
  requestId: string,
) {
  if (!can(actor.role, 'finance.view'))
    throw forbidden('Finance exports are for finance and admins.');
  const today = agencyToday(new Date(), await agencyTz(db, actor.agencyId));
  const rows = await db.invoice.findMany({
    where: reportWhere(q, actor, today),
    include: summaryInclude,
    orderBy: [{ number: 'asc' }],
    take: EXPORT_ROW_LIMIT,
  });
  const header = [
    'Invoice',
    'Status',
    'Client',
    'Project',
    'Issued',
    'Due',
    'Currency',
    'Subtotal',
    'Tax',
    'Total',
    'Paid',
    'Balance',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const i of rows) {
    const c = i.currency as Currency;
    const money = (m: bigint) => minorToDecimalString(m, c);
    lines.push(
      [
        invoiceReference(i.number),
        displayStatus(i, today),
        i.clientOrg.name,
        i.project?.title ?? '',
        i.issuedOn ? formatDateOnly(i.issuedOn) : '',
        formatDateOnly(i.dueOn),
        c,
        money(i.subtotalMinor),
        money(i.taxMinor),
        money(i.totalMinor),
        money(i.paidMinor),
        money(i.status === 'VOID' ? 0n : i.totalMinor - i.paidMinor),
      ]
        .map(csvCell)
        .join(','),
    );
  }
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'export.invoices',
    outcome: 'SUCCESS',
    requestId,
    metadata: { rows: rows.length, from: q.from ?? null, to: q.to ?? null },
  });
  return {
    filename: `invoices-${q.from ?? 'all'}-to-${q.to ?? today}.csv`,
    body: `\uFEFF${lines.join('\r\n')}\r\n`,
    rows: rows.length,
  };
}

// ---------------------------------------------------------------------------
// Client portal (FR-X03): published invoices of the client's own organization
// ---------------------------------------------------------------------------

function portalInvoiceScope(actor: AuthUser): Prisma.InvoiceWhereInput {
  if (actor.role !== 'CLIENT' || !actor.clientOrgId) throw forbidden();
  return {
    agencyId: actor.agencyId,
    clientOrgId: actor.clientOrgId,
    publishedAt: { not: null },
    status: { in: ['ISSUED', 'PARTIALLY_PAID', 'PAID'] },
  };
}

function toPortalSummary(i: SummaryRow, today: string): PortalInvoiceSummary {
  return {
    id: i.id,
    reference: invoiceReference(i.number),
    displayStatus: displayStatus(i, today),
    project: i.project,
    currency: i.currency as Currency,
    issuedOn: formatDateOnly(i.issuedOn!),
    dueOn: formatDateOnly(i.dueOn),
    totalMinor: i.totalMinor.toString(),
    paidMinor: i.paidMinor.toString(),
    balanceMinor: (i.totalMinor - i.paidMinor).toString(),
  };
}

export async function listPortalInvoices(db: Db, actor: AuthUser) {
  const rows = await db.invoice.findMany({
    where: portalInvoiceScope(actor),
    include: summaryInclude,
    orderBy: [{ issuedOn: 'desc' }],
    take: 200,
  });
  const today = agencyToday(new Date(), await agencyTz(db, actor.agencyId));
  return rows.map((i) => toPortalSummary(i, today));
}

export async function getPortalInvoice(
  db: Db,
  actor: AuthUser,
  id: string,
  requestId: string,
): Promise<PortalInvoiceDetail> {
  const scope = portalInvoiceScope(actor);
  const i = UUID_PATTERN.test(id)
    ? await db.invoice.findFirst({
        where: { AND: [scope, { id }] },
        include: {
          ...summaryInclude,
          items: { orderBy: { position: 'asc' } },
          payments: { include: { reversedBy: true } },
        },
      })
    : null;
  if (!i) {
    await logPortalDenied(db, actor, 'invoice', id, requestId);
    throw notFound();
  }
  const today = agencyToday(new Date(), await agencyTz(db, actor.agencyId));
  return {
    ...toPortalSummary(i, today),
    taxRateBp: i.taxRateBp,
    subtotalMinor: i.subtotalMinor.toString(),
    taxMinor: i.taxMinor.toString(),
    terms: i.terms,
    billedTo: { name: i.billedToName!, contact: i.billedToContact },
    issuer: { name: i.issuerName!, details: i.issuerDetails },
    items: i.items.map((it) => ({
      description: it.description,
      quantity: formatQuantity(it.quantityCenti),
      unitPriceMinor: it.unitPriceMinor.toString(),
      lineTotalMinor: it.lineTotalMinor.toString(),
    })),
    // Received money only: reversed payments and reversal rows are internal corrections.
    payments: i.payments
      .filter((p) => p.kind === 'PAYMENT' && !p.reversedBy)
      .sort((a, b) => a.receivedOn.getTime() - b.receivedOn.getTime())
      .map((p) => ({
        receivedOn: formatDateOnly(p.receivedOn),
        amountMinor: p.amountMinor.toString(),
        method: p.method,
      })),
  };
}
