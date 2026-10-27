import { createHash } from 'node:crypto';
import {
  can,
  changeReference,
  DEFAULT_HANDOFF_CHECKLIST,
  formatQuantity,
  parseMoneyToMinor,
  PROJECT_STATE_LABELS,
  PROJECT_TRANSITIONS,
  proposalReference,
  type convertDealSchema,
  type Currency,
  type DeliveryDashboard,
  type HandoffCandidate,
  type milestoneCreateSchema,
  type milestoneUpdateSchema,
  type ProjectDetail,
  type ProjectShares,
  type ProjectState,
  type ProjectSummary,
  type projectCreateSchema,
  type projectUpdateSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import { Prisma } from '../../generated/prisma/client.js';
import { addDays, agencyToday, formatDateOnly, parseDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { actorSelect, recordActivity, toTimelineEntry } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import {
  canManage,
  canWork,
  findManageable,
  findReadable,
  lockProject,
  projectReadScope,
  type Tx,
} from './access.js';

export { projectReadScope } from './access.js';

const MANAGER_ROLES = ['OWNER', 'ADMIN', 'PM'] as const;
const MEMBER_ROLES = ['OWNER', 'ADMIN', 'PM', 'MEMBER'] as const;
const CONVERT_SCOPE = 'deal.convert_to_project';

async function assertManagerCandidate(db: Db | Tx, agencyId: string, userId: string) {
  const u = await db.user.findFirst({
    where: { id: userId, agencyId, active: true, role: { in: [...MANAGER_ROLES] } },
    select: { id: true },
  });
  if (!u)
    throw validationFailed({ managerId: ['Choose an active project manager, admin or owner.'] });
}

// ---------------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------------

const summaryInclude = {
  manager: { select: { id: true, name: true } },
  deal: { select: { id: true, title: true } },
  contact: { select: { id: true, fullName: true, companyName: true } },
  clientOrg: { select: { id: true, name: true } },
  milestones: { select: { status: true } },
} as const satisfies Prisma.ProjectInclude;
type SummaryRow = Prisma.ProjectGetPayload<{ include: typeof summaryInclude }>;

function toSummary(p: SummaryRow): ProjectSummary {
  return {
    id: p.id,
    title: p.title,
    state: p.state,
    manager: { id: p.manager.id, name: p.manager.name },
    client: p.clientOrg?.name ?? p.contact?.companyName ?? p.contact?.fullName ?? null,
    startOn: p.startOn ? formatDateOnly(p.startOn) : null,
    dueOn: p.dueOn ? formatDateOnly(p.dueOn) : null,
    budgetMinor: p.budgetMinor.toString(),
    currency: p.currency as Currency,
    fromDeal: p.deal ? { id: p.deal.id, title: p.deal.title } : null,
    milestones: {
      total: p.milestones.length,
      done: p.milestones.filter((m) => m.status === 'DONE').length,
    },
    updatedAt: p.updatedAt.toISOString(),
    version: p.version,
  };
}

export async function getProject(db: Db, actor: AuthUser, id: string): Promise<ProjectDetail> {
  const base = await findReadable(db, actor, id);
  const p = await db.project.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      ...summaryInclude,
      members: {
        include: { user: { select: { id: true, name: true, role: true } } },
        orderBy: { addedAt: 'asc' },
      },
      milestones: { orderBy: { sequence: 'asc' } },
      checklist: {
        orderBy: { sequence: 'asc' },
        include: { doneBy: { select: { id: true, name: true } } },
      },
      baselineVersion: {
        include: {
          items: { orderBy: { position: 'asc' } },
          proposal: { select: { id: true, number: true } },
          reviews: {
            where: { kind: 'CLIENT', decision: 'ACCEPTED' },
            include: { actor: { select: { name: true } } },
          },
        },
      },
    },
  });
  // US-12: the agreed scope is the accepted proposal plus every accepted change.
  const acceptedChanges = await db.changeRequest.findMany({
    where: { projectId: p.id, status: 'ACCEPTED' },
    include: { acceptedVersion: { include: { decision: true } } },
    orderBy: { number: 'asc' },
  });
  const added = acceptedChanges.reduce((sum, c) => sum + (c.acceptedVersion?.priceMinor ?? 0n), 0n);
  const scopeHistory = {
    originalBudgetMinor: (p.budgetMinor - added).toString(),
    currentBudgetMinor: p.budgetMinor.toString(),
    currency: p.currency as Currency,
    changes: acceptedChanges.map((c) => ({
      id: c.id,
      reference: changeReference(c.number),
      title: c.title,
      priceMinor: (c.acceptedVersion?.priceMinor ?? 0n).toString(),
      acceptedAt: (c.acceptedVersion?.decision?.occurredAt ?? c.updatedAt).toISOString(),
      newDueOn: c.acceptedVersion?.newDueOn ? formatDateOnly(c.acceptedVersion.newDueOn) : null,
    })),
  };
  const activities = await db.activity.findMany({
    where: { agencyId: actor.agencyId, entityType: 'project', entityId: p.id },
    include: actorSelect,
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 50,
  });
  const v = p.baselineVersion;
  const accepted = v?.reviews[0];
  return {
    ...toSummary({ ...p, milestones: p.milestones }),
    contact: p.contact ? { id: p.contact.id, fullName: p.contact.fullName } : null,
    members: p.members.map((m) => ({ id: m.user.id, name: m.user.name, role: m.user.role })),
    baseline: v
      ? {
          proposalId: v.proposal.id,
          reference: proposalReference(v.proposal.number),
          versionNo: v.versionNo,
          title: v.title,
          acceptedAt: accepted?.occurredAt.toISOString() ?? null,
          acceptedBy: accepted?.actor.name ?? null,
          currency: v.currency as Currency,
          summary: v.summary,
          inclusions: v.inclusions,
          exclusions: v.exclusions,
          assumptions: v.assumptions,
          milestones: v.milestones,
          paymentTerms: v.paymentTerms,
          items: v.items.map((i) => ({
            id: i.id,
            position: i.position,
            serviceId: i.serviceId,
            name: i.name,
            description: i.description,
            unit: i.unit,
            quantity: formatQuantity(i.quantityCenti),
            quantityCenti: i.quantityCenti,
            unitPriceMinor: i.unitPriceMinor.toString(),
            lineTotalMinor: i.lineTotalMinor.toString(),
          })),
          subtotalMinor: v.subtotalMinor.toString(),
          discountMinor: v.discountMinor.toString(),
          taxMinor: v.taxMinor.toString(),
          totalMinor: v.totalMinor.toString(),
        }
      : null,
    milestoneList: p.milestones.map((m) => ({
      id: m.id,
      title: m.title,
      dueOn: m.dueOn ? formatDateOnly(m.dueOn) : null,
      status: m.status,
      sequence: m.sequence,
      version: m.version,
    })),
    checklist: p.checklist.map((c) => ({
      id: c.id,
      label: c.label,
      done: c.doneAt !== null,
      doneAt: c.doneAt?.toISOString() ?? null,
      doneBy: c.doneBy ? { id: c.doneBy.id, name: c.doneBy.name } : null,
    })),
    activities: activities.map(toTimelineEntry),
    scopeHistory,
    clientOrg: p.clientOrg ? { id: p.clientOrg.id, name: p.clientOrg.name } : null,
    access: { manage: canManage(actor, p) && p.state !== 'ARCHIVED', work: canWork(actor) },
  };
}

