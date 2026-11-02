// Client portal for projects (FR-X01 – FR-X04, FR-S07, US-13, T-ACL-02). Only published content
// of projects explicitly shared with the signed-in client. No internal notes, tasks, time, budget,
// staff other than the project manager's name, or other clients' data.
import {
  DELIVERABLE_DECISION_LABELS,
  type DeliverableDecision,
  type deliverableDecisionSchema,
  type PortalDeliverableDetail,
  type PortalDeliverableState,
  type PortalDeliverableSummary,
  type PortalProjectDetail,
  type PortalProjectSummary,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { agencyToday, formatDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, notFound } from '../../lib/errors.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { isOverdue } from '../deliverables/service.js';
import { logPortalDenied, portalProjectScope } from './scope.js';

/** Deliverables the client can see: not archived, with at least one published version. */
function visibleDeliverables(): Prisma.DeliverableWhereInput {
  return { status: { not: 'ARCHIVED' }, versions: { some: { publishedAt: { not: null } } } };
}

const publishedVersions = {
  where: { publishedAt: { not: null } },
  orderBy: { versionNo: 'desc' },
  include: {
    review: true,
    file: { select: { id: true, originalName: true, extension: true, sizeBytes: true } },
  },
} as const satisfies Prisma.Deliverable$versionsArgs;

type VersionRow = Prisma.DeliverableVersionGetPayload<{
  include: (typeof publishedVersions)['include'];
}>;

function stateOf(status: string, latest: VersionRow | undefined): PortalDeliverableState {
  if (latest?.review)
    return latest.review.decision === 'APPROVED' ? 'APPROVED' : 'CHANGES_REQUESTED';
  return status === 'APPROVED' ? 'APPROVED' : 'AWAITING_REVIEW';
}

async function today(db: Db, agencyId: string) {
  const a = await db.agency.findUniqueOrThrow({
    where: { id: agencyId },
    select: { timezone: true },
  });
  return agencyToday(new Date(), a.timezone);
}

export async function listPortalProjects(db: Db, actor: AuthUser): Promise<PortalProjectSummary[]> {
  const rows = await db.project.findMany({
    where: portalProjectScope(actor),
    include: {
      milestones: { select: { status: true } },
      deliverables: {
        where: { ...visibleDeliverables(), status: 'PUBLISHED' },
        select: { id: true },
      },
    },
    orderBy: { updatedAt: 'desc' },
    take: 100,
  });
  return rows.map((p) => ({
    id: p.id,
    title: p.title,
    state: p.state,
    startOn: p.startOn ? formatDateOnly(p.startOn) : null,
    dueOn: p.dueOn ? formatDateOnly(p.dueOn) : null,
    milestones: {
      total: p.milestones.length,
      done: p.milestones.filter((m) => m.status === 'DONE').length,
    },
    awaitingReview: p.deliverables.length,
  }));
}

export async function getPortalProject(
  db: Db,
  actor: AuthUser,
  id: string,
  requestId: string,
): Promise<PortalProjectDetail> {
  const scope = portalProjectScope(actor);
  const p = UUID_PATTERN.test(id)
    ? await db.project.findFirst({
        where: { AND: [scope, { id }] },
        include: {
          agency: { select: { name: true } },
          milestones: { orderBy: { sequence: 'asc' } },
          deliverables: {
            where: visibleDeliverables(),
            include: { versions: publishedVersions },
            orderBy: { createdAt: 'asc' },
          },
        },
      })
    : null;
  if (!p) {
    await logPortalDenied(db, actor, 'project', id, requestId);
    throw notFound();
  }
  const t = await today(db, actor.agencyId);
  const deliverables: PortalDeliverableSummary[] = p.deliverables.map((d) => {
    const latest = d.versions[0]!;
    return {
      id: d.id,
      title: d.title,
      state: stateOf(d.status, latest),
      versionNo: latest.versionNo,
      publishedAt: latest.publishedAt!.toISOString(),
      reviewDueOn: d.reviewDueOn ? formatDateOnly(d.reviewDueOn) : null,
      overdue: isOverdue(d, t),
    };
  });
  return {
    id: p.id,
    title: p.title,
    state: p.state,
    agencyName: p.agency.name,
    startOn: p.startOn ? formatDateOnly(p.startOn) : null,
    dueOn: p.dueOn ? formatDateOnly(p.dueOn) : null,
    milestones: {
      total: p.milestones.length,
      done: p.milestones.filter((m) => m.status === 'DONE').length,
    },
    awaitingReview: deliverables.filter((d) => d.state === 'AWAITING_REVIEW').length,
    milestoneList: p.milestones.map((m) => ({
      title: m.title,
      dueOn: m.dueOn ? formatDateOnly(m.dueOn) : null,
      status: m.status,
    })),
    deliverables,
  };
}

async function findPortalDeliverable(db: Db, actor: AuthUser, id: string) {
  const scope = portalProjectScope(actor);
  if (!UUID_PATTERN.test(id)) return null;
  return db.deliverable.findFirst({
    where: { AND: [{ id, project: scope }, visibleDeliverables()] },
    include: { project: { select: { id: true, title: true } }, versions: publishedVersions },
  });
}

export async function getPortalDeliverable(
  db: Db,
  actor: AuthUser,
  id: string,
  requestId: string,
): Promise<PortalDeliverableDetail> {
  const d = await findPortalDeliverable(db, actor, id);
  if (!d) {
    await logPortalDenied(db, actor, 'deliverable', id, requestId);
    throw notFound();
  }
  const t = await today(db, actor.agencyId);
  const latest = d.versions[0]!;
  const open =
    d.status === 'PUBLISHED' && !latest.review && latest.versionNo === d.currentVersionNo;
  return {
    id: d.id,
    project: d.project,
    title: d.title,
    description: d.description,
    state: stateOf(d.status, latest),
    reviewDueOn: d.reviewDueOn ? formatDateOnly(d.reviewDueOn) : null,
    overdue: isOverdue(d, t),
    versions: d.versions.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      note: v.note,
      publishedAt: v.publishedAt!.toISOString(),
      file: {
        id: v.file.id,
        name: v.file.originalName,
        extension: v.file.extension,
        sizeBytes: v.file.sizeBytes,
      },
      review: v.review
        ? {
            decision: v.review.decision,
            reason: v.review.reason,
            at: v.review.occurredAt.toISOString(),
          }
        : null,
    })),
    openVersionId: open ? latest.id : null,
  };
}

