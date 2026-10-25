import { createHash } from 'node:crypto';
import {
  can,
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
import { dealReadScope } from '../deals/policy.js';

type Tx = Prisma.TransactionClient;
const MANAGER_ROLES = ['OWNER', 'ADMIN', 'PM'] as const;
const MEMBER_ROLES = ['OWNER', 'ADMIN', 'PM', 'MEMBER'] as const;
const CONVERT_SCOPE = 'deal.convert_to_project';

// ---------------------------------------------------------------------------
// Policy (spec §1.1: A for Owner/Admin, P for PM/members, "Read linked" for sales)
// ---------------------------------------------------------------------------

export function projectReadScope(actor: AuthUser): Prisma.ProjectWhereInput {
  const base = { agencyId: actor.agencyId };
  if (can(actor.role, 'projects.read.all')) return base;
  if (can(actor.role, 'projects.read.member')) {
    return { ...base, OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] };
  }
  if (can(actor.role, 'projects.read.linked')) return { ...base, deal: dealReadScope(actor) };
  throw forbidden('Your role does not have access to projects.');
}

/** Owners/Admins manage every project; a PM manages the projects they lead. Sales read only. */
function canManage(actor: AuthUser, project: { managerId: string }) {
  if (!can(actor.role, 'projects.manage')) return false;
  return can(actor.role, 'projects.read.all') || project.managerId === actor.id;
}

async function findReadable(db: Db | Tx, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const p = await db.project.findFirst({ where: { AND: [projectReadScope(actor), { id }] } });
  if (!p) throw notFound();
  return p;
}

/** Loads a project the actor may change. Archived projects are history: read-only (FR-P11). */
async function findManageable(db: Db | Tx, actor: AuthUser, id: string) {
  const p = await findReadable(db, actor, id);
  if (!canManage(actor, p))
    throw forbidden('Only the project manager or an admin can change this project.');
  if (p.state === 'ARCHIVED') throw conflict('Archived projects are read-only.');
  return p;
}

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
  clientOrg: { select: { name: true } },
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
    access: { manage: canManage(actor, p) && p.state !== 'ARCHIVED' },
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
      startOn,
      dueOn,
    });
    const changed = (['title', 'managerId', 'startOn', 'dueOn'] as const).filter(
      (k) => input[k] !== undefined,
    );
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'project.updated',
      summary: `${actor.name} updated ${changed.join(', ').replace('managerId', 'manager') || 'the project'}`,
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
    await tx.$queryRaw`SELECT id FROM projects WHERE id = CAST(${p.id} AS uuid) FOR UPDATE`;
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
  const openMilestone: Prisma.ProjectMilestoneWhereInput = {
    status: { not: 'DONE' },
    dueOn: { not: null },
    project: { AND: [scope, { state: { in: ['PLANNED', 'ACTIVE', 'ON_HOLD'] } }] },
  };
  const [byState, overdue, soon, upcoming, waiting] = await Promise.all([
    db.project.groupBy({ by: ['state'], where: scope, _count: { _all: true } }),
    db.projectMilestone.count({ where: { ...openMilestone, dueOn: { lt: parseDateOnly(today) } } }),
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
    upcoming: upcoming.map((m) => ({
      projectId: m.project.id,
      projectTitle: m.project.title,
      milestone: m.title,
      dueOn: formatDateOnly(m.dueOn!),
      overdue: formatDateOnly(m.dueOn!) < today,
    })),
  };
}