export async function listProjects(db: Db, actor: AuthUser, state?: ProjectState) {
  const rows = await db.project.findMany({
    where: { AND: [projectReadScope(actor), state ? { state } : { state: { not: 'ARCHIVED' } }] },
    include: summaryInclude,
    orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
    take: 200,
  });
  return rows.map(toSummary);
}

// ---------------------------------------------------------------------------
// Handoff (FR-P01, FR-P02, FR-Q10, US-10, US-18, T-HAND-01/02)
// ---------------------------------------------------------------------------

/** Won deals with a client-accepted proposal and no project yet. */
export async function getHandoffQueue(db: Db, actor: AuthUser): Promise<HandoffCandidate[]> {
  if (!can(actor.role, 'projects.create')) throw forbidden('Your role cannot start projects.');
  const deals = await db.deal.findMany({
    where: {
      agencyId: actor.agencyId,
      status: 'WON',
      acceptedProposalVersionId: { not: null },
      project: null,
    },
    include: {
      contact: { select: { fullName: true, companyName: true } },
      owner: { select: { name: true } },
      acceptedProposalVersion: {
        select: { versionNo: true, proposal: { select: { id: true, number: true } } },
      },
    },
    orderBy: { closedAt: 'asc' },
    take: 100,
  });
  return deals.map((d) => ({
    dealId: d.id,
    title: d.title,
    contact: d.contact.companyName ?? d.contact.fullName,
    owner: d.owner.name,
    amountMinor: d.amountMinor.toString(),
    currency: d.currency as Currency,
    wonAt: d.closedAt?.toISOString() ?? null,
    proposal: {
      id: d.acceptedProposalVersion!.proposal.id,
      reference: proposalReference(d.acceptedProposalVersion!.proposal.number),
      versionNo: d.acceptedProposalVersion!.versionNo,
    },
  }));
}