const DECISION: Record<
  z.output<typeof deliverableDecisionSchema>['decision'],
  DeliverableDecision
> = {
  APPROVE: 'APPROVED',
  REQUEST_REVISION: 'REVISION_REQUESTED',
  REJECT: 'REJECTED',
};

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * The client's decision on the latest published version (FR-S07, US-13). One decision per
 * version (unique index + row lock); repeating the same decision returns the same result.
 * Rejecting or requesting a revision sends the deliverable back to the team.
 */
export async function decideOnDeliverable(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  input: z.output<typeof deliverableDecisionSchema>,
  requestId: string,
) {
  const { db, mailer, config } = deps;
  const visible = await findPortalDeliverable(db, actor, id);
  if (!visible) {
    await logPortalDenied(db, actor, 'deliverable', id, requestId);
    throw notFound();
  }
  const wanted = DECISION[input.decision];
  let notify: { to: string; subject: string; text: string } | null = null;
  try {
    notify = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM deliverables WHERE id = CAST(${visible.id} AS uuid) FOR UPDATE`;
      const d = await tx.deliverable.findUniqueOrThrow({
        where: { id: visible.id },
        include: { project: { include: { manager: { select: { emailNorm: true } } } } },
      });
      const v = await tx.deliverableVersion.findFirst({
        where: { id: input.versionId, deliverableId: d.id, publishedAt: { not: null } },
        include: { review: true },
      });
      if (!v)
        throw conflict(
          'This deliverable changed since you opened it. Reload to see the latest version.',
        );
      if (v.review) {
        if (v.review.decision === wanted) return null; // same decision again: idempotent
        throw conflict('A decision was already recorded for this version.');
      }
      if (d.status !== 'PUBLISHED' || v.versionNo !== d.currentVersionNo) {
        throw conflict(
          'This version is no longer open for a decision. Reload to see the latest version.',
        );
      }
      await tx.deliverableReview.create({
        data: {
          agencyId: actor.agencyId,
          versionId: v.id,
          actorId: actor.id,
          decision: wanted,
          reason: input.reason,
          fileSha256: v.fileSha256,
        },
      });
      await tx.deliverable.update({
        where: { id: d.id },
        data: {
          status: wanted === 'APPROVED' ? 'APPROVED' : 'REVISION_REQUESTED',
          version: { increment: 1 },
        },
      });
      const words = DELIVERABLE_DECISION_LABELS[wanted].toLowerCase();
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: d.projectId,
        eventType: `deliverable.client_${wanted.toLowerCase()}`,
        summary: `${actor.name} (client): ${words} on version ${v.versionNo} of “${d.title}”`,
        body: input.reason,
      });
      await writeAudit(tx, {
        agencyId: actor.agencyId,
        actorId: actor.id,
        action: `deliverable.client_${wanted.toLowerCase()}`,
        outcome: 'SUCCESS',
        targetType: 'deliverable',
        targetId: d.id,
        requestId,
        metadata: { versionNo: v.versionNo },
      });
      return {
        to: d.project.manager.emailNorm,
        subject: `Client decision: ${words}`,
        // Link only: the decision text stays in the app (SEC-24).
        text: `A client recorded a decision on a deliverable.\n\n${config.publicUrl}/app/projects/${d.projectId}/deliverables`,
      };
    });
  } catch (err) {
    if (!isUniqueViolation(err)) throw err;
    const stored = await db.deliverableReview.findFirst({ where: { versionId: input.versionId } });
    if (stored?.decision !== wanted)
      throw conflict('A decision was already recorded for this version.');
  }
  if (notify) await mailer.send({ kind: 'deliverable_decision', ...notify });
  return getPortalDeliverable(db, actor, id, requestId);
}
