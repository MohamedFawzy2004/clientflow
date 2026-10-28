// Tasks, dependencies and time entries (FR-P05 – FR-P09, US-11).
import {
  ASSIGNEE_STATUSES,
  changeReference,
  TASK_SCOPE_LABELS,
  type TaskScope,
  TASK_STATUS_LABELS,
  type ProjectTime,
  type TaskBoard,
  type TaskDetail,
  type TaskLink,
  type TaskStatus,
  type TaskView,
  type TimeEntryView,
  type taskCreateSchema,
  type taskListQuerySchema,
  type taskUpdateSchema,
  type timeEntryCreateSchema,
  type timeEntryUpdateSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { agencyToday, formatDateOnly, parseDateOnly } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { notify } from '../../lib/notify.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import {
  assertNotArchived,
  canManage,
  canWork,
  findManageable,
  findWorkable,
  lockProject,
  projectReadScope,
  type Tx,
} from '../projects/access.js';

const CLOSED: TaskStatus[] = ['DONE', 'CANCELED'];
const MAX_DEPENDENCIES = 50;

// ---------------------------------------------------------------------------
// Loading and serialization
// ---------------------------------------------------------------------------

const taskInclude = {
  assignee: { select: { id: true, name: true } },
  milestone: { select: { id: true, title: true } },
  blockedBy: { include: { dependsOn: { select: { id: true, title: true, status: true } } } },
  changeRequest: { select: { id: true, number: true } },
} as const satisfies Prisma.TaskInclude;
type TaskRow = Prisma.TaskGetPayload<{ include: typeof taskInclude }>;

interface ViewContext {
  actor: AuthUser;
  manage: boolean;
  archived: boolean;
  today: string;
  logged: Map<string, number>;
}

function link(t: { id: string; title: string; status: TaskStatus }): TaskLink {
  return { id: t.id, title: t.title, status: t.status };
}

function toView(t: TaskRow, ctx: ViewContext): TaskView {
  const dueOn = t.dueOn ? formatDateOnly(t.dueOn) : null;
  const mine = t.assigneeId === ctx.actor.id;
  return {
    id: t.id,
    projectId: t.projectId,
    title: t.title,
    description: t.description,
    status: t.status,
    priority: t.priority,
    assignee: t.assignee,
    milestone: t.milestone,
    dueOn,
    overdue: dueOn !== null && dueOn < ctx.today && !CLOSED.includes(t.status),
    estimateMinutes: t.estimateMinutes,
    loggedMinutes: ctx.logged.get(t.id) ?? 0,
    scope: t.scope,
    change: t.changeRequest
      ? { id: t.changeRequest.id, reference: changeReference(t.changeRequest.number) }
      : null,
    scopeNote: t.scopeNote,
    openBlockers: t.blockedBy
      .map((d) => d.dependsOn)
      .filter((d) => !CLOSED.includes(d.status))
      .map(link),
    completedAt: t.completedAt?.toISOString() ?? null,
    updatedAt: t.updatedAt.toISOString(),
    version: t.version,
    access: {
      edit: ctx.manage && !ctx.archived,
      status: (ctx.manage || mine) && !ctx.archived,
      logTime: !ctx.archived,
    },
  };
}

async function loggedMinutes(db: Db | Tx, where: Prisma.TimeEntryWhereInput) {
  const rows = await db.timeEntry.groupBy({ by: ['taskId'], where, _sum: { minutes: true } });
  return new Map(rows.map((r) => [r.taskId, r._sum.minutes ?? 0]));
}

/** A task whose project the actor works on: role first (403), then scope (404). */
async function findTask(db: Db | Tx, actor: AuthUser, taskId: string) {
  if (!canWork(actor)) throw forbidden('Delivery work is for the project team.');
  if (!UUID_PATTERN.test(taskId)) throw notFound();
  const t = await db.task.findFirst({
    where: { id: taskId, agencyId: actor.agencyId, project: projectReadScope(actor) },
    include: { project: true },
  });
  if (!t) throw notFound();
  return t;
}

/** People a task can be assigned to: the project manager and the project's members. */
async function teamOf(db: Db | Tx, project: { id: string; managerId: string }) {
  const rows = await db.project.findUniqueOrThrow({
    where: { id: project.id },
    select: {
      manager: { select: { id: true, name: true, active: true } },
      members: { select: { user: { select: { id: true, name: true, active: true } } } },
    },
  });
  return [rows.manager, ...rows.members.map((m) => m.user)].filter((u) => u.active);
}