/** Milestones from the accepted proposal's text: one per line (or per "·", ";" or "|"). */
export function milestonesFromText(text: string | null): string[] {
  if (!text) return ['Kick-off', 'Delivery', 'Handover'];
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const parts = lines.length > 1 ? lines : (lines[0] ?? '').split(/\s*[·;|]\s*/);
  const titles = parts
    .map((t) =>
      t
        .replace(/^[-*•\d.)\s]+/, '')
        .trim()
        .slice(0, 200),
    )
    .filter(Boolean)
    .slice(0, 20);
  return titles.length > 0 ? titles : ['Kick-off', 'Delivery', 'Handover'];
}

function requestHash(dealId: string, input: z.output<typeof convertDealSchema>) {
  const canonical = JSON.stringify([
    dealId,
    input.managerId,
    input.title ?? null,
    input.startOn ?? null,
    input.dueOn ?? null,
  ]);
  return createHash('sha256').update(canonical).digest('hex');
}

function isUniqueViolation(err: unknown) {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002';
}

/**
 * Converts a won deal into a project in ONE transaction (spec §11.6 example): lock the deal,
 * check it is won with a client-accepted proposal and has no project, create the project, its
 * milestones, checklist and history, and store the idempotency result. A retry with the same key
 * returns the same project (T-HAND-01); a different key for the same deal gets 409; any failure
 * rolls everything back (T-HAND-02). The unique deal → project link is the final guard.
 */
