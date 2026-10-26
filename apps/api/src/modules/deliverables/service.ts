// Deliverables: private drafts, versions with a clean file, explicit publish (FR-S06 – FR-S09).
import type {
  DeliverableDetail,
  DeliverableStatus,
  DeliverableSummary,
  deliverableCreateSchema,
  deliverableUpdateSchema,
  deliverableVersionSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { agencyToday, formatDateOnly, parseDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import {
  assertNotArchived,
  canManage,
  canWork,
  findWorkable,
  projectReadScope,
  type Tx,
} from '../projects/access.js';

/** Waiting for the client past the review date. Silence never counts as approval (FR-S10). */
export function isOverdue(
  d: { status: DeliverableStatus; reviewDueOn: Date | null },
  today: string,
) {
  return (
    d.status === 'PUBLISHED' && d.reviewDueOn !== null && formatDateOnly(d.reviewDueOn) < today
  );
}

const summaryInclude = {
  milestone: { select: { id: true, title: true } },
  versions: { where: { publishedAt: { not: null } }, select: { versionNo: true } },
} as const satisfies Prisma.DeliverableInclude;

function toSummary(
  d: Prisma.DeliverableGetPayload<{ include: typeof summaryInclude }>,
  today: string,
): DeliverableSummary {
  const published = d.versions.map((v) => v.versionNo);
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    milestone: d.milestone,
    reviewDueOn: d.reviewDueOn ? formatDateOnly(d.reviewDueOn) : null,
    overdue: isOverdue(d, today),
    currentVersionNo: d.currentVersionNo,
    publishedVersionNo: published.length > 0 ? Math.max(...published) : null,
    updatedAt: d.updatedAt.toISOString(),
    version: d.version,
  };
}

async function findDeliverable(db: Db | Tx, actor: AuthUser, id: string) {
  if (!canWork(actor)) throw forbidden('Deliverables are for the project team.');
  if (!UUID_PATTERN.test(id)) throw notFound();
  const d = await db.deliverable.findFirst({
    where: { id, agencyId: actor.agencyId, project: projectReadScope(actor) },
    include: { project: true },
  });
  if (!d) throw notFound();
  return d;
}

async function lockDeliverable(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM deliverables WHERE id = CAST(${id} AS uuid) FOR UPDATE`;
}

async function assertMilestone(db: Db | Tx, projectId: string, milestoneId: string) {
  const m = await db.projectMilestone.findFirst({
    where: { id: milestoneId, projectId },
    select: { id: true },
  });
  if (!m) throw validationFailed({ milestoneId: ['Choose a milestone of this project.'] });
}

export async function listDeliverables(
  db: Db,
  actor: AuthUser,
  projectId: string,
  timeZone: string,
) {
  const p = await findWorkable(db, actor, projectId);
  const rows = await db.deliverable.findMany({
    where: { projectId: p.id },
    include: summaryInclude,
    orderBy: [{ createdAt: 'asc' }],
    take: 200,
  });
  const today = agencyToday(new Date(), timeZone);
  return {
    deliverables: rows.map((d) => toSummary(d, today)),
    access: { create: p.state !== 'ARCHIVED' },
  };
}

export async function getDeliverable(
  db: Db,
  actor: AuthUser,
  id: string,
  timeZone: string,
): Promise<DeliverableDetail> {
  const base = await findDeliverable(db, actor, id);
  const d = await db.deliverable.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      ...summaryInclude,
      versions: {
        orderBy: { versionNo: 'desc' },
        include: {
          file: {
            select: {
              id: true,
              originalName: true,
              extension: true,
              sizeBytes: true,
              scanStatus: true,
            },
          },
          createdBy: { select: { id: true, name: true } },
          review: { include: { actor: { select: { name: true } } } },
        },
      },
    },
  });
  const today = agencyToday(new Date(), timeZone);
  const published = d.versions.filter((v) => v.publishedAt).map((v) => v.versionNo);
  const open = base.project.state !== 'ARCHIVED' && !['APPROVED', 'ARCHIVED'].includes(d.status);
  return {
    id: d.id,
    title: d.title,
    status: d.status,
    milestone: d.milestone,
    reviewDueOn: d.reviewDueOn ? formatDateOnly(d.reviewDueOn) : null,
    overdue: isOverdue(d, today),
    currentVersionNo: d.currentVersionNo,
    publishedVersionNo: published.length > 0 ? Math.max(...published) : null,
    updatedAt: d.updatedAt.toISOString(),
    version: d.version,
    projectId: d.projectId,
    description: d.description,
    versions: d.versions.map((v) => ({
      id: v.id,
      versionNo: v.versionNo,
      note: v.note,
      file: {
        id: v.file.id,
        name: v.file.originalName,
        extension: v.file.extension,
        sizeBytes: v.file.sizeBytes,
        scanStatus: v.file.scanStatus,
      },
      createdBy: v.createdBy,
      createdAt: v.createdAt.toISOString(),
      publishedAt: v.publishedAt?.toISOString() ?? null,
      review: v.review
        ? {
            decision: v.review.decision,
            reason: v.review.reason,
            by: v.review.actor.name,
            at: v.review.occurredAt.toISOString(),
          }
        : null,
    })),
    access: {
      edit: open,
      publish: open && canManage(actor, base.project) && d.status === 'READY',
    },
  };
}

export async function createDeliverable(
  db: Db,
  actor: AuthUser,
  projectId: string,
  input: z.output<typeof deliverableCreateSchema>,
  requestId: string,
  timeZone: string,
) {
  const id = await db.$transaction(async (tx) => {
    const p = await findWorkable(tx, actor, projectId);
    assertNotArchived(p);
    if (input.milestoneId) await assertMilestone(tx, p.id, input.milestoneId);
    const d = await tx.deliverable.create({
      data: {
        agencyId: actor.agencyId,
        projectId: p.id,
        title: input.title,
        description: input.description,
        milestoneId: input.milestoneId ?? null,
        reviewDueOn: input.reviewDueOn ? parseDateOnly(input.reviewDueOn) : null,
        createdById: actor.id,
      },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'deliverable.created',
      summary: `Deliverable “${d.title}” started by ${actor.name} (private)`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deliverable.create',
      outcome: 'SUCCESS',
      targetType: 'deliverable',
      targetId: d.id,
      requestId,
    });
    return d.id;
  });
  return getDeliverable(db, actor, id, timeZone);
}

function assertOpen(d: { status: DeliverableStatus }) {
  if (d.status === 'APPROVED') {
    throw conflict('The client approved this deliverable. Start a new deliverable for more work.');
  }
  if (d.status === 'ARCHIVED') throw conflict('Archived deliverables are read-only.');
}

export async function updateDeliverable(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof deliverableUpdateSchema>,
  timeZone: string,
) {
  await db.$transaction(async (tx) => {
    const d = await findDeliverable(tx, actor, id);
    assertNotArchived(d.project);
    assertOpen(d);
    if (d.version !== input.version) throw staleVersion();
    if (input.milestoneId) await assertMilestone(tx, d.projectId, input.milestoneId);
    const res = await tx.deliverable.updateMany({
      where: { id: d.id, version: input.version },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
        ...(input.reviewDueOn !== undefined
          ? { reviewDueOn: input.reviewDueOn ? parseDateOnly(input.reviewDueOn) : null }
          : {}),
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw staleVersion();
  });
  return getDeliverable(db, actor, id, timeZone);
}

/**
 * A new version with a clean, unused file of the same project (FR-S08). While the client is
 * deciding on a published version, the team waits for that decision.
 */
export async function addVersion(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof deliverableVersionSchema>,
  requestId: string,
  timeZone: string,
) {
  await db.$transaction(async (tx) => {
    const base = await findDeliverable(tx, actor, id);
    assertNotArchived(base.project);
    await lockDeliverable(tx, base.id);
    const d = await tx.deliverable.findUniqueOrThrow({ where: { id: base.id } });
    assertOpen(d);
    if (d.status === 'PUBLISHED') {
      throw conflict(
        `Version ${d.currentVersionNo} is with the client. Wait for their decision before adding a new version.`,
      );
    }
    const file = await tx.storedFile.findFirst({
      where: { id: input.fileId, projectId: d.projectId },
      include: { deliverableVersion: { select: { id: true } } },
    });
    if (!file) throw validationFailed({ fileId: ['Choose a file uploaded to this project.'] });
    if (file.scanStatus !== 'CLEAN') {
      throw validationFailed({ fileId: ['This file has not passed the upload checks.'] });
    }
    if (file.deliverableVersion) {
      throw validationFailed({ fileId: ['This file is already used by another version.'] });
    }
    const versionNo = d.currentVersionNo + 1;
    await tx.deliverableVersion.create({
      data: {
        agencyId: actor.agencyId,
        projectId: d.projectId,
        deliverableId: d.id,
        versionNo,
        fileId: file.id,
        note: input.note,
        fileSha256: file.sha256,
        createdById: actor.id,
      },
    });
    await tx.deliverable.update({
      where: { id: d.id },
      data: { currentVersionNo: versionNo, status: 'READY', version: { increment: 1 } },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: d.projectId,
      eventType: 'deliverable.version',
      summary: `${actor.name} added version ${versionNo} of “${d.title}” (${file.originalName})`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deliverable.version',
      outcome: 'SUCCESS',
      targetType: 'deliverable',
      targetId: d.id,
      requestId,
      metadata: { versionNo, fileId: file.id },
    });
  });
  return getDeliverable(db, actor, id, timeZone);
}

/**
 * The explicit publish (FR-S06): the latest version becomes visible to the client organization's
 * people the project is shared with. Project manager, Owner or Admin only.
 */
export async function publishDeliverable(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
  timeZone: string,
) {
  await db.$transaction(async (tx) => {
    const base = await findDeliverable(tx, actor, id);
    if (!canManage(actor, base.project)) {
      throw forbidden('Only the project manager or an admin can publish to the client.');
    }
    assertNotArchived(base.project);
    await lockDeliverable(tx, base.id);
    const d = await tx.deliverable.findUniqueOrThrow({ where: { id: base.id } });
    if (d.status === 'PUBLISHED') return; // a repeated publish (double click): same outcome
    if (d.version !== version) throw staleVersion();
    if (d.status !== 'READY') {
      throw conflict('Add a version with a file before publishing.');
    }
    if (!base.project.clientOrgId) {
      throw conflict('Link the project to a client organization before publishing.');
    }
    const v = await tx.deliverableVersion.findFirstOrThrow({
      where: { deliverableId: d.id, versionNo: d.currentVersionNo },
      include: { file: { select: { scanStatus: true, sha256: true } } },
    });
    // Checked again at publish time: a file flagged after upload never reaches the client.
    if (v.file.scanStatus !== 'CLEAN' || v.file.sha256 !== v.fileSha256) {
      throw conflict('The file of this version has not passed the upload checks.');
    }
    const now = new Date();
    await tx.deliverableVersion.update({
      where: { id: v.id },
      data: { publishedAt: now, publishedById: actor.id },
    });
    await tx.deliverable.update({
      where: { id: d.id },
      data: { status: 'PUBLISHED', publishedAt: now, version: { increment: 1 } },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: d.projectId,
      eventType: 'deliverable.published',
      summary: `${actor.name} published version ${v.versionNo} of “${d.title}” to the client`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deliverable.publish',
      outcome: 'SUCCESS',
      targetType: 'deliverable',
      targetId: d.id,
      requestId,
      metadata: { versionNo: v.versionNo },
    });
  });
  return getDeliverable(db, actor, id, timeZone);
}

/** Withdraws a deliverable from the team and the portal. Its history stays. */
export async function archiveDeliverable(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
  timeZone: string,
) {
  await db.$transaction(async (tx) => {
    const d = await findDeliverable(tx, actor, id);
    if (!canManage(actor, d.project)) {
      throw forbidden('Only the project manager or an admin can archive deliverables.');
    }
    assertNotArchived(d.project);
    if (d.status === 'ARCHIVED') return;
    const res = await tx.deliverable.updateMany({
      where: { id: d.id, version },
      data: { status: 'ARCHIVED', version: { increment: 1 } },
    });
    if (res.count === 0) throw staleVersion();
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: d.projectId,
      eventType: 'deliverable.archived',
      summary: `${actor.name} archived “${d.title}”`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'deliverable.archive',
      outcome: 'SUCCESS',
      targetType: 'deliverable',
      targetId: d.id,
      requestId,
    });
  });
  return getDeliverable(db, actor, id, timeZone);
}