async function assertAssignable(
  db: Db | Tx,
  project: { id: string; managerId: string },
  id: string,
) {
  const team = await teamOf(db, project);
  if (!team.some((u) => u.id === id)) {
    throw validationFailed({
      assigneeId: ['Assign the task to the project manager or a project member.'],
    });
  }
}

/**
 * FR-S05: extra work names an accepted change of this project, or a written exception (which
 * is audited). Original-scope tasks carry neither. The DB enforces the same rules.
 */
async function scopeFields(
  tx: Db | Tx,
  projectId: string,
  input: { scope?: TaskScope; changeRequestId?: string | null; scopeNote?: string | null },
) {
  if (input.scope === 'CHANGE') {
    const c = await tx.changeRequest.findFirst({
      where: { id: input.changeRequestId ?? undefined, projectId, status: 'ACCEPTED' },
      select: { id: true },
    });
    if (!c) {
      throw validationFailed({
        changeRequestId: ['Choose a change request of this project that the client accepted.'],
      });
    }
    return { scope: 'CHANGE' as const, changeRequestId: c.id, scopeNote: null };
  }
  if (input.scope === 'EXCEPTION') {
    return {
      scope: 'EXCEPTION' as const,
      changeRequestId: null,
      scopeNote: input.scopeNote ?? null,
    };
  }
  return { scope: 'BASELINE' as const, changeRequestId: null, scopeNote: null };
}