export async function convertDealToProject(
  deps: AppDeps,
  actor: AuthUser,
  dealId: string,
  key: string,
  input: z.output<typeof convertDealSchema>,
  requestId: string,
): Promise<{ projectId: string; replayed: boolean }> {
  const { db } = deps;
  if (!can(actor.role, 'projects.create')) throw forbidden('Your role cannot start projects.');
  if (!UUID_PATTERN.test(dealId)) throw notFound();
  const hash = requestHash(dealId, input);

  const replay = async (tx: Db | Tx) => {
    const rec = await tx.idempotencyRecord.findUnique({
      where: { agencyId_scope_key: { agencyId: actor.agencyId, scope: CONVERT_SCOPE, key } },
    });
    if (!rec) return null;
    if (rec.requestHash !== hash || rec.actorId !== actor.id) {
      throw conflict('This Idempotency-Key was already used for a different request.');
    }
    return rec.resultId;
  };

  const earlier = await replay(db);
  if (earlier) return { projectId: earlier, replayed: true };

  try {
    return await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM deals WHERE id = CAST(${dealId} AS uuid) FOR UPDATE`;
      // A concurrent request with the same key may have committed while we waited for the lock.
      const raced = await replay(tx);
      if (raced) return { projectId: raced, replayed: true };

      const deal = await tx.deal.findFirst({
        where: { id: dealId, agencyId: actor.agencyId },
        include: {
          project: { select: { id: true } },
          contact: { select: { id: true, fullName: true } },
          acceptedProposalVersion: { include: { proposal: true } },
        },
      });
      if (!deal) throw notFound();
      if (deal.status !== 'WON') throw conflict('Only won deals can become projects.');
      if (deal.project) throw conflict('This deal already has a project.');
      const v = deal.acceptedProposalVersion;
      if (!v) {
        throw conflict(
          'This deal was won without a client-accepted proposal, so there is no agreed scope to hand off. Create the project manually instead.',
        );
      }
      await assertManagerCandidate(tx, actor.agencyId, input.managerId);

      const reference = proposalReference(v.proposal.number);
      const project = await tx.project.create({
        data: {
          agencyId: actor.agencyId,
          title: input.title ?? deal.title,
          dealId: deal.id,
          baselineVersionId: v.id,
          contactId: deal.contactId,
          clientOrgId: v.proposal.clientOrgId,
          managerId: input.managerId,
          startOn: input.startOn ? parseDateOnly(input.startOn) : null,
          dueOn: input.dueOn ? parseDateOnly(input.dueOn) : null,
          // Budget baseline excludes tax: what the agency earns for the work (ADR-039).
          budgetMinor: v.subtotalMinor - v.discountMinor,
          currency: v.currency,
          createdById: actor.id,
          milestones: {
            create: milestonesFromText(v.milestones).map((t, i) => ({
              title: t,
              sequence: i,
            })),
          },
          checklist: {
            create: DEFAULT_HANDOFF_CHECKLIST.map((label, i) => ({
              label,
              sequence: i,
            })),
          },
        },
      });
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: project.id,
        eventType: 'project.created',
        summary: `Project created from deal “${deal.title}” (${reference} v${v.versionNo}) by ${actor.name}`,
      });
      for (const [entityType, entityId] of [
        ['deal', deal.id],
        ['contact', deal.contactId],
      ] as const) {
        await recordActivity(tx, actor, {
          entityType,
          entityId,
          eventType: 'deal.handoff',
          summary: `Handed off to delivery as project “${project.title}” by ${actor.name}`,
        });
      }
      await writeAudit(tx, {
        agencyId: actor.agencyId,
        actorId: actor.id,
        action: 'project.convert',
        outcome: 'SUCCESS',
        targetType: 'project',
        targetId: project.id,
        requestId,
        metadata: { dealId: deal.id, baselineVersionId: v.id },
      });
      // Test-only fault injection point for T-HAND-02 (never set in the running app).
      await deps.hooks?.beforeHandoffCommit?.();
      await tx.idempotencyRecord.create({
        data: {
          agencyId: actor.agencyId,
          actorId: actor.id,
          scope: CONVERT_SCOPE,
          key,
          requestHash: hash,
          resultId: project.id,
        },
      });
      return { projectId: project.id, replayed: false };
    });
  } catch (err) {
    // Lost a race on a unique index: answer from whatever the winner stored.
    if (!isUniqueViolation(err)) throw err;
    const winner = await replay(db);
    if (winner) return { projectId: winner, replayed: true };
    throw conflict('This deal already has a project.');
  }
}

/** Manual project without a deal: Owner, Admin and PM only (FR-P01). */
export async function createProject(
  db: Db,
  actor: AuthUser,
  input: z.output<typeof projectCreateSchema>,
  requestId: string,
) {
  if (!can(actor.role, 'projects.create')) throw forbidden('Your role cannot start projects.');
  await assertManagerCandidate(db, actor.agencyId, input.managerId);
  const budget = input.budget ? parseMoneyToMinor(input.budget, input.currency) : '0';
  if (budget === null)
    throw validationFailed({ budget: ['Use a positive amount with at most 2 decimals.'] });
  const id = await db.$transaction(async (tx) => {
    const project = await tx.project.create({
      data: {
        agencyId: actor.agencyId,
        title: input.title,
        managerId: input.managerId,
        startOn: input.startOn ? parseDateOnly(input.startOn) : null,
        dueOn: input.dueOn ? parseDateOnly(input.dueOn) : null,
        budgetMinor: BigInt(budget),
        currency: input.currency,
        createdById: actor.id,
        checklist: {
          create: DEFAULT_HANDOFF_CHECKLIST.map((label, i) => ({
            label,
            sequence: i,
          })),
        },
      },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: project.id,
      eventType: 'project.created',
      summary: `Project created by ${actor.name} (no deal)`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'project.create',
      outcome: 'SUCCESS',
      targetType: 'project',
      targetId: project.id,
      requestId,
    });
    return project.id;
  });
  return getProject(db, actor, id);
}

// ---------------------------------------------------------------------------
// Changes
// ---------------------------------------------------------------------------

async function bump(
  tx: Tx,
  id: string,
  version: number,
  data: Prisma.ProjectUncheckedUpdateManyInput,
) {
  const res = await tx.project.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) throw staleVersion();
}

export async function updateProject(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof projectUpdateSchema>,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    if (p.version !== input.version) throw staleVersion();
    if (input.managerId !== undefined && input.managerId !== p.managerId) {
      if (!can(actor.role, 'projects.read.all')) {
        throw forbidden('Only an owner or admin can change the project manager.');
      }
      await assertManagerCandidate(tx, actor.agencyId, input.managerId);
    }
    const clientOrgChanged = input.clientOrgId !== undefined && input.clientOrgId !== p.clientOrgId;
    if (clientOrgChanged) {
      if (p.dealId) {
        throw conflict('A handed-off project keeps the client of its accepted proposal.');
      }
      if (input.clientOrgId) {
        const org = await tx.clientOrganization.findFirst({
          where: { id: input.clientOrgId, agencyId: actor.agencyId, archivedAt: null },
          select: { id: true },
        });
        if (!org)
          throw validationFailed({ clientOrgId: ['Choose an active client organization.'] });
      }
      // Portal access belonged to the old organization's people: end it (FR-X01).
      await tx.projectShare.updateMany({
        where: { projectId: p.id, revokedAt: null },
        data: { revokedAt: new Date(), revokedById: actor.id },
      });
    }
    const startOn =
      input.startOn === undefined ? p.startOn : input.startOn ? parseDateOnly(input.startOn) : null;
    const dueOn =
      input.dueOn === undefined ? p.dueOn : input.dueOn ? parseDateOnly(input.dueOn) : null;
    if (startOn && dueOn && startOn > dueOn) {
      throw validationFailed({ dueOn: ['The due date is before the start date.'] });
    }
    await bump(tx, p.id, input.version, {
      ...(input.title !== undefined ? { title: input.title } : {}),
      ...(input.managerId !== undefined ? { managerId: input.managerId } : {}),
      ...(clientOrgChanged ? { clientOrgId: input.clientOrgId ?? null } : {}),
      startOn,
      dueOn,
    });
    const changed = (['title', 'managerId', 'clientOrgId', 'startOn', 'dueOn'] as const).filter(
      (k) => input[k] !== undefined,
    );
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'project.updated',
      summary: `${actor.name} updated ${changed.join(', ').replace('managerId', 'manager').replace('clientOrgId', 'client organization') || 'the project'}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'project.update',
      outcome: 'SUCCESS',
      targetType: 'project',
      targetId: p.id,
      requestId,
      metadata: { changed: changed.join(',') },
    });
  });
  return getProject(db, actor, id);
}

