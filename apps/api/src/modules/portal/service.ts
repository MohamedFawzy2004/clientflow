import {
  proposalReference,
  type clientDecisionSchema,
  type PortalProposalDetail,
  type PortalProposalSummary,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { agencyToday, formatDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { lockProposal } from '../proposals/service.js';
import { displayStatus, toPortalVersion, versionInclude } from '../proposals/serializer.js';

/** Every portal query is pinned to the user's own organization (spec §1.1 `C` scope). */
function orgScope(actor: AuthUser): Prisma.ProposalWhereInput {
  if (actor.role !== 'CLIENT' || !actor.clientOrgId) throw forbidden();
  return { agencyId: actor.agencyId, clientOrgId: actor.clientOrgId };
}

const sentOnly = { sentAt: { not: null } } as const;

async function today(db: Db, agencyId: string) {
  const a = await db.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { timezone: true },
  });
  return agencyToday(new Date(), a.timezone);
}

export async function listPortalProposals(
  db: Db,
  actor: AuthUser,
): Promise<PortalProposalSummary[]> {
  const rows = await db.proposal.findMany({
    where: { ...orgScope(actor), versions: { some: sentOnly } },
    include: {
      versions: { where: sentOnly, orderBy: { versionNo: 'desc' }, take: 1 },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  const t = await today(db, actor.agencyId);
  return rows.map((p) => {
    const v = p.versions[0]!;
    return {
      id: p.id,
      reference: proposalReference(p.number),
      title: v.title,
      versionNo: v.versionNo,
      displayStatus: displayStatus(v.status, v.expiresOn, t),
      totalMinor: v.totalMinor.toString(),
      currency: v.currency as PortalProposalSummary['currency'],
      expiresOn: formatDateOnly(v.expiresOn),
      sentAt: v.sentAt!.toISOString(),
    };
  });
}

export async function getPortalProposal(
  db: Db,
  actor: AuthUser,
  id: string,
): Promise<PortalProposalDetail> {
  if (!UUID_PATTERN.test(id)) throw notFound();
  // Another organization's proposal, a draft-only proposal and an unknown ID all look the same.
  const p = await db.proposal.findFirst({
    where: { ...orgScope(actor), id, versions: { some: sentOnly } },
    include: {
      agency: { select: { name: true } },
      clientOrg: { select: { name: true } },
      versions: { where: sentOnly, orderBy: { versionNo: 'desc' }, include: versionInclude },
    },
  });
  if (!p) throw notFound();
  const t = await today(db, actor.agencyId);
  const current = p.versions.find((v) => v.status === 'ACCEPTED') ?? p.versions[0]!;
  return {
    id: p.id,
    reference: proposalReference(p.number),
    agencyName: p.agency.name,
    clientOrgName: p.clientOrg?.name ?? '',
    current: toPortalVersion(current, t),
    history: p.versions.map((v) => ({
      versionNo: v.versionNo,
      displayStatus: displayStatus(v.status, v.expiresOn, t),
      sentAt: v.sentAt!.toISOString(),
    })),
  };
}

const DECISION_STATUS = {
  ACCEPT: 'ACCEPTED',
  REJECT: 'REJECTED',
  REQUEST_CHANGES: 'CHANGES_REQUESTED',
} as const;

const DECISION_WORDS = {
  ACCEPT: 'accepted',
  REJECT: 'declined',
  REQUEST_CHANGES: 'asked for changes to',
} as const;

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * The client's decision on the version they were shown (FR-Q07–Q09, US-09, T-PROP-02/03).
 * - The request names the version by the content hash the client saw; anything else is refused.
 * - Expired and superseded versions cannot be decided on.
 * - The proposal row lock plus a unique index allow exactly one decision per version; a repeat of
 *   the same decision (double click) returns the same result.
 * - Accepting wins the deal through the normal path (no override) and converts the lead.
 */
export async function decideOnProposal(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  input: z.output<typeof clientDecisionSchema>,
  requestId: string,
) {
  const { db, mailer, config } = deps;
  const scope = orgScope(actor);
  if (!UUID_PATTERN.test(id)) throw notFound();
  const visible = await db.proposal.findFirst({
    where: { ...scope, id, versions: { some: sentOnly } },
    select: { id: true },
  });
  if (!visible) throw notFound();
  const t = await today(db, actor.agencyId);
  const wanted = DECISION_STATUS[input.decision];

  let notify: { to: string; subject: string; text: string } | null = null;
  try {
    notify = await db.$transaction(async (tx) => {
      await lockProposal(tx, id);
      const p = await tx.proposal.findUniqueOrThrow({
        where: { id },
        include: { deal: { include: { owner: { select: { emailNorm: true } } } } },
      });
      const v = await tx.proposalVersion.findFirst({
        where: { proposalId: id, contentHash: input.contentHash, ...sentOnly },
        include: { reviews: { where: { kind: 'CLIENT' } } },
      });
      if (!v) {
        throw conflict(
          'This proposal changed since you opened it. Reload to see the latest version.',
        );
      }
      const existing = v.reviews[0];
      if (existing) {
        if (v.status === wanted) return null; // same decision again: idempotent
        throw conflict('A decision was already recorded for this version.');
      }
      if (v.status === 'SUPERSEDED') {
        throw conflict('A newer version of this proposal was sent. Review the latest version.');
      }
      if (v.status !== 'SENT') throw conflict('This version is not open for a decision.');
      if (formatDateOnly(v.expiresOn) < t) {
        throw conflict(
          `This proposal expired on ${formatDateOnly(v.expiresOn)}. Ask the agency for an updated version.`,
        );
      }

      const now = new Date();
      if (input.decision === 'ACCEPT') {
        if (p.deal.status === 'LOST') {
          throw conflict('This proposal is no longer open. Please contact the agency.');
        }
        if (p.deal.acceptedProposalVersionId) {
          throw conflict('Another proposal was already accepted for this project.');
        }
      }

      await tx.proposalVersion.update({
        where: { id: v.id },
        data: { status: wanted, decidedAt: now, version: { increment: 1 } },
      });
      await tx.proposalReview.create({
        data: {
          agencyId: actor.agencyId,
          versionId: v.id,
          actorId: actor.id,
          kind: 'CLIENT',
          decision: wanted,
          comment: input.comment,
          contentHash: v.contentHash,
          occurredAt: now,
        },
      });

      const reference = proposalReference(p.number);
      if (input.decision === 'ACCEPT') {
        // Anything still being prepared is withdrawn: the accepted version is the scope now.
        await tx.proposalVersion.updateMany({
          where: { proposalId: id, status: { in: ['DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL'] } },
          data: { status: 'SUPERSEDED' },
        });
        await tx.proposal.update({
          where: { id },
          data: { status: 'ACCEPTED', version: { increment: 1 } },
        });
        await tx.$queryRaw`SELECT id FROM deals WHERE id = CAST(${p.dealId} AS uuid) FOR UPDATE`;
        const deal = await tx.deal.findUniqueOrThrow({ where: { id: p.dealId } });
        await tx.deal.update({
          where: { id: deal.id },
          data:
            deal.status === 'OPEN'
              ? {
                  status: 'WON',
                  closedAt: now,
                  closedById: actor.id,
                  acceptedProposalVersionId: v.id,
                  version: { increment: 1 },
                }
              : { acceptedProposalVersionId: v.id, version: { increment: 1 } },
        });
        await recordActivity(tx, actor, {
          entityType: 'deal',
          entityId: deal.id,
          eventType: 'deal.won',
          summary: `${actor.name} (client) accepted ${reference} v${v.versionNo}`,
          body: input.comment,
        });
        const converted = await tx.contact.updateMany({
          where: { id: deal.contactId, lifecycle: 'LEAD' },
          data: { lifecycle: 'CUSTOMER', convertedAt: now, version: { increment: 1 } },
        });
        if (converted.count > 0) {
          await recordActivity(tx, actor, {
            entityType: 'contact',
            entityId: deal.contactId,
            eventType: 'contact.converted',
            summary: `Became a customer when ${reference} was accepted`,
          });
        }
      } else {
        // The proposal mirrors its newest version: a newer draft keeps the proposal in DRAFT.
        if (p.currentVersionNo === v.versionNo) {
          await tx.proposal.update({
            where: { id },
            data: { status: wanted, version: { increment: 1 } },
          });
        }
        await recordActivity(tx, actor, {
          entityType: 'deal',
          entityId: p.dealId,
          eventType: input.decision === 'REJECT' ? 'proposal.declined' : 'proposal.client_changes',
          summary: `${actor.name} (client) ${DECISION_WORDS[input.decision]} ${reference} v${v.versionNo}`,
          body: input.comment,
        });
      }
      await writeAudit(tx, {
        agencyId: actor.agencyId,
        actorId: actor.id,
        action: `proposal.client_${input.decision.toLowerCase()}`,
        outcome: 'SUCCESS',
        targetType: 'proposal_version',
        targetId: v.id,
        requestId,
        metadata: { contentHash: v.contentHash },
      });
      return {
        to: p.deal.owner.emailNorm,
        subject: `${reference}: client ${DECISION_WORDS[input.decision]} version ${v.versionNo}`,
        text: [
          `${actor.name} ${DECISION_WORDS[input.decision]} ${reference} version ${v.versionNo}.`,
          '',
          `${config.publicUrl}/app/proposals/${id}`,
        ].join('\n'),
      };
    });
  } catch (err) {
    // Lost a race on the one-decision index: accept only if the recorded decision is the same.
    if (!isUniqueViolation(err)) throw err;
    const stored = await db.proposalVersion.findFirst({
      where: { proposalId: id, contentHash: input.contentHash },
      select: { status: true },
    });
    if (stored?.status !== wanted)
      throw conflict('A decision was already recorded for this version.');
  }
  if (notify) await mailer.send({ kind: 'proposal_decision', ...notify });
  return getPortalProposal(db, actor, id);
}