async function assertMilestone(db: Db | Tx, projectId: string, milestoneId: string) {
  const m = await db.projectMilestone.findFirst({
    where: { id: milestoneId, projectId },
    select: { id: true },
  });
  if (!m) throw validationFailed({ milestoneId: ['Choose a milestone of this project.'] });
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTasks(
  db: Db,
  actor: AuthUser,
  projectId: string,
  query: z.output<typeof taskListQuerySchema>,
  timeZone: string,
): Promise<TaskBoard> {
  const p = await findWorkable(db, actor, projectId);
  const rows = await db.task.findMany({
    where: {
      projectId: p.id,
      ...(query.assignee === 'me' ? { assigneeId: actor.id } : {}),
      ...(query.status ? { status: query.status } : {}),
    },
    include: taskInclude,
    orderBy: [
      { priority: 'desc' },
      { dueOn: { sort: 'asc', nulls: 'last' } },
      { createdAt: 'asc' },
    ],
    take: 500,
  });
  const manage = canManage(actor, p);
  const ctx: ViewContext = {
    actor,
    manage,
    archived: p.state === 'ARCHIVED',
    today: agencyToday(new Date(), timeZone),
    logged: await loggedMinutes(db, { projectId: p.id }),
  };
  const team = await teamOf(db, p);
  return {
    tasks: rows.map((t) => toView(t, ctx)),
    assignees: team.map((u) => ({ id: u.id, name: u.name })),
    access: { create: manage && p.state !== 'ARCHIVED' },
  };
}

/** Everyone on the project sees their own time; the manager, Owner and Admin see all of it. */
function timeScope(actor: AuthUser, project: { managerId: string }): Prisma.TimeEntryWhereInput {
  return canManage(actor, project) ? {} : { userId: actor.id };
}

const entryInclude = {
  user: { select: { id: true, name: true } },
  task: { select: { id: true, title: true } },
} as const satisfies Prisma.TimeEntryInclude;

function toEntry(
  e: Prisma.TimeEntryGetPayload<{ include: typeof entryInclude }>,
  actor: AuthUser,
): TimeEntryView {
  return {
    id: e.id,
    task: e.task,
    user: e.user,
    workedOn: formatDateOnly(e.workedOn),
    minutes: e.minutes,
    billable: e.billable,
    note: e.note,
    version: e.version,
    mine: e.userId === actor.id,
  };
}

export async function getTask(
  db: Db,
  actor: AuthUser,
  taskId: string,
  timeZone: string,
): Promise<TaskDetail> {
  const base = await findTask(db, actor, taskId);
  const t = await db.task.findUniqueOrThrow({
    where: { id: base.id },
    include: {
      ...taskInclude,
      project: { select: { id: true, title: true } },
      createdBy: { select: { id: true, name: true } },
      blocking: { include: { task: { select: { id: true, title: true, status: true } } } },
    },
  });
  const entries = await db.timeEntry.findMany({
    where: { taskId: t.id, ...timeScope(actor, base.project) },
    include: entryInclude,
    orderBy: [{ workedOn: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });
  const ctx: ViewContext = {
    actor,
    manage: canManage(actor, base.project),
    archived: base.project.state === 'ARCHIVED',
    today: agencyToday(new Date(), timeZone),
    logged: await loggedMinutes(db, { taskId: t.id }),
  };
  return {
    ...toView(t, ctx),
    project: t.project,
    blockedBy: t.blockedBy.map((d) => link(d.dependsOn)),
    blocking: t.blocking.map((d) => link(d.task)),
    timeEntries: entries.map((e) => toEntry(e, actor)),
    createdBy: t.createdBy,
    createdAt: t.createdAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createTask(
  db: Db,
  actor: AuthUser,
  projectId: string,
  input: z.output<typeof taskCreateSchema>,
  requestId: string,
  timeZone: string,
) {
  const id = await db.$transaction(async (tx) => {
    const p = await findManageable(tx, actor, projectId);
    if (input.assigneeId) await assertAssignable(tx, p, input.assigneeId);
    if (input.milestoneId) await assertMilestone(tx, p.id, input.milestoneId);
    const scope = await scopeFields(tx, p.id, input);
    const t = await tx.task.create({
      data: {
        ...scope,
        agencyId: actor.agencyId,
        projectId: p.id,
        title: input.title,
        description: input.description,
        assigneeId: input.assigneeId ?? null,
        milestoneId: input.milestoneId ?? null,
        dueOn: input.dueOn ? parseDateOnly(input.dueOn) : null,
        priority: input.priority,
        estimateMinutes: input.estimateMinutes ?? null,
        createdById: actor.id,
      },
    });
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: p.id,
      eventType: 'task.created',
      summary: `Task “${t.title}” added by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'task.create',
      outcome: 'SUCCESS',
      targetType: 'task',
      targetId: t.id,
      requestId,
      metadata: { scope: scope.scope },
    });
    await notifyAssignee(tx, actor, t, p.title);
    return t.id;
  });
  return getTask(db, actor, id, timeZone);
}

/** The new assignee hears about it, unless they assigned it to themselves (FR-P10). */
async function notifyAssignee(
  tx: Tx,
  actor: AuthUser,
  t: { id: string; projectId: string; title: string; assigneeId: string | null },
  projectTitle: string,
) {
  await notify(tx, {
    agencyId: actor.agencyId,
    recipientIds: [t.assigneeId],
    actorId: actor.id,
    category: 'TASKS',
    type: 'task.assigned',
    title: `${actor.name} assigned you “${t.title}” in ${projectTitle}`,
    link: `/app/projects/${t.projectId}/board`,
    entity: { type: 'task', id: t.id },
  });
}

/** Project manager, Owner or Admin only: every field except status (FR-P09). */
export async function updateTask(
  db: Db,
  actor: AuthUser,
  taskId: string,
  input: z.output<typeof taskUpdateSchema>,
  timeZone: string,
) {
  await db.$transaction(async (tx) => {
    const t = await findTask(tx, actor, taskId);
    if (!canManage(actor, t.project)) {
      throw forbidden('Only the project manager or an admin can edit tasks.');
    }
    assertNotArchived(t.project);
    if (t.version !== input.version) throw staleVersion();
    if (input.assigneeId) await assertAssignable(tx, t.project, input.assigneeId);
    if (input.milestoneId) await assertMilestone(tx, t.projectId, input.milestoneId);
    const scope = input.scope !== undefined ? await scopeFields(tx, t.projectId, input) : null;
    const res = await tx.task.updateMany({
      where: { id: t.id, version: input.version },
      data: {
        ...(scope ?? {}),
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        ...(input.milestoneId !== undefined ? { milestoneId: input.milestoneId } : {}),
        ...(input.dueOn !== undefined
          ? { dueOn: input.dueOn ? parseDateOnly(input.dueOn) : null }
          : {}),
        ...(input.priority !== undefined ? { priority: input.priority } : {}),
        ...(input.estimateMinutes !== undefined ? { estimateMinutes: input.estimateMinutes } : {}),
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw staleVersion();
    if (scope && scope.scope !== t.scope) {
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: t.projectId,
        eventType: 'task.scope',
        summary: `${actor.name} marked “${input.title ?? t.title}” as ${TASK_SCOPE_LABELS[scope.scope].toLowerCase()}`,
        body: scope.scopeNote,
      });
    }
    if (input.assigneeId !== undefined && input.assigneeId !== t.assigneeId) {
      const who = input.assigneeId
        ? (await tx.user.findUniqueOrThrow({ where: { id: input.assigneeId } })).name
        : 'nobody';
      await recordActivity(tx, actor, {
        entityType: 'project',
        entityId: t.projectId,
        eventType: 'task.assigned',
        summary: `${actor.name} assigned “${input.title ?? t.title}” to ${who}`,
      });
      await notifyAssignee(
        tx,
        actor,
        {
          id: t.id,
          projectId: t.projectId,
          title: input.title ?? t.title,
          assigneeId: input.assigneeId,
        },
        t.project.title,
      );
    }
  });
  return getTask(db, actor, taskId, timeZone);
}

/**
 * Status change (FR-P07, US-11). The assignee may move their own task between the board
 * columns; canceling and reopening a canceled task is the project manager's call. DONE needs
 * every blocker done or canceled (spec §9).
 */
export async function changeTaskStatus(
  db: Db,
  actor: AuthUser,
  taskId: string,
  version: number,
  status: TaskStatus,
  requestId: string,
  timeZone: string,
) {
  await db.$transaction(async (tx) => {
    const t = await findTask(tx, actor, taskId);
    const manage = canManage(actor, t.project);
    if (!manage && t.assigneeId !== actor.id) {
      throw forbidden('Only the assignee or the project manager can change this task.');
    }
    assertNotArchived(t.project);
    if (t.version !== version) throw staleVersion();
    if (t.status === status) return;
    if (!manage && (!ASSIGNEE_STATUSES.includes(status) || t.status === 'CANCELED')) {
      throw forbidden('Only the project manager can cancel or reopen a canceled task.');
    }
    if (status === 'DONE') {
      const open = await tx.taskDependency.findMany({
        where: { taskId: t.id, dependsOn: { status: { notIn: CLOSED } } },
        include: { dependsOn: { select: { title: true } } },
      });
      if (open.length > 0) {
        throw conflict(
          `Finish ${open.map((d) => `“${d.dependsOn.title}”`).join(', ')} first: this task waits for ${open.length === 1 ? 'it' : 'them'}.`,
        );
      }
    }
    const res = await tx.task.updateMany({
      where: { id: t.id, version },
      data: {
        status,
        completedAt: status === 'DONE' ? new Date() : null,
        version: { increment: 1 },
      },
    });
    if (res.count === 0) throw staleVersion();
    // FR-P10: completion is part of the project history (notifications arrive in M10).
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: t.projectId,
      eventType: status === 'DONE' ? 'task.completed' : 'task.status',
      summary:
        status === 'DONE'
          ? `${actor.name} completed “${t.title}”`
          : `${actor.name} moved “${t.title}” to ${TASK_STATUS_LABELS[status]}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'task.status',
      outcome: 'SUCCESS',
      targetType: 'task',
      targetId: t.id,
      requestId,
      metadata: { from: t.status, to: status },
    });
  });
  return getTask(db, actor, taskId, timeZone);
}

/** `taskId` waits for `dependsOnId`. Same project, no self-links, no cycles (FR-P06). */
export async function addDependency(
  db: Db,
  actor: AuthUser,
  taskId: string,
  dependsOnId: string,
  timeZone: string,
) {
  await db.$transaction(async (tx) => {
    const t = await findTask(tx, actor, taskId);
    if (!canManage(actor, t.project)) {
      throw forbidden('Only the project manager or an admin can change dependencies.');
    }
    assertNotArchived(t.project);
    if (dependsOnId === t.id) {
      throw validationFailed({ dependsOnId: ['A task cannot wait for itself.'] });
    }
    // One writer at a time per project, so two concurrent links cannot close a cycle together.
    await lockProject(tx, t.projectId);
    const other = await tx.task.findFirst({
      where: { id: dependsOnId, projectId: t.projectId },
      select: { id: true, title: true },
    });
    if (!other) throw validationFailed({ dependsOnId: ['Choose a task of this project.'] });
    const cycle = await tx.$queryRaw<Array<{ found: number }>>`
      WITH RECURSIVE chain(id) AS (
        SELECT depends_on_id FROM task_dependencies WHERE task_id = CAST(${other.id} AS uuid)
        UNION
        SELECT d.depends_on_id FROM task_dependencies d JOIN chain c ON d.task_id = c.id
      )
      SELECT 1 AS found FROM chain WHERE id = CAST(${t.id} AS uuid) LIMIT 1`;
    if (cycle.length > 0) {
      throw conflict(
        `“${other.title}” already waits for this task, directly or through other tasks. That would be a loop.`,
      );
    }
    const count = await tx.taskDependency.count({ where: { taskId: t.id } });
    if (count >= MAX_DEPENDENCIES) {
      throw conflict(`A task can wait for at most ${MAX_DEPENDENCIES} other tasks.`);
    }
    const created = await tx.taskDependency.createMany({
      data: [{ projectId: t.projectId, taskId: t.id, dependsOnId: other.id }],
      skipDuplicates: true,
    });
    if (created.count === 0) return; // already linked: idempotent
    await recordActivity(tx, actor, {
      entityType: 'project',
      entityId: t.projectId,
      eventType: 'task.dependency_added',
      summary: `${actor.name}: “${t.title}” now waits for “${other.title}”`,
    });
  });
  return getTask(db, actor, taskId, timeZone);
}

export async function removeDependency(
  db: Db,
  actor: AuthUser,
  taskId: string,
  dependsOnId: string,
  timeZone: string,
) {
  if (!UUID_PATTERN.test(dependsOnId)) throw notFound();
  await db.$transaction(async (tx) => {
    const t = await findTask(tx, actor, taskId);
    if (!canManage(actor, t.project)) {
      throw forbidden('Only the project manager or an admin can change dependencies.');
    }
    assertNotArchived(t.project);
    await tx.taskDependency.deleteMany({ where: { taskId: t.id, dependsOnId } });
  });
  return getTask(db, actor, taskId, timeZone);
}

// ---------------------------------------------------------------------------
// Time entries (FR-P08)
// ---------------------------------------------------------------------------

function assertNotFuture(workedOn: string, timeZone: string) {
  if (workedOn > agencyToday(new Date(), timeZone)) {
    throw validationFailed({ workedOn: ['Time can only be logged for today or earlier.'] });
  }
}

export async function listTaskTime(db: Db, actor: AuthUser, taskId: string) {
  const t = await findTask(db, actor, taskId);
  const rows = await db.timeEntry.findMany({
    where: { taskId: t.id, ...timeScope(actor, t.project) },
    include: entryInclude,
    orderBy: [{ workedOn: 'desc' }, { createdAt: 'desc' }],
    take: 200,
  });
  return rows.map((e) => toEntry(e, actor));
}

/** People log their own time on any task of a project they work on. */
export async function logTime(
  db: Db,
  actor: AuthUser,
  taskId: string,
  input: z.output<typeof timeEntryCreateSchema>,
  requestId: string,
  timeZone: string,
): Promise<TimeEntryView> {
  const t = await findTask(db, actor, taskId);
  assertNotArchived(t.project);
  assertNotFuture(input.workedOn, timeZone);
  const e = await db.$transaction(async (tx) => {
    const created = await tx.timeEntry.create({
      data: {
        agencyId: actor.agencyId,
        projectId: t.projectId,
        taskId: t.id,
        userId: actor.id,
        workedOn: parseDateOnly(input.workedOn),
        minutes: input.minutes,
        billable: input.billable,
        note: input.note,
      },
      include: entryInclude,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'time.log',
      outcome: 'SUCCESS',
      targetType: 'time_entry',
      targetId: created.id,
      requestId,
      metadata: { taskId: t.id, minutes: input.minutes },
    });
    return created;
  });
  return toEntry(e, actor);
}

/** Only the author changes an entry. Someone else's visible entry is 403, an invisible one 404. */
async function findOwnEntry(db: Db | Tx, actor: AuthUser, entryId: string) {
  if (!canWork(actor)) throw forbidden('Delivery work is for the project team.');
  if (!UUID_PATTERN.test(entryId)) throw notFound();
  const e = await db.timeEntry.findFirst({
    where: { id: entryId, agencyId: actor.agencyId, project: projectReadScope(actor) },
    include: { project: true },
  });
  if (!e) throw notFound();
  if (e.userId !== actor.id) {
    if (canManage(actor, e.project))
      throw forbidden('Only the person who logged it can change it.');
    throw notFound();
  }
  assertNotArchived(e.project);
  return e;
}

export async function updateTimeEntry(
  db: Db,
  actor: AuthUser,
  entryId: string,
  input: z.output<typeof timeEntryUpdateSchema>,
  timeZone: string,
): Promise<TimeEntryView> {
  const e = await findOwnEntry(db, actor, entryId);
  if (input.workedOn) assertNotFuture(input.workedOn, timeZone);
  const res = await db.timeEntry.updateMany({
    where: { id: e.id, version: input.version },
    data: {
      ...(input.workedOn !== undefined ? { workedOn: parseDateOnly(input.workedOn) } : {}),
      ...(input.minutes !== undefined ? { minutes: input.minutes } : {}),
      ...(input.billable !== undefined ? { billable: input.billable } : {}),
      ...(input.note !== undefined ? { note: input.note } : {}),
      version: { increment: 1 },
    },
  });
  if (res.count === 0) throw staleVersion();
  const fresh = await db.timeEntry.findUniqueOrThrow({
    where: { id: e.id },
    include: entryInclude,
  });
  return toEntry(fresh, actor);
}

export async function deleteTimeEntry(db: Db, actor: AuthUser, entryId: string, requestId: string) {
  const e = await findOwnEntry(db, actor, entryId);
  await db.$transaction(async (tx) => {
    await tx.timeEntry.delete({ where: { id: e.id } });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'time.delete',
      outcome: 'SUCCESS',
      targetType: 'time_entry',
      targetId: e.id,
      requestId,
      metadata: { taskId: e.taskId, minutes: e.minutes },
    });
  });
  return { deleted: true };
}

export async function getProjectTime(
  db: Db,
  actor: AuthUser,
  projectId: string,
): Promise<ProjectTime> {
  const p = await findWorkable(db, actor, projectId);
  const scope = timeScope(actor, p);
  const where = { projectId: p.id, ...scope };
  const [byUser, billable, entries] = await Promise.all([
    db.timeEntry.groupBy({ by: ['userId'], where, _sum: { minutes: true } }),
    db.timeEntry.groupBy({
      by: ['userId'],
      where: { ...where, billable: true },
      _sum: { minutes: true },
    }),
    db.timeEntry.findMany({
      where,
      include: entryInclude,
      orderBy: [{ workedOn: 'desc' }, { createdAt: 'desc' }],
      take: 200,
    }),
  ]);
  const names = await db.user.findMany({
    where: { id: { in: byUser.map((r) => r.userId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(names.map((u) => [u.id, u.name]));
  const billableOf = new Map(billable.map((r) => [r.userId, r._sum.minutes ?? 0]));
  const byPerson = byUser
    .map((r) => ({
      user: { id: r.userId, name: nameOf.get(r.userId) ?? 'Former user' },
      minutes: r._sum.minutes ?? 0,
      billableMinutes: billableOf.get(r.userId) ?? 0,
    }))
    .sort((a, b) => b.minutes - a.minutes);
  const scoped = await db.$queryRaw<Array<{ scope: TaskScope; minutes: bigint }>>`
    SELECT t.scope AS scope, COALESCE(SUM(e.minutes), 0)::bigint AS minutes
    FROM time_entries e JOIN tasks t ON t.id = e.task_id
    WHERE e.project_id = CAST(${p.id} AS uuid)
      AND (${scope.userId ?? null}::uuid IS NULL OR e.user_id = ${scope.userId ?? null}::uuid)
    GROUP BY t.scope`;
  const byScope: Record<TaskScope, number> = { BASELINE: 0, CHANGE: 0, EXCEPTION: 0 };
  for (const r of scoped) byScope[r.scope] = Number(r.minutes);
  return {
    byScope,
    scope: canManage(actor, p) ? 'all' : 'own',
    totals: {
      minutes: byPerson.reduce((s, r) => s + r.minutes, 0),
      billableMinutes: byPerson.reduce((s, r) => s + r.billableMinutes, 0),
    },
    byPerson,
    entries: entries.map((e) => toEntry(e, actor)),
  };
}
