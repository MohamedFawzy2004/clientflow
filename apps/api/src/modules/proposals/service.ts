import {
  can,
  computeProposalTotals,
  MAX_PROPOSAL_TOTAL_MINOR,
  parseMoneyToMinor,
  parsePercentToBp,
  parseQuantityToCenti,
  type internalReviewSchema,
  type proposalDraftUpdateSchema,
  proposalReference,
  type Currency,
  type ProposalCreateInput,
  type ProposalDetail,
  type ProposalStatus,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { addDays, agencyToday, parseDateOnly, formatDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { dealReadScope } from '../deals/policy.js';
import {
  contentHash,
  proposalInclude,
  toProposalSummary,
  toVersionContent,
  toVersionListItem,
  toVersionView,
  versionInclude,
} from './serializer.js';

type Tx = Prisma.TransactionClient;
type DraftUpdate = z.output<typeof proposalDraftUpdateSchema>;

export const DEFAULT_TAX_RATE_BP = 1400;
export const DEFAULT_VALIDITY_DAYS = 30;
const OPEN_STATUSES: ProposalStatus[] = ['DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL'];

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

/** Proposals follow their deal: managers see the agency, salespeople the deals they own. */
export function proposalReadScope(actor: AuthUser): Prisma.ProposalWhereInput {
  if (can(actor.role, 'proposals.read.all')) return { agencyId: actor.agencyId };
  if (can(actor.role, 'proposals.read.own')) {
    return { agencyId: actor.agencyId, deal: { ownerId: actor.id } };
  }
  throw forbidden('Your role does not have access to proposals.');
}

function assertCanWrite(actor: AuthUser) {
  if (!can(actor.role, 'proposals.write')) throw forbidden('Your role cannot change proposals.');
}

async function findReadable(db: Db | Tx, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const p = await db.proposal.findFirst({
    where: { AND: [proposalReadScope(actor), { id }] },
    include: proposalInclude,
  });
  if (!p) throw notFound();
  return p;
}

/**
 * Serializes every workflow change on one proposal (edit, review, send, revise, client decision)
 * with a row lock, so concurrent requests see each other's results (T-PROP-03 pattern).
 */
export async function lockProposal(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM proposals WHERE id = CAST(${id} AS uuid) FOR UPDATE`;
}

async function agencyTodayFor(db: Db | Tx, agencyId: string) {
  const agency = await db.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { timezone: true },
  });
  return agencyToday(new Date(), agency.timezone);
}

async function recordOnDeal(
  tx: Tx,
  actor: AuthUser,
  dealId: string,
  eventType: string,
  summary: string,
  body?: string | null,
) {
  await recordActivity(tx, actor, {
    entityType: 'deal',
    entityId: dealId,
    eventType,
    summary,
    body,
  });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listProposals(
  db: Db,
  actor: AuthUser,
  query: { status?: ProposalStatus | undefined; dealId?: string | undefined },
) {
  const filters: Prisma.ProposalWhereInput[] = [proposalReadScope(actor)];
  if (query.status) filters.push({ status: query.status });
  if (query.dealId) filters.push({ dealId: query.dealId });
  const rows = await db.proposal.findMany({
    where: { AND: filters },
    include: proposalInclude,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  const today = await agencyTodayFor(db, actor.agencyId);
  return rows.map((p) => toProposalSummary(p, today));
}

async function loadVersion(db: Db | Tx, proposalId: string, versionNo: number) {
  const v = await db.proposalVersion.findUnique({
    where: { proposalId_versionNo: { proposalId, versionNo } },
    include: versionInclude,
  });
  if (!v) throw notFound();
  return v;
}

export async function getProposal(db: Db, actor: AuthUser, id: string): Promise<ProposalDetail> {
  const p = await findReadable(db, actor, id);
  const today = await agencyTodayFor(db, actor.agencyId);
  // Default view: the version being worked on, else the accepted one, else the newest.
  const open = p.versions.find((v) => OPEN_STATUSES.includes(v.status));
  const accepted = p.versions.find((v) => v.status === 'ACCEPTED');
  const shown = open ?? accepted ?? p.versions[0]!;
  const current = await loadVersion(db, p.id, shown.versionNo);

  let clientOrg: ProposalDetail['clientOrg'] = null;
  const orgId = p.clientOrgId ?? p.deal.contact.clientOrgId;
  if (orgId) {
    const org = await db.clientOrganization.findFirst({
      where: { id: orgId, agencyId: actor.agencyId },
      select: {
        id: true,
        name: true,
        _count: { select: { portalUsers: { where: { active: true } } } },
      },
    });
    if (org) clientOrg = { id: org.id, name: org.name, activePortalUsers: org._count.portalUsers };
  }

  return {
    ...toProposalSummary(p, today),
    versions: p.versions.map((v) => toVersionListItem(v, today)),
    current: toVersionView(current, today),
    clientOrg,
  };
}

export async function getProposalVersion(db: Db, actor: AuthUser, id: string, versionNo: number) {
  const p = await findReadable(db, actor, id);
  const today = await agencyTodayFor(db, actor.agencyId);
  return toVersionView(await loadVersion(db, p.id, versionNo), today);
}

// ---------------------------------------------------------------------------
// Create, edit, revise
// ---------------------------------------------------------------------------

export async function createProposal(
  { db }: AppDeps,
  actor: AuthUser,
  input: ProposalCreateInput,
  requestId: string,
) {
  assertCanWrite(actor);
  // A deal the user cannot see answers exactly like an unknown deal.
  const deal = await db.deal.findFirst({
    where: { AND: [dealReadScope(actor), { id: input.dealId }] },
    select: { id: true, title: true, currency: true, status: true },
  });
  if (!deal) throw validationFailed({ dealId: ['Choose a deal you can see.'] });
  if (deal.status !== 'OPEN') throw conflict('Proposals can only be created for open deals.');

  const today = await agencyTodayFor(db, actor.agencyId);
  const id = await db.$transaction(async (tx) => {
    // Atomic per-agency counter: concurrent creates never get the same reference number.
    const { proposalSeq } = await tx.agency.update({
      where: { id: actor.agencyId },
      data: { proposalSeq: { increment: 1 } },
      select: { proposalSeq: true },
    });
    const proposal = await tx.proposal.create({
      data: {
        agencyId: actor.agencyId,
        dealId: deal.id,
        number: proposalSeq,
        createdById: actor.id,
        versions: {
          // agency_id comes from the parent through the composite relation.
          create: {
            versionNo: 1,
            title: input.title ?? deal.title,
            currency: deal.currency,
            expiresOn: parseDateOnly(addDays(today, DEFAULT_VALIDITY_DAYS)),
            taxRateBp: DEFAULT_TAX_RATE_BP,
            createdById: actor.id,
          },
        },
      },
    });
    await recordOnDeal(
      tx,
      actor,
      deal.id,
      'proposal.created',
      `Proposal ${proposalReference(proposalSeq)} created by ${actor.name}`,
    );
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'proposal.create',
      outcome: 'SUCCESS',
      targetType: 'proposal',
      targetId: proposal.id,
      requestId,
    });
    return proposal.id;
  });
  return getProposal(db, actor, id);
}

/** Converts validated form input into stored rows with exact totals, using the version currency. */
async function buildDraft(tx: Tx, actor: AuthUser, currency: Currency, input: DraftUpdate) {
  const fieldErrors: Record<string, string[]> = {};
  const items = input.items.map((item, i) => {
    const quantityCenti = parseQuantityToCenti(item.quantity);
    const unitPriceMinor = parseMoneyToMinor(item.unitPrice, currency);
    if (quantityCenti === null) fieldErrors[`items.${i}.quantity`] = ['Check the quantity.'];
    if (unitPriceMinor === null) fieldErrors[`items.${i}.unitPrice`] = ['Check the price.'];
    return {
      ...item,
      position: i,
      quantityCenti: quantityCenti ?? 0,
      unitPriceMinor: unitPriceMinor ?? '0',
    };
  });
  const discountBp = parsePercentToBp(input.discountPercent);
  const taxRateBp = parsePercentToBp(input.taxRatePercent);
  if (discountBp === null) fieldErrors.discountPercent = ['Use 0 to 100.'];
  if (taxRateBp === null) fieldErrors.taxRatePercent = ['Use 0 to 100.'];

  const serviceIds = [...new Set(items.map((i) => i.serviceId).filter((s): s is string => !!s))];
  if (serviceIds.length > 0) {
    const found = await tx.serviceItem.count({
      where: { id: { in: serviceIds }, agencyId: actor.agencyId },
    });
    if (found !== serviceIds.length)
      fieldErrors.items = ['A catalog service on this proposal no longer exists.'];
  }
  if (Object.keys(fieldErrors).length > 0) throw validationFailed(fieldErrors);

  const totals = computeProposalTotals({ items, discountBp: discountBp!, taxRateBp: taxRateBp! });
  if (BigInt(totals.totalMinor) > MAX_PROPOSAL_TOTAL_MINOR) {
    throw validationFailed({ items: ['The total is larger than ClientFlow can store.'] });
  }
  return {
    data: {
      title: input.title,
      summary: input.summary,
      inclusions: input.inclusions,
      exclusions: input.exclusions,
      assumptions: input.assumptions,
      milestones: input.milestones,
      paymentTerms: input.paymentTerms,
      terms: input.terms,
      internalNotes: input.internalNotes,
      expiresOn: parseDateOnly(input.expiresOn),
      discountBp: discountBp!,
      taxRateBp: taxRateBp!,
      taxLabel: input.taxLabel,
      subtotalMinor: BigInt(totals.subtotalMinor),
      discountMinor: BigInt(totals.discountMinor),
      taxMinor: BigInt(totals.taxMinor),
      totalMinor: BigInt(totals.totalMinor),
    },
    items: items.map((item, i) => ({
      position: i,
      serviceId: item.serviceId ?? null,
      name: item.name,
      description: item.description,
      unit: item.unit,
      quantityCenti: item.quantityCenti,
      unitPriceMinor: BigInt(item.unitPriceMinor),
      lineTotalMinor: BigInt(totals.lineTotalsMinor[i]!),
    })),
  };
}

/** The single version currently being prepared, locked by the caller. */
async function openVersion(tx: Tx, proposalId: string) {
  return tx.proposalVersion.findFirst({
    where: { proposalId, status: { in: OPEN_STATUSES } },
    include: versionInclude,
  });
}

export async function updateDraft(
  { db }: AppDeps,
  actor: AuthUser,
  id: string,
  input: DraftUpdate,
  requestId: string,
) {
  assertCanWrite(actor);
  const p = await findReadable(db, actor, id);
  await db.$transaction(async (tx) => {
    await lockProposal(tx, p.id);
    const v = await openVersion(tx, p.id);
    if (!v || v.status !== 'DRAFT') {
      // T-PROP-01: nothing that left DRAFT is edited in place.
      throw conflict('Only drafts can be edited. Create a new version to change this proposal.');
    }
    if (v.version !== input.version) throw staleVersion();
    const draft = await buildDraft(tx, actor, v.currency as Currency, input);
    await tx.proposalItem.deleteMany({ where: { versionId: v.id } });
    await tx.proposalVersion.update({
      where: { id: v.id },
      data: { ...draft.data, version: { increment: 1 } },
    });
    if (draft.items.length > 0) {
      await tx.proposalItem.createMany({
        data: draft.items.map((i) => ({ ...i, versionId: v.id })),
      });
    }
    await tx.proposal.update({ where: { id: p.id }, data: { updatedAt: new Date() } });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'proposal.draft_update',
      outcome: 'SUCCESS',
      targetType: 'proposal_version',
      targetId: v.id,
      requestId,
      metadata: { versionNo: v.versionNo, items: draft.items.length },
    });
  });
  return getProposal(db, actor, id);
}

/** New DRAFT version N+1 copied from the newest one. Earlier versions stay as they were (FR-Q04). */
export async function reviseProposal(
  { db }: AppDeps,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  assertCanWrite(actor);
  const p = await findReadable(db, actor, id);
  await db.$transaction(async (tx) => {
    await lockProposal(tx, p.id);
    const fresh = await tx.proposal.findUniqueOrThrow({
      where: { id: p.id },
      include: { deal: { select: { status: true } } },
    });
    if (fresh.version !== version) throw staleVersion();
    if (fresh.status === 'ACCEPTED') {
      throw conflict('This proposal was accepted. Accepted versions cannot be revised.');
    }
    if (fresh.deal.status !== 'OPEN') throw conflict('The deal is closed. Reopen it first.');
    if (await openVersion(tx, p.id)) {
      throw conflict('A version is already being prepared. Finish or send it first.');
    }
    const latest = await loadVersion(tx, p.id, fresh.currentVersionNo);
    const nextNo = latest.versionNo + 1;
    await tx.proposalVersion.create({
      data: {
        agencyId: actor.agencyId,
        proposalId: p.id,
        versionNo: nextNo,
        title: latest.title,
        summary: latest.summary,
        inclusions: latest.inclusions,
        exclusions: latest.exclusions,
        assumptions: latest.assumptions,
        milestones: latest.milestones,
        paymentTerms: latest.paymentTerms,
        terms: latest.terms,
        internalNotes: latest.internalNotes,
        currency: latest.currency,
        expiresOn: latest.expiresOn,
        discountBp: latest.discountBp,
        taxRateBp: latest.taxRateBp,
        taxLabel: latest.taxLabel,
        subtotalMinor: latest.subtotalMinor,
        discountMinor: latest.discountMinor,
        taxMinor: latest.taxMinor,
        totalMinor: latest.totalMinor,
        createdById: actor.id,
        items: {
          create: latest.items.map((i) => ({
            position: i.position,
            serviceId: i.serviceId,
            name: i.name,
            description: i.description,
            unit: i.unit,
            quantityCenti: i.quantityCenti,
            unitPriceMinor: i.unitPriceMinor,
            lineTotalMinor: i.lineTotalMinor,
          })),
        },
      },
    });
    await tx.proposal.update({
      where: { id: p.id },
      data: { currentVersionNo: nextNo, status: 'DRAFT', version: { increment: 1 } },
    });
    await recordOnDeal(
      tx,
      actor,
      p.dealId,
      'proposal.revised',
      `Version ${nextNo} of ${proposalReference(p.number)} started by ${actor.name}`,
    );
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'proposal.revise',
      outcome: 'SUCCESS',
      targetType: 'proposal',
      targetId: p.id,
      requestId,
      metadata: { versionNo: nextNo },
    });
  });
  return getProposal(db, actor, id);
}

// ---------------------------------------------------------------------------
// Internal workflow: submit → review → send (FR-Q05, US-08)
// ---------------------------------------------------------------------------

async function lockedOpenVersion(tx: Tx, proposalId: string, expectedVersion: number) {
  await lockProposal(tx, proposalId);
  const v = await openVersion(tx, proposalId);
  if (!v) throw conflict('There is no version waiting for this step.');
  if (v.version !== expectedVersion) throw staleVersion();
  return v;
}

export async function submitForReview(
  { db }: AppDeps,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  assertCanWrite(actor);
  const p = await findReadable(db, actor, id);
  const today = await agencyTodayFor(db, actor.agencyId);
  await db.$transaction(async (tx) => {
    const v = await lockedOpenVersion(tx, p.id, version);
    if (v.status !== 'DRAFT') throw conflict('This version was already submitted.');
    const errors: Record<string, string[]> = {};
    if (v.items.length === 0) errors.items = ['Add at least one line before submitting.'];
    if (formatDateOnly(v.expiresOn) < today)
      errors.expiresOn = ['Choose an expiry date from today on.'];
    if (Object.keys(errors).length > 0) throw validationFailed(errors);

    const now = new Date();
    await tx.proposalVersion.update({
      where: { id: v.id },
      data: {
        status: 'IN_REVIEW',
        contentHash: contentHash(p.id, toVersionContent(v)),
        submittedAt: now,
        version: { increment: 1 },
      },
    });
    await tx.proposalReview.create({
      data: {
        agencyId: actor.agencyId,
        versionId: v.id,
        actorId: actor.id,
        kind: 'INTERNAL',
        decision: 'SUBMITTED',
      },
    });
    await tx.proposal.update({
      where: { id: p.id },
      data: { status: 'IN_REVIEW', version: { increment: 1 } },
    });
    await recordOnDeal(
      tx,
      actor,
      p.dealId,
      'proposal.submitted',
      `${proposalReference(p.number)} v${v.versionNo} submitted for review by ${actor.name}`,
    );
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'proposal.submit',
      outcome: 'SUCCESS',
      targetType: 'proposal_version',
      targetId: v.id,
      requestId,
    });
  });
  return getProposal(db, actor, id);
}

export async function reviewVersion(
  { db }: AppDeps,
  actor: AuthUser,
  id: string,
  input: z.output<typeof internalReviewSchema>,
  requestId: string,
) {
  if (!can(actor.role, 'proposals.approve')) {
    throw forbidden('Only an owner, admin or sales manager can approve proposals.');
  }
  const p = await findReadable(db, actor, id);
  await db.$transaction(async (tx) => {
    const v = await lockedOpenVersion(tx, p.id, input.version);
    if (v.status !== 'IN_REVIEW') throw conflict('This version is not waiting for review.');
    const approve = input.decision === 'APPROVE';
    const now = new Date();
    await tx.proposalVersion.update({
      where: { id: v.id },
      data: approve
        ? { status: 'APPROVED_INTERNAL', approvedAt: now, version: { increment: 1 } }
        : { status: 'DRAFT', submittedAt: null, version: { increment: 1 } },
    });
    await tx.proposalReview.create({
      data: {
        agencyId: actor.agencyId,
        versionId: v.id,
        actorId: actor.id,
        kind: 'INTERNAL',
        decision: approve ? 'APPROVED' : 'CHANGES_REQUESTED',
        comment: input.comment,
      },
    });
    await tx.proposal.update({
      where: { id: p.id },
      data: { status: approve ? 'APPROVED_INTERNAL' : 'DRAFT', version: { increment: 1 } },
    });
    await recordOnDeal(
      tx,
      actor,
      p.dealId,
      approve ? 'proposal.approved' : 'proposal.changes_requested',
      approve
        ? `${proposalReference(p.number)} v${v.versionNo} approved for sending by ${actor.name}`
        : `${actor.name} asked for changes to ${proposalReference(p.number)} v${v.versionNo}`,
      input.comment,
    );
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: approve ? 'proposal.approve' : 'proposal.request_changes',
      outcome: 'SUCCESS',
      targetType: 'proposal_version',
      targetId: v.id,
      requestId,
    });
  });
  return getProposal(db, actor, id);
}

/**
 * Publishes an approved version to the client organization's portal users (spec §1.1: client
 * approval needs a verified portal session, never a bare link). The previously sent version, if
 * any, becomes SUPERSEDED and can no longer be accepted (FR-Q08).
 */
export async function sendVersion(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  const { db, mailer, config } = deps;
  assertCanWrite(actor);
  const p = await findReadable(db, actor, id);
  const today = await agencyTodayFor(db, actor.agencyId);
  const recipients = await db.$transaction(async (tx) => {
    const v = await lockedOpenVersion(tx, p.id, version);
    if (v.status !== 'APPROVED_INTERNAL') {
      throw conflict('Only internally approved versions can be sent to the client.');
    }
    const deal = await tx.deal.findUniqueOrThrow({
      where: { id: p.dealId },
      select: { status: true, contact: { select: { clientOrgId: true, fullName: true } } },
    });
    if (deal.status !== 'OPEN') throw conflict('The deal is closed. Reopen it before sending.');
    if (formatDateOnly(v.expiresOn) < today) {
      throw conflict('This version has expired. Create a new version with a later expiry date.');
    }
    const orgId = deal.contact.clientOrgId;
    const org = orgId
      ? await tx.clientOrganization.findFirst({
          where: { id: orgId, agencyId: actor.agencyId, archivedAt: null },
          include: { portalUsers: { where: { active: true }, select: { emailNorm: true } } },
        })
      : null;
    if (!org || org.portalUsers.length === 0) {
      throw conflict(
        `Set up the client portal for ${deal.contact.fullName} and invite at least one person before sending.`,
      );
    }

    const now = new Date();
    await tx.proposalVersion.updateMany({
      where: { proposalId: p.id, status: 'SENT' },
      data: { status: 'SUPERSEDED' },
    });
    await tx.proposalVersion.update({
      where: { id: v.id },
      data: { status: 'SENT', sentAt: now, version: { increment: 1 } },
    });
    await tx.proposalReview.create({
      data: {
        agencyId: actor.agencyId,
        versionId: v.id,
        actorId: actor.id,
        kind: 'INTERNAL',
        decision: 'SENT',
      },
    });
    await tx.proposal.update({
      where: { id: p.id },
      data: { status: 'SENT', clientOrgId: org.id, version: { increment: 1 } },
    });
    await recordOnDeal(
      tx,
      actor,
      p.dealId,
      'proposal.sent',
      `${proposalReference(p.number)} v${v.versionNo} sent to ${org.name} by ${actor.name}`,
    );
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'proposal.send',
      outcome: 'SUCCESS',
      targetType: 'proposal_version',
      targetId: v.id,
      requestId,
      metadata: { clientOrgId: org.id, recipients: org.portalUsers.length },
    });
    return org.portalUsers.map((u) => u.emailNorm);
  });

  // Notification only: a link that requires signing in, no amounts or scope (SEC-24).
  const agency = await db.agency.findUniqueOrThrow({ where: { id: actor.agencyId } });
  for (const to of recipients) {
    await mailer.send({
      kind: 'proposal_sent',
      to,
      subject: `${agency.name} sent you proposal ${proposalReference(p.number)}`,
      text: [
        'Hello,',
        '',
        `${agency.name} shared a proposal with you on ClientFlow.`,
        'Sign in to review it:',
        `${config.publicUrl}/portal/proposals/${p.id}`,
      ].join('\n'),
    });
  }
  return getProposal(db, actor, id);
}
