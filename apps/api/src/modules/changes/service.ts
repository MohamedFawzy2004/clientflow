// Change requests (FR-S01 – FR-S04, US-12, T-SCOPE-01/02, spec J4). The estimate lives in versions;
// the agreed baseline (budget, due date, tasks) changes only when the client accepts a sent version.
import { createHash } from 'node:crypto';
import {
  can,
  CHANGE_STATUS_LABELS,
  changeReference,
  formatMoney,
  OPEN_CHANGE_STATUSES,
  parseChangePrice,
  taxOn,
  workItemsFromText,
  type ChangeDetail,
  type ChangeSummary,
  type ChangeVersionView,
  type Currency,
  type PortalChangeDetail,
  type PortalChangeSummary,
  type PortalChangeVersion,
  type changeCreateSchema,
  type changeDecisionSchema,
  type changeDraftSchema,
  type changeReviewSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { formatDateOnly, parseDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import {
  assertNotArchived,
  canManage,
  findManageable,
  findReadable,
  lockProject,
  projectReadScope,
  type Tx,
} from '../projects/access.js';
import { logPortalDenied, portalProjectScope } from '../portal/scope.js';
import { DEFAULT_TAX_RATE_BP } from '../proposals/service.js';

const LIVE_PROJECT = ['PLANNED', 'ACTIVE', 'ON_HOLD'] as const;

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const versionInclude = {
  createdBy: { select: { id: true, name: true } },
  approvedBy: { select: { name: true } },
  decision: { include: { actor: { select: { name: true } } } },
} as const satisfies Prisma.ChangeVersionInclude;
type VersionRow = Prisma.ChangeVersionGetPayload<{ include: typeof versionInclude }>;

const changeInclude = {
  requestedBy: { select: { id: true, name: true, role: true } },
  versions: { orderBy: { versionNo: 'desc' }, include: versionInclude },
  project: { select: { id: true, title: true, currency: true, managerId: true, state: true } },
} as const satisfies Prisma.ChangeRequestInclude;
type ChangeRow = Prisma.ChangeRequestGetPayload<{ include: typeof changeInclude }>;

function toVersion(v: VersionRow): ChangeVersionView {
  return {
    id: v.id,
    versionNo: v.versionNo,
    status: v.status,
    scope: v.scope,
    workItems: workItemsFromText(v.workItems),
    estimateMinutes: v.estimateMinutes,
    priceMinor: v.priceMinor.toString(),
    taxRateBp: v.taxRateBp,
    taxMinor: v.taxMinor.toString(),
    totalMinor: v.totalMinor.toString(),
    currency: v.currency as Currency,
    newDueOn: v.newDueOn ? formatDateOnly(v.newDueOn) : null,
    contentHash: v.contentHash,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    approvedAt: v.approvedAt?.toISOString() ?? null,
    approvedBy: v.approvedBy?.name ?? null,
    sentAt: v.sentAt?.toISOString() ?? null,
    createdBy: v.createdBy,
    effect:
      v.budgetBeforeMinor !== null && v.budgetAfterMinor !== null
        ? {
            budgetBeforeMinor: v.budgetBeforeMinor.toString(),
            budgetAfterMinor: v.budgetAfterMinor.toString(),
            dueBefore: v.dueBefore ? formatDateOnly(v.dueBefore) : null,
          }
        : null,
    decision: v.decision
      ? {
          decision: v.decision.decision,
          reason: v.decision.reason,
          by: v.decision.actor.name,
          at: v.decision.occurredAt.toISOString(),
        }
      : null,
  };
}

function toSummary(c: ChangeRow): ChangeSummary {
  const latest = c.versions[0];
  return {
    id: c.id,
    number: c.number,
    reference: changeReference(c.number),
    title: c.title,
    status: c.status,
    requestedBy: {
      id: c.requestedBy.id,
      name: c.requestedBy.name,
      client: c.requestedBy.role === 'CLIENT',
    },
    priceMinor: latest ? latest.priceMinor.toString() : null,
    currency: c.project.currency as Currency,
    newDueOn: latest?.newDueOn ? formatDateOnly(latest.newDueOn) : null,
    updatedAt: c.updatedAt.toISOString(),
    version: c.version,
  };
}

/** What the client is shown and decides on; its hash proves which content they saw (FR-S03). */
function contentHash(
  c: { id: string; title: string; description: string },
  v: {
    versionNo: number;
    scope: string;
    workItems: string | null;
    priceMinor: bigint;
    taxRateBp: number;
    taxMinor: bigint;
    totalMinor: bigint;
    currency: string;
    newDueOn: Date | null;
  },
) {
  const canonical = JSON.stringify([
    c.id,
    v.versionNo,
    c.title,
    c.description,
    v.scope,
    workItemsFromText(v.workItems),
    v.priceMinor.toString(),
    v.taxRateBp,
    v.taxMinor.toString(),
    v.totalMinor.toString(),
    v.currency,
    v.newDueOn ? formatDateOnly(v.newDueOn) : null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

// ---------------------------------------------------------------------------
// Staff
// ---------------------------------------------------------------------------

/** Anyone who can read the project reads its changes (spec §1.1 "Read linked" for sales). */
async function findChange(db: Db | Tx, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const c = await db.changeRequest.findFirst({
    where: { id, agencyId: actor.agencyId, project: projectReadScope(actor) },
    include: changeInclude,
  });
  if (!c) throw notFound();
  return c;
}

async function lockChange(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM change_requests WHERE id = CAST(${id} AS uuid) FOR UPDATE`;
}

/** Loads a change the actor may work on (project manager, Owner, Admin) under a row lock. */
async function findManageableChange(tx: Tx, actor: AuthUser, id: string, version?: number) {
  const base = await findChange(tx, actor, id);
  const project = await findReadable(tx, actor, base.projectId);
  if (!canManage(actor, project)) {
    throw forbidden('Only the project manager or an admin can change this request.');
  }
  assertNotArchived(project);
  await lockChange(tx, base.id);
  const c = await tx.changeRequest.findUniqueOrThrow({
    where: { id: base.id },
    include: changeInclude,
  });
  if (version !== undefined && c.version !== version) throw staleVersion();
  return { c, project };
}

export async function listChanges(db: Db, actor: AuthUser, projectId: string) {
  const p = await findReadable(db, actor, projectId);
  const rows = await db.changeRequest.findMany({
    where: { projectId: p.id },
    include: changeInclude,
    orderBy: { number: 'desc' },
    take: 200,
  });
  return {
    changes: rows.map(toSummary),
    access: { create: canManage(actor, p) && p.state !== 'ARCHIVED' },
  };
}

export async function getChange(db: Db, actor: AuthUser, id: string): Promise<ChangeDetail> {
  const c = await findChange(db, actor, id);
  const project = await db.project.findUniqueOrThrow({ where: { id: c.projectId } });
  const tasks = await db.task.findMany({
    where: { changeRequestId: c.id },
    select: { id: true, title: true, status: true },
    orderBy: { createdAt: 'asc' },
  });
  const manage = canManage(actor, project) && project.state !== 'ARCHIVED';
  const latest = c.versions[0];
  const priced = latest ? latest.priceMinor > 0n : false;
  const draft = latest?.status === 'DRAFT';
  return {
    ...toSummary(c),
    projectId: c.projectId,
    projectTitle: c.project.title,
    description: c.description,
    justification: c.justification,
    withdrawnReason: c.withdrawnReason,
    versions: c.versions.map(toVersion),
    tasks,
    needsApproval: priced,
    access: {
      estimate: manage && (c.status === 'REQUESTED' || (c.status === 'ESTIMATING' && draft)),
      submit: manage && c.status === 'ESTIMATING' && draft && priced,
      review:
        can(actor.role, 'changes.approve') &&
        project.state !== 'ARCHIVED' &&
        latest?.status === 'IN_REVIEW',
      send:
        manage &&
        ((draft && !priced && c.status === 'ESTIMATING') || latest?.status === 'APPROVED_INTERNAL'),
      withdraw: manage && OPEN_CHANGE_STATUSES.includes(c.status),
    },
  };
}

export async function createChange(
  db: Db,
  actor: AuthUser,
  projectId: string,
  input: z.output<typeof changeCreateSchema>,
  requestId: string,
) {
  const id = await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, projectId);
    return insertChange(tx, actor, p.id, input, false, requestId);
  });
  return getChange(db, actor, id);
}

async function insertChange(
  tx: Tx,
  actor: AuthUser,
  projectId: string,
  input: z.output<typeof changeCreateSchema>,
  byClient: boolean,
  requestId: string,
) {
  // Numbers are per project; the row lock serializes concurrent requests.
  await lockProject(tx, projectId);
  const last = await tx.changeRequest.aggregate({ where: { projectId }, _max: { number: true } });
  const number = (last._max.number ?? 0) + 1;
  const c = await tx.changeRequest.create({
    data: {
      agencyId: actor.agencyId,
      projectId,
      number,
      title: input.title,
      description: input.description,
      justification: input.justification,
      requestedById: actor.id,
      requestedByClient: byClient,
    },
  });
  await recordActivity(tx, actor, {
    entityType: 'project',
    entityId: projectId,
    eventType: 'change.requested',
    summary: `${actor.name}${byClient ? ' (client)' : ''} requested ${changeReference(number)}: “${input.title}”`,
  });
  await writeAudit(tx, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'change.request',
    outcome: 'SUCCESS',
    targetType: 'change_request',
    targetId: c.id,
    requestId,
    metadata: { projectId, byClient },
  });
  return c.id;
}

/** Tax rate for changes: the accepted proposal's, so extra work is taxed like the baseline. */
async function taxRateFor(tx: Tx, projectId: string) {
  const p = await tx.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { baselineVersion: { select: { taxRateBp: true } } },
  });
  return p.baselineVersion?.taxRateBp ?? DEFAULT_TAX_RATE_BP;
}

/** Saves the estimate on the draft version, creating version 1 (or the next one) if needed. */
export async function saveDraft(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof changeDraftSchema>,
) {
  await db.$transaction(async (tx) => {
    const { c, project } = await findManageableChange(tx, actor, id, input.version);
    const latest = c.versions[0];
    const editable =
      c.status === 'REQUESTED' || (c.status === 'ESTIMATING' && latest?.status === 'DRAFT');
    if (!editable) {
      throw conflict(
        `This change is ${CHANGE_STATUS_LABELS[c.status].toLowerCase()}, so its estimate cannot be edited.`,
      );
    }
    const currency = project.currency as Currency;
    const price = parseChangePrice(input.price, currency);
    if (price === null) {
      throw validationFailed({ price: ['Use a positive amount with at most 2 decimals.'] });
    }
    const priceMinor = BigInt(price);
    const taxRateBp = await taxRateFor(tx, project.id);
    const taxMinor = taxOn(priceMinor, taxRateBp);
    const data = {
      scope: input.scope,
      workItems: input.workItems,
      estimateMinutes: input.estimateMinutes ?? null,
      priceMinor,
      currency,
      taxRateBp,
      taxMinor,
      totalMinor: priceMinor + taxMinor,
      newDueOn: input.newDueOn ? parseDateOnly(input.newDueOn) : null,
    };
    if (latest?.status === 'DRAFT') {
      await tx.changeVersion.update({
        where: { id: latest.id },
        data: { ...data, version: { increment: 1 } },
      });
    } else {
      await tx.changeVersion.create({
        data: {
          ...data,
          agencyId: actor.agencyId,
          projectId: project.id,
          changeRequestId: c.id,
          versionNo: c.currentVersionNo + 1,
          createdById: actor.id,
        },
      });
    }
    await tx.changeRequest.update({
      where: { id: c.id },
      data: {
        status: 'ESTIMATING',
        currentVersionNo: latest?.status === 'DRAFT' ? c.currentVersionNo : c.currentVersionNo + 1,
        version: { increment: 1 },
      },
    });
    if (c.status === 'REQUESTED') {
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: project.id,
        eventType: 'change.estimating',
        summary: `${actor.name} started estimating ${changeReference(c.number)}`,
      });
    }
  });
  return getChange(db, actor, id);
}

/** A priced change goes to an Owner or Admin before the client sees it (spec J4 step 3). */
export async function submitChange(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const { c, project } = await findManageableChange(tx, actor, id, version);
    const latest = c.versions[0];
    if (c.status !== 'ESTIMATING' || latest?.status !== 'DRAFT') {
      throw conflict('Only a change being estimated can be submitted for approval.');
    }
    if (latest.priceMinor === 0n) {
      throw conflict('Changes without a price do not need approval: send it to the client.');
    }
    const now = new Date();
    await tx.changeVersion.update({
      where: { id: latest.id },
      data: { status: 'IN_REVIEW', submittedAt: now, version: { increment: 1 } },
    });
    await tx.changeRequest.update({
      where: { id: c.id },
      data: { status: 'IN_REVIEW', version: { increment: 1 } },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: project.id,
      eventType: 'change.submitted',
      summary: `${actor.name} submitted ${changeReference(c.number)} v${latest.versionNo} for approval (${formatMoney(latest.priceMinor, latest.currency as Currency)} excl. tax)`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'change.submit',
      outcome: 'SUCCESS',
      targetType: 'change_request',
      targetId: c.id,
      requestId,
      metadata: { versionNo: latest.versionNo },
    });
  });
  return getChange(db, actor, id);
}

export async function reviewChange(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof changeReviewSchema>,
  requestId: string,
) {
  if (!can(actor.role, 'changes.approve')) {
    throw forbidden('Only an owner or admin can approve a change for the client.');
  }
  await db.$transaction(async (tx) => {
    const base = await findChange(tx, actor, id);
    const project = await findReadable(tx, actor, base.projectId);
    assertNotArchived(project);
    await lockChange(tx, base.id);
    const c = await tx.changeRequest.findUniqueOrThrow({
      where: { id: base.id },
      include: changeInclude,
    });
    if (c.version !== input.version) throw staleVersion();
    const latest = c.versions[0];
    if (latest?.status !== 'IN_REVIEW') throw conflict('This change is not waiting for approval.');
    const approve = input.decision === 'APPROVE';
    await tx.changeVersion.update({
      where: { id: latest.id },
      data: approve
        ? { status: 'APPROVED_INTERNAL', approvedAt: new Date(), approvedById: actor.id }
        : { status: 'DRAFT', submittedAt: null },
    });
    await tx.changeRequest.update({
      where: { id: c.id },
      data: { status: approve ? 'IN_REVIEW' : 'ESTIMATING', version: { increment: 1 } },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: project.id,
      eventType: approve ? 'change.approved' : 'change.returned',
      summary: approve
        ? `${actor.name} approved ${changeReference(c.number)} v${latest.versionNo} for the client`
        : `${actor.name} sent ${changeReference(c.number)} back for changes`,
      body: input.comment,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: approve ? 'change.approve' : 'change.return',
      outcome: 'SUCCESS',
      targetType: 'change_request',
      targetId: c.id,
      requestId,
      metadata: { versionNo: latest.versionNo },
    });
  });
  return getChange(db, actor, id);
}

/**
 * Sends the version to the client (FR-S03): its content is hashed and frozen (DB trigger). A
 * priced change must be approved first; the shared client users get a link-only email.
 */
export async function sendChange(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  const { db, mailer, config } = deps;
  const recipients = await db.$transaction(async (tx) => {
    const { c, project } = await findManageableChange(tx, actor, id, version);
    const latest = c.versions[0];
    if (!latest) throw conflict('Estimate the change before sending it.');
    if (latest.status === 'IN_REVIEW') throw conflict('This change is still waiting for approval.');
    const ready =
      latest.status === 'APPROVED_INTERNAL' ||
      (latest.status === 'DRAFT' && latest.priceMinor === 0n);
    if (!ready) {
      throw conflict(
        latest.status === 'DRAFT'
          ? 'A priced change needs approval by an owner or admin before it is sent.'
          : 'This version was already sent.',
      );
    }
    if (!project.clientOrgId) {
      throw conflict('Link the project to a client organization before sending a change.');
    }
    const now = new Date();
    await tx.changeVersion.update({
      where: { id: latest.id },
      data: {
        status: 'SENT',
        sentAt: now,
        sentById: actor.id,
        contentHash: contentHash(c, latest),
      },
    });
    await tx.changeRequest.update({
      where: { id: c.id },
      data: { status: 'AWAITING_CLIENT', version: { increment: 1 } },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: project.id,
      eventType: 'change.sent',
      summary: `${actor.name} sent ${changeReference(c.number)} v${latest.versionNo} to the client`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'change.send',
      outcome: 'SUCCESS',
      targetType: 'change_request',
      targetId: c.id,
      requestId,
      metadata: { versionNo: latest.versionNo },
    });
    const shares = await tx.projectShare.findMany({
      where: { projectId: project.id, revokedAt: null, user: { active: true } },
      select: { user: { select: { emailNorm: true } } },
    });
    return shares.map((s) => s.user.emailNorm);
  });
  for (const to of recipients) {
    await mailer.send({
      kind: 'change_sent',
      to,
      subject: 'A change to your project is waiting for your decision',
      // Link only: scope and price stay in the portal (SEC-24).
      text: `Review it here:\n\n${config.publicUrl}/portal/changes/${id}`,
    });
  }
  return getChange(db, actor, id);
}

export async function withdrawChange(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  reason: string,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const { c, project } = await findManageableChange(tx, actor, id, version);
    if (!OPEN_CHANGE_STATUSES.includes(c.status)) {
      throw conflict(
        `A ${CHANGE_STATUS_LABELS[c.status].toLowerCase()} change cannot be withdrawn.`,
      );
    }
    await tx.changeVersion.updateMany({
      where: {
        changeRequestId: c.id,
        status: { in: ['DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL', 'SENT'] },
      },
      data: { status: 'WITHDRAWN' },
    });
    await tx.changeRequest.update({
      where: { id: c.id },
      data: { status: 'WITHDRAWN', withdrawnReason: reason, version: { increment: 1 } },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: project.id,
      eventType: 'change.withdrawn',
      summary: `${actor.name} withdrew ${changeReference(c.number)}`,
      body: reason,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'change.withdraw',
      outcome: 'SUCCESS',
      targetType: 'change_request',
      targetId: c.id,
      requestId,
    });
  });
  return getChange(db, actor, id);
}

// ---------------------------------------------------------------------------
// Client portal
// ---------------------------------------------------------------------------

/**
 * What a client sees: changes on projects shared with them that were sent to the client, or
 * that someone of their organization requested. Drafts and estimates never leave the agency.
 */
function portalChangeScope(actor: AuthUser): Prisma.ChangeRequestWhereInput {
  return {
    agencyId: actor.agencyId,
    project: portalProjectScope(actor),
    OR: [
      { versions: { some: { sentAt: { not: null } } } },
      { requestedByClient: true, requestedBy: { clientOrgId: actor.clientOrgId } },
    ],
  };
}

const portalInclude = {
  project: { select: { id: true, title: true, dueOn: true, currency: true } },
  versions: {
    where: { sentAt: { not: null } },
    orderBy: { versionNo: 'desc' },
    include: { decision: true },
  },
} as const satisfies Prisma.ChangeRequestInclude;
type PortalRow = Prisma.ChangeRequestGetPayload<{ include: typeof portalInclude }>;

function toPortalVersion(v: PortalRow['versions'][number]): PortalChangeVersion {
  return {
    id: v.id,
    versionNo: v.versionNo,
    scope: v.scope,
    workItems: workItemsFromText(v.workItems),
    priceMinor: v.priceMinor.toString(),
    taxRateBp: v.taxRateBp,
    taxMinor: v.taxMinor.toString(),
    totalMinor: v.totalMinor.toString(),
    currency: v.currency as Currency,
    newDueOn: v.newDueOn ? formatDateOnly(v.newDueOn) : null,
    contentHash: v.contentHash!,
    sentAt: v.sentAt!.toISOString(),
    decision: v.decision
      ? {
          decision: v.decision.decision,
          reason: v.decision.reason,
          at: v.decision.occurredAt.toISOString(),
        }
      : null,
  };
}

/** Status as the client sees it: internal steps all read as "being estimated". */
function portalStatus(c: { status: ChangeSummary['status'] }) {
  return c.status === 'IN_REVIEW' ? 'ESTIMATING' : c.status;
}

export async function listPortalChanges(
  db: Db,
  actor: AuthUser,
  projectId: string,
  requestId: string,
): Promise<PortalChangeSummary[]> {
  const scope = portalProjectScope(actor);
  const project = UUID_PATTERN.test(projectId)
    ? await db.project.findFirst({
        where: { AND: [scope, { id: projectId }] },
        select: { id: true },
      })
    : null;
  if (!project) {
    await logPortalDenied(db, actor, 'project', projectId, requestId);
    throw notFound();
  }
  const rows = await db.changeRequest.findMany({
    where: { AND: [portalChangeScope(actor), { projectId: project.id }] },
    include: portalInclude,
    orderBy: { number: 'desc' },
    take: 100,
  });
  return rows.map((c) => {
    const v = c.versions[0];
    return {
      id: c.id,
      reference: changeReference(c.number),
      title: c.title,
      status: portalStatus(c),
      requestedByYou: c.requestedById === actor.id,
      priceMinor: v ? v.priceMinor.toString() : null,
      totalMinor: v ? v.totalMinor.toString() : null,
      currency: c.project.currency as Currency,
      updatedAt: c.updatedAt.toISOString(),
    };
  });
}

async function findPortalChange(db: Db, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) return null;
  return db.changeRequest.findFirst({
    where: { AND: [portalChangeScope(actor), { id }] },
    include: portalInclude,
  });
}

export async function getPortalChange(
  db: Db,
  actor: AuthUser,
  id: string,
  requestId: string,
): Promise<PortalChangeDetail> {
  const c = await findPortalChange(db, actor, id);
  if (!c) {
    await logPortalDenied(db, actor, 'change', id, requestId);
    throw notFound();
  }
  const versions = c.versions.map(toPortalVersion);
  const open =
    c.status === 'AWAITING_CLIENT' && versions[0] && !versions[0].decision ? versions[0] : null;
  return {
    id: c.id,
    reference: changeReference(c.number),
    project: {
      id: c.project.id,
      title: c.project.title,
      dueOn: c.project.dueOn ? formatDateOnly(c.project.dueOn) : null,
    },
    title: c.title,
    description: c.description,
    justification: c.justification,
    status: portalStatus(c),
    requestedByYou: c.requestedById === actor.id,
    versions,
    open,
  };
}

/** A client asks for a change on a shared project (spec J4 step 1, FR-S01). */
export async function createPortalChange(
  deps: AppDeps,
  actor: AuthUser,
  projectId: string,
  input: z.output<typeof changeCreateSchema>,
  requestId: string,
) {
  const { db, mailer, config } = deps;
  const scope = portalProjectScope(actor);
  const project = UUID_PATTERN.test(projectId)
    ? await db.project.findFirst({
        where: { AND: [scope, { id: projectId }] },
        include: { manager: { select: { emailNorm: true } } },
      })
    : null;
  if (!project) {
    await logPortalDenied(db, actor, 'project', projectId, requestId);
    throw notFound();
  }
  const id = await db.$transaction((tx) =>
    insertChange(tx, actor, project.id, input, true, requestId),
  );
  await mailer.send({
    kind: 'change_requested',
    to: project.manager.emailNorm,
    subject: 'A client requested a change',
    text: `Estimate it here:\n\n${config.publicUrl}/app/projects/${project.id}/changes/${id}`,
  });
  return getPortalChange(db, actor, id, requestId);
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * The client's decision (FR-S03, FR-S04, T-SCOPE-01/02). Naming the version by the hash the
 * client saw, under row locks on the change and the project:
 * - ACCEPT: the version is accepted; the budget grows by its price; the due date moves if it sets
 *   one; tasks are created from its work items, linked to the change; before/after values are
 *   kept on the version. All in one transaction.
 * - REJECT: only the decision is recorded. Scope, budget, dates and tasks stay as they were.
 * One decision per version (unique index); the same decision again returns the same result.
 */
export async function decideOnChange(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  input: z.output<typeof changeDecisionSchema>,
  requestId: string,
) {
  const { db, mailer, config } = deps;
  const visible = await findPortalChange(db, actor, id);
  if (!visible) {
    await logPortalDenied(db, actor, 'change', id, requestId);
    throw notFound();
  }
  const wanted = input.decision === 'ACCEPT' ? 'ACCEPTED' : 'REJECTED';
  let notify: { to: string; text: string } | null = null;
  try {
    notify = await db.$transaction(async (tx) => {
      await lockChange(tx, visible.id);
      await lockProject(tx, visible.projectId);
      const c = await tx.changeRequest.findUniqueOrThrow({ where: { id: visible.id } });
      const v = await tx.changeVersion.findFirst({
        where: { changeRequestId: c.id, contentHash: input.contentHash, sentAt: { not: null } },
        include: { decision: true },
      });
      if (!v) {
        throw conflict(
          'This change was updated since you opened it. Reload to see the latest version.',
        );
      }
      if (v.decision) {
        if (v.decision.decision === wanted) return null; // same decision again: idempotent
        throw conflict('A decision was already recorded for this version.');
      }
      if (c.status !== 'AWAITING_CLIENT' || v.status !== 'SENT') {
        throw conflict('This change is no longer waiting for your decision.');
      }
      const project = await tx.project.findUniqueOrThrow({
        where: { id: c.projectId },
        include: { manager: { select: { emailNorm: true } } },
      });
      if (!(LIVE_PROJECT as readonly string[]).includes(project.state)) {
        throw conflict('This project is closed. Please contact the agency.');
      }
      await tx.changeDecision.create({
        data: {
          agencyId: actor.agencyId,
          versionId: v.id,
          actorId: actor.id,
          decision: wanted,
          reason: input.reason,
          contentHash: v.contentHash!,
        },
      });
      const ref = changeReference(c.number);
      if (wanted === 'ACCEPTED') {
        const budgetAfter = project.budgetMinor + v.priceMinor;
        await tx.changeVersion.update({
          where: { id: v.id },
          data: {
            status: 'ACCEPTED',
            budgetBeforeMinor: project.budgetMinor,
            budgetAfterMinor: budgetAfter,
            dueBefore: project.dueOn,
          },
        });
        await tx.changeRequest.update({
          where: { id: c.id },
          data: { status: 'ACCEPTED', acceptedVersionId: v.id, version: { increment: 1 } },
        });
        await tx.project.update({
          where: { id: project.id },
          data: {
            budgetMinor: budgetAfter,
            ...(v.newDueOn ? { dueOn: v.newDueOn } : {}),
            version: { increment: 1 },
          },
        });
        const items = workItemsFromText(v.workItems);
        if (items.length > 0) {
          await tx.task.createMany({
            data: items.map((title) => ({
              agencyId: actor.agencyId,
              projectId: project.id,
              title,
              scope: 'CHANGE' as const,
              changeRequestId: c.id,
              createdById: v.sentById ?? v.createdById,
            })),
          });
        }
        await recordActivity(tx, actor, {
          entityType: 'project',
          entityId: project.id,
          eventType: 'change.accepted',
          summary: `${actor.name} (client) accepted ${ref} v${v.versionNo}: budget ${formatMoney(project.budgetMinor, project.currency as Currency)} → ${formatMoney(budgetAfter, project.currency as Currency)}${items.length ? `, ${items.length} task${items.length === 1 ? '' : 's'} added` : ''}`,
        });
      } else {
        await tx.changeVersion.update({ where: { id: v.id }, data: { status: 'REJECTED' } });
        await tx.changeRequest.update({
          where: { id: c.id },
          data: { status: 'REJECTED', version: { increment: 1 } },
        });
        await recordActivity(tx, actor, {
          entityType: 'project',
          entityId: project.id,
          eventType: 'change.rejected',
          summary: `${actor.name} (client) rejected ${ref} v${v.versionNo}`,
          body: input.reason,
        });
      }
      await writeAudit(tx, {
        agencyId: actor.agencyId,
        actorId: actor.id,
        action: `change.client_${wanted.toLowerCase()}`,
        outcome: 'SUCCESS',
        targetType: 'change_request',
        targetId: c.id,
        requestId,
        metadata: { versionNo: v.versionNo, contentHash: v.contentHash },
      });
      return {
        to: project.manager.emailNorm,
        text: `A client decided on ${ref}.\n\n${config.publicUrl}/app/projects/${project.id}/changes/${c.id}`,
      };
    });
  } catch (err) {
    // Lost a race on the one-decision index: fine only if the stored decision is the same.
    if (!isUniqueViolation(err)) throw err;
    const stored = await db.changeDecision.findFirst({
      where: { version: { changeRequestId: visible.id, contentHash: input.contentHash } },
    });
    if (stored?.decision !== wanted)
      throw conflict('A decision was already recorded for this version.');
  }
  if (notify) {
    await mailer.send({
      kind: 'change_decision',
      to: notify.to,
      subject: 'A client decided on a change request',
      text: notify.text,
    });
  }
  return getPortalChange(db, actor, id, requestId);
}