export async function changeProjectState(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  next: ProjectState,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    if (p.version !== version) throw staleVersion();
    if (p.state === next) return;
    if (!PROJECT_TRANSITIONS[p.state].includes(next)) {
      throw conflict(
        `A ${PROJECT_STATE_LABELS[p.state].toLowerCase()} project cannot become ${PROJECT_STATE_LABELS[next].toLowerCase()}.`,
      );
    }
    // Spec §9: completion waits for open client approvals; archiving a deliverable waives it.
    if (next === 'COMPLETED') {
      const waiting = await tx.deliverable.count({
        where: { projectId: p.id, status: 'PUBLISHED' },
      });
      if (waiting > 0) {
        throw conflict(
          `${waiting === 1 ? 'A deliverable is' : `${waiting} deliverables are`} still waiting for the client's decision. Wait for it, or archive it to waive the approval.`,
        );
      }
      const changes = await tx.changeRequest.count({
        where: { projectId: p.id, status: 'AWAITING_CLIENT' },
      });
      if (changes > 0) {
        throw conflict(
          'A change request is waiting for the client. Wait for their decision, or withdraw it.',
        );
      }
    }
    await bump(tx, p.id, version, { state: next });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'project.state',
      summary: `${actor.name} moved the project from ${PROJECT_STATE_LABELS[p.state]} to ${PROJECT_STATE_LABELS[next]}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'project.state',
      outcome: 'SUCCESS',
      targetType: 'project',
      targetId: p.id,
      requestId,
      metadata: { from: p.state, to: next },
    });
  });
  return getProject(db, actor, id);
}

export async function addMember(
  db: Db,
  actor: AuthUser,
  id: string,
  userId: string,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    const u = await tx.user.findFirst({
      where: {
        id: userId,
        agencyId: actor.agencyId,
        active: true,
        role: { in: [...MEMBER_ROLES] },
      },
      select: { id: true, name: true },
    });
    if (!u) throw validationFailed({ userId: ['Choose an active delivery team member.'] });
    if (u.id === p.managerId) throw conflict('The project manager is already on the project.');
    const created = await tx.projectMember.createMany({
      data: [{ projectId: p.id, agencyId: actor.agencyId, userId: u.id }],
      skipDuplicates: true,
    });
    if (created.count === 0) return; // already a member: idempotent
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'project.member_added',
      summary: `${u.name} joined the project (added by ${actor.name})`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'project.member_add',
      outcome: 'SUCCESS',
      targetType: 'project',
      targetId: p.id,
      requestId,
      metadata: { userId: u.id },
    });
  });
  return getProject(db, actor, id);
}

export async function removeMember(
  db: Db,
  actor: AuthUser,
  id: string,
  userId: string,
  requestId: string,
) {
  if (!UUID_PATTERN.test(userId)) throw notFound();
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    const res = await tx.projectMember.deleteMany({ where: { projectId: p.id, userId } });
    if (res.count === 0) return;
    // Their open tasks go back to the manager's queue: they can no longer see the project.
    await tx.task.updateMany({
      where: { projectId: p.id, assigneeId: userId, status: { notIn: ['DONE', 'CANCELED'] } },
      data: { assigneeId: null, version: { increment: 1 } },
    });
    const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'project.member_removed',
      summary: `${u?.name ?? 'A member'} left the project (removed by ${actor.name})`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'project.member_remove',
      outcome: 'SUCCESS',
      targetType: 'project',
      targetId: p.id,
      requestId,
      metadata: { userId },
    });
  });
  return getProject(db, actor, id);
}

export async function addMilestone(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof milestoneCreateSchema>,
) {
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    // Serialize sequence allocation per project.
    await lockProject(tx, p.id);
    const last = await tx.projectMilestone.aggregate({
      where: { projectId: p.id },
      _max: { sequence: true },
    });
    await tx.projectMilestone.create({
      data: {
        projectId: p.id,
        agencyId: actor.agencyId,
        title: input.title,
        dueOn: input.dueOn ? parseDateOnly(input.dueOn) : null,
        sequence: (last._max.sequence ?? -1) + 1,
      },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'milestone.created',
      summary: `Milestone “${input.title}” added by ${actor.name}`,
    });
  });
  return getProject(db, actor, id);
}

export async function updateMilestone(
  db: Db,
  actor: AuthUser,
  id: string,
  milestoneId: string,
  input: z.output<typeof milestoneUpdateSchema>,
) {
  if (!UUID_PATTERN.test(milestoneId)) throw notFound();
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    const m = await tx.projectMilestone.findFirst({ where: { id: milestoneId, projectId: p.id } });
    if (!m) throw notFound();
    const res = await tx.projectMilestone.updateMany({
      where: { id: m.id, version: input.version },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.dueOn !== undefined
          ? { dueOn: input.dueOn ? parseDateOnly(input.dueOn) : null }
          : {}),
        ...(input.status !== undefined ? { status: input.status } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw staleVersion();
    if (input.status && input.status !== m.status) {
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: p.id,
        eventType: 'milestone.status',
        summary: `Milestone “${input.title ?? m.title}” marked ${input.status.replace('_', ' ').toLowerCase()} by ${actor.name}`,
      });
    }
  });
  return getProject(db, actor, id);
}

/** Swaps a milestone with its neighbour (closes M6 open item O24). The first/last stays put. */
export async function moveMilestone(
  db: Db,
  actor: AuthUser,
  id: string,
  milestoneId: string,
  direction: 'up' | 'down',
) {
  if (!UUID_PATTERN.test(milestoneId)) throw notFound();
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    await lockProject(tx, p.id);
    const m = await tx.projectMilestone.findFirst({ where: { id: milestoneId, projectId: p.id } });
    if (!m) throw notFound();
    const neighbour = await tx.projectMilestone.findFirst({
      where: {
        projectId: p.id,
        sequence: direction === 'up' ? { lt: m.sequence } : { gt: m.sequence },
      },
      orderBy: { sequence: direction === 'up' ? 'desc' : 'asc' },
    });
    if (!neighbour) return;
    // (project_id, sequence) is unique, so park one row on a free number first.
    const last = await tx.projectMilestone.aggregate({
      where: { projectId: p.id },
      _max: { sequence: true },
    });
    const parked = (last._max.sequence ?? 0) + 1;
    await tx.projectMilestone.update({ where: { id: m.id }, data: { sequence: parked } });
    await tx.projectMilestone.update({
      where: { id: neighbour.id },
      data: { sequence: m.sequence, version: { increment: 1 } },
    });
    await tx.projectMilestone.update({
      where: { id: m.id },
      data: { sequence: neighbour.sequence, version: { increment: 1 } },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'milestone.moved',
      summary: `Milestone “${m.title}” moved ${direction} by ${actor.name}`,
    });
  });
  return getProject(db, actor, id);
}

// ---------------------------------------------------------------------------
// Portal sharing (FR-X01): named client users of the project's client organization
// ---------------------------------------------------------------------------

export async function listShares(db: Db, actor: AuthUser, id: string): Promise<ProjectShares> {
  const p = await findReadable(db, actor, id);
  if (!canManage(actor, p))
    throw forbidden('Only the project manager or an admin can share this project.');
  if (!p.clientOrgId) return { clientOrg: null, people: [] };
  const [org, users, shares] = await Promise.all([
    db.clientOrganization.findUniqueOrThrow({
      where: { id: p.clientOrgId },
      select: { id: true, name: true },
    }),
    db.user.findMany({
      where: { agencyId: actor.agencyId, role: 'CLIENT', clientOrgId: p.clientOrgId },
      select: { id: true, name: true, emailNorm: true, active: true },
      orderBy: { name: 'asc' },
    }),
    db.projectShare.findMany({ where: { projectId: p.id, revokedAt: null } }),
  ]);
  const active = new Map(shares.map((s) => [s.userId, s]));
  return {
    clientOrg: org,
    people: users.map((u) => ({
      user: { id: u.id, name: u.name, email: u.emailNorm, active: u.active },
      shared: active.has(u.id),
      sharedAt: active.get(u.id)?.sharedAt.toISOString() ?? null,
    })),
  };
}

export async function shareProject(
  db: Db,
  actor: AuthUser,
  id: string,
  userId: string,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    if (!p.clientOrgId) {
      throw conflict('Link the project to a client organization before sharing it.');
    }
    const u = await tx.user.findFirst({
      where: {
        id: userId,
        agencyId: actor.agencyId,
        role: 'CLIENT',
        clientOrgId: p.clientOrgId,
        active: true,
      },
      select: { id: true, name: true },
    });
    if (!u) {
      throw validationFailed({
        userId: ["Choose an active portal user of the project's client organization."],
      });
    }
    const existing = await tx.projectShare.findUnique({
      where: { projectId_userId: { projectId: p.id, userId: u.id } },
    });
    if (existing && !existing.revokedAt) return; // already shared: idempotent
    if (existing) {
      await tx.projectShare.update({
        where: { id: existing.id },
        data: { revokedAt: null, revokedById: null, sharedAt: new Date(), sharedById: actor.id },
      });
    } else {
      await tx.projectShare.create({
        data: { agencyId: actor.agencyId, projectId: p.id, userId: u.id, sharedById: actor.id },
      });
    }
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'project.shared',
      summary: `${actor.name} shared the project with ${u.name} (client portal)`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'project.share',
      outcome: 'SUCCESS',
      targetType: 'project',
      targetId: p.id,
      requestId,
      metadata: { userId: u.id },
    });
  });
  return listShares(db, actor, id);
}

/** Ends a client's access at once: the next portal request no longer sees the project. */
export async function revokeShare(
  db: Db,
  actor: AuthUser,
  id: string,
  userId: string,
  requestId: string,
) {
  if (!UUID_PATTERN.test(userId)) throw notFound();
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    const res = await tx.projectShare.updateMany({
      where: { projectId: p.id, userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedById: actor.id },
    });
    if (res.count === 0) return; // not shared: idempotent
    const u = await tx.user.findUnique({ where: { id: userId }, select: { name: true } });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'project.unshared',
      summary: `${actor.name} removed portal access for ${u?.name ?? 'a client user'}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'project.unshare',
      outcome: 'SUCCESS',
      targetType: 'project',
      targetId: p.id,
      requestId,
      metadata: { userId },
    });
  });
  return listShares(db, actor, id);
}

export async function toggleChecklist(
  db: Db,
  actor: AuthUser,
  id: string,
  itemId: string,
  done: boolean,
) {
  if (!UUID_PATTERN.test(itemId)) throw notFound();
  await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, id);
    const item = await tx.handoffChecklistItem.findFirst({
      where: { id: itemId, projectId: p.id },
    });
    if (!item) throw notFound();
    if ((item.doneAt !== null) === done) return; // idempotent
    await tx.handoffChecklistItem.update({
      where: { id: item.id },
      data: done ? { doneAt: new Date(), doneById: actor.id } : { doneAt: null, doneById: null },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'checklist.toggle',
      summary: `${actor.name} ${done ? 'completed' : 'reopened'} “${item.label}”`,
    });
  });
  return getProject(db, actor, id);
}

// ---------------------------------------------------------------------------
// Delivery dashboard (FR-F08 project part)
// ---------------------------------------------------------------------------

export async function getDeliveryDashboard(
  db: Db,
  actor: AuthUser,
  timeZone: string,
): Promise<DeliveryDashboard> {
  if (!can(actor.role, 'dashboard.delivery'))
    throw forbidden('Your role has no delivery dashboard.');
  const scope = projectReadScope(actor);
  const today = agencyToday(new Date(), timeZone);
  const liveProject: Prisma.ProjectWhereInput = {
    AND: [scope, { state: { in: ['PLANNED', 'ACTIVE', 'ON_HOLD'] } }],
  };
  const openMilestone: Prisma.ProjectMilestoneWhereInput = {
    status: { not: 'DONE' },
    dueOn: { not: null },
    project: liveProject,
  };
  const [byState, overdue, soon, upcoming, waiting, awaitingClient, reviewsOverdue, myTasks] =
    await Promise.all([
      db.project.groupBy({ by: ['state'], where: scope, _count: { _all: true } }),
      db.projectMilestone.count({
        where: { ...openMilestone, dueOn: { lt: parseDateOnly(today) } },
      }),
      db.projectMilestone.count({
        where: {
          ...openMilestone,
          dueOn: { gte: parseDateOnly(today), lte: parseDateOnly(addDays(today, 7)) },
        },
      }),
      db.projectMilestone.findMany({
        where: openMilestone,
        include: { project: { select: { id: true, title: true } } },
        orderBy: { dueOn: 'asc' },
        take: 10,
      }),
      can(actor.role, 'projects.create')
        ? db.deal.count({
            where: {
              agencyId: actor.agencyId,
              status: 'WON',
              acceptedProposalVersionId: { not: null },
              project: null,
            },
          })
        : Promise.resolve(null),
      db.deliverable.count({ where: { status: 'PUBLISHED', project: liveProject } }),
      db.deliverable.count({
        where: {
          status: 'PUBLISHED',
          reviewDueOn: { lt: parseDateOnly(today) },
          project: liveProject,
        },
      }),
      db.task.findMany({
        where: {
          assigneeId: actor.id,
          status: { notIn: ['DONE', 'CANCELED'] },
          project: liveProject,
        },
        include: { project: { select: { id: true, title: true } } },
        orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
        take: 10,
      }),
    ]);
  const projects = { PLANNED: 0, ACTIVE: 0, ON_HOLD: 0, COMPLETED: 0, ARCHIVED: 0 } as Record<
    ProjectState,
    number
  >;
  for (const r of byState) projects[r.state] = r._count._all;
  return {
    projects,
    milestones: { overdue, dueIn7Days: soon },
    handoffWaiting: waiting,
    deliverables: { awaitingClient, overdue: reviewsOverdue },
    myTasks: myTasks.map((t) => ({
      id: t.id,
      title: t.title,
      projectId: t.project.id,
      projectTitle: t.project.title,
      status: t.status,
      dueOn: t.dueOn ? formatDateOnly(t.dueOn) : null,
      overdue: t.dueOn ? formatDateOnly(t.dueOn) < today : false,
    })),
    upcoming: upcoming.map((m) => ({
      projectId: m.project.id,
      projectTitle: m.project.title,
      milestone: m.title,
      dueOn: formatDateOnly(m.dueOn!),
      overdue: formatDateOnly(m.dueOn!) < today,
    })),
  };
}

/** Client organizations a manual project can be linked to (names only). */
export async function listClientOrgOptions(db: Db, actor: AuthUser) {
  if (!can(actor.role, 'projects.manage')) throw forbidden('Your role cannot change projects.');
  return db.clientOrganization.findMany({
    where: { agencyId: actor.agencyId, archivedAt: null },
    select: { id: true, name: true },
    orderBy: { name: 'asc' },
    take: 500,
  });
}

/** People who can lead or join projects, for the manager and member pickers. */
export async function listDeliveryStaff(db: Db, actor: AuthUser) {
  if (!can(actor.role, 'projects.create') && !can(actor.role, 'projects.manage')) {
    throw forbidden('Your role cannot staff projects.');
  }
  return db.user.findMany({
    where: { agencyId: actor.agencyId, active: true, role: { in: [...MEMBER_ROLES] } },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
}
