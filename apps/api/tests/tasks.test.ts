// M7: tasks, dependencies, board permissions and time entries (FR-P05 – FR-P10, US-11).
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';
import { makeProject } from './proposal-fixtures.js';

const db = testDb();
afterAll(() => db.$disconnect());

type Agent = Awaited<ReturnType<typeof login>>;
let seeded: SeededAgency;
let app: ReturnType<typeof makeApp>['app'];
let pm: Agent;
let member: Agent;
let projectId: string;
let milestoneId: string;

const send = (a: Agent, method: 'post' | 'patch', path: string, body: object = {}) =>
  a.agent[method](`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf).send(body);
const get = (a: Agent, path: string) => a.agent.get(`/api/v1${path}`);

async function task(body: object = {}) {
  const res = await send(pm, 'post', `/projects/${projectId}/tasks`, {
    title: 'Build homepage',
    assigneeId: seeded.users.member!.id,
    ...body,
  });
  expect(res.status).toBe(201);
  return res.body.data as { id: string; version: number; status: string };
}

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  ({ app } = makeApp());
  const p = await makeProject(db, {
    agencyId: seeded.agencyId,
    managerId: seeded.users.pm!.id,
    createdById: seeded.users.pm!.id,
    memberIds: [seeded.users.member!.id],
  });
  projectId = p.projectId;
  milestoneId = p.milestoneId;
  pm = await login(app, seeded.users.pm!.email);
  member = await login(app, seeded.users.member!.email);
});

describe('tasks (FR-P05, FR-P09, US-11)', () => {
  it('the manager creates and assigns; the assignee moves only the status of their own task', async () => {
    const t = await task({
      milestoneId,
      dueOn: '2026-12-01',
      priority: 'HIGH',
      estimateMinutes: 90,
      description: '<script>alert(1)</script> stays text',
    });
    const board = await get(member, `/projects/${projectId}/tasks`).expect(200);
    expect(board.body.data.tasks).toHaveLength(1);
    expect(board.body.data.tasks[0]).toMatchObject({
      title: 'Build homepage',
      priority: 'HIGH',
      estimateMinutes: 90,
      milestone: { id: milestoneId },
      assignee: { id: seeded.users.member!.id },
      access: { edit: false, status: true, logTime: true },
    });
    expect(board.body.data.access.create).toBe(false);

    const moved = await send(member, 'post', `/tasks/${t.id}/status`, {
      version: t.version,
      status: 'IN_PROGRESS',
    }).expect(200);
    expect(moved.body.data.status).toBe('IN_PROGRESS');

    // Not their call: edit fields, cancel, create tasks.
    await send(member, 'patch', `/tasks/${t.id}`, { version: 2, title: 'Renamed' }).expect(403);
    await send(member, 'post', `/tasks/${t.id}/status`, { version: 2, status: 'CANCELED' }).expect(
      403,
    );
    await send(member, 'post', `/projects/${projectId}/tasks`, { title: 'Mine' }).expect(403);

    // Someone else's task on the same project: visible, but not theirs to move.
    const other = await task({ assigneeId: null, title: 'Unassigned' });
    await send(member, 'post', `/tasks/${other.id}/status`, {
      version: other.version,
      status: 'DONE',
    }).expect(403);
    const unchanged = await db.task.findUniqueOrThrow({ where: { id: other.id } });
    expect(unchanged.status).toBe('TODO');
  });

  it('assignees must be on the project team and milestones must belong to the project', async () => {
    const other = await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: seeded.users.pm!.id,
      createdById: seeded.users.pm!.id,
    });
    const bad1 = await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'X',
      assigneeId: seeded.users.salesA!.id,
    }).expect(422);
    expect(bad1.body.error.fieldErrors.assigneeId).toBeDefined();
    const bad2 = await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'X',
      milestoneId: other.milestoneId,
    }).expect(422);
    expect(bad2.body.error.fieldErrors.milestoneId).toBeDefined();
    // Mass assignment of server-owned fields is refused (T-ACL-03).
    await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'X',
      projectId: other.projectId,
    }).expect(422);
    expect(await db.task.count()).toBe(0);
  });

  it('completion records history; stale versions get 409 and change nothing', async () => {
    const t = await task();
    await send(member, 'post', `/tasks/${t.id}/status`, {
      version: t.version,
      status: 'DONE',
    }).expect(200);
    const row = await db.task.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.completedAt).not.toBeNull();
    const events = await db.activity.findMany({ where: { entityId: projectId } });
    expect(events.map((e) => e.eventType)).toEqual(
      expect.arrayContaining(['task.created', 'task.completed']),
    );
    const stale = await send(pm, 'patch', `/tasks/${t.id}`, { version: t.version, title: 'Late' });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('CONFLICT_STALE_VERSION');
    // Reopening clears the completion time (DB check keeps them consistent).
    await send(pm, 'post', `/tasks/${t.id}/status`, {
      version: row.version,
      status: 'TODO',
    }).expect(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: t.id } })).completedAt).toBeNull();
  });

  it('scope: other PMs get 404, sales get 403, archived projects are read-only', async () => {
    const t = await task();
    const pm2 = await db.user.create({
      data: {
        agencyId: seeded.agencyId,
        emailNorm: 'pm2@agency.test',
        name: 'Other PM',
        role: 'PM',
        passwordHash: (await db.user.findUniqueOrThrow({ where: { id: seeded.users.pm!.id } }))
          .passwordHash,
      },
    });
    const other = await login(app, 'pm2@agency.test');
    await get(other, `/tasks/${t.id}`).expect(404);
    await get(other, `/projects/${projectId}/tasks`).expect(404);
    await send(other, 'post', `/tasks/${t.id}/status`, { version: 1, status: 'DONE' }).expect(404);
    const sales = await login(app, seeded.users.salesA!.email);
    await get(sales, `/tasks/${t.id}`).expect(403);
    expect(pm2.id).toBeTruthy();

    await db.project.update({ where: { id: projectId }, data: { state: 'ARCHIVED' } });
    await send(pm, 'post', `/projects/${projectId}/tasks`, { title: 'Late' }).expect(409);
    await send(member, 'post', `/tasks/${t.id}/status`, { version: 1, status: 'DONE' }).expect(409);
    const board = await get(member, `/projects/${projectId}/tasks`).expect(200);
    expect(board.body.data.tasks[0].access).toEqual({ edit: false, status: false, logTime: false });
  });

  it('removing a member hands their open tasks back to the manager', async () => {
    const open = await task();
    const done = await task({ title: 'Finished' });
    await send(member, 'post', `/tasks/${done.id}/status`, { version: 1, status: 'DONE' }).expect(
      200,
    );
    await send(
      pm,
      'post',
      `/projects/${projectId}/members/${seeded.users.member!.id}/remove`,
    ).expect(200);
    expect((await db.task.findUniqueOrThrow({ where: { id: open.id } })).assigneeId).toBeNull();
    expect((await db.task.findUniqueOrThrow({ where: { id: done.id } })).assigneeId).toBe(
      seeded.users.member!.id,
    );
    await get(member, `/tasks/${open.id}`).expect(404);
  });
});

describe('dependencies (FR-P06)', () => {
  it('a task cannot be done while it waits; self-links, loops and other projects are refused', async () => {
    const a = await task({ title: 'A' });
    const b = await task({ title: 'B' });
    const c = await task({ title: 'C' });
    await send(pm, 'post', `/tasks/${a.id}/dependencies`, { dependsOnId: b.id }).expect(200);
    await send(pm, 'post', `/tasks/${b.id}/dependencies`, { dependsOnId: c.id }).expect(200);
    // Repeat is idempotent.
    await send(pm, 'post', `/tasks/${a.id}/dependencies`, { dependsOnId: b.id }).expect(200);
    expect(await db.taskDependency.count()).toBe(2);

    const blocked = await send(member, 'post', `/tasks/${a.id}/status`, {
      version: a.version,
      status: 'DONE',
    }).expect(409);
    expect(blocked.body.error.message).toContain('“B”');

    // C → A would close the loop A → B → C → A.
    const loop = await send(pm, 'post', `/tasks/${c.id}/dependencies`, { dependsOnId: a.id });
    expect(loop.status).toBe(409);
    expect(loop.body.error.message).toMatch(/loop/);
    await send(pm, 'post', `/tasks/${a.id}/dependencies`, { dependsOnId: a.id }).expect(422);

    const elsewhere = await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: seeded.users.pm!.id,
      createdById: seeded.users.pm!.id,
    });
    const foreign = await db.task.create({
      data: {
        agencyId: seeded.agencyId,
        projectId: elsewhere.projectId,
        title: 'Foreign',
        createdById: seeded.users.pm!.id,
      },
    });
    await send(pm, 'post', `/tasks/${a.id}/dependencies`, { dependsOnId: foreign.id }).expect(422);
    // The database refuses a cross-project link even if the service were bypassed.
    await expect(
      db.taskDependency.create({
        data: { projectId, taskId: a.id, dependsOnId: foreign.id },
      }),
    ).rejects.toThrow();
    await expect(
      db.taskDependency.create({ data: { projectId, taskId: a.id, dependsOnId: a.id } }),
    ).rejects.toThrow();

    // Members cannot change the graph.
    await send(member, 'post', `/tasks/${c.id}/dependencies`, { dependsOnId: a.id }).expect(403);

    // Finish C, then B, then A.
    for (const t of [c, b]) {
      await send(member, 'post', `/tasks/${t.id}/status`, { version: 1, status: 'DONE' }).expect(
        200,
      );
    }
    const detail = await get(member, `/tasks/${a.id}`).expect(200);
    expect(detail.body.data.openBlockers).toEqual([]);
    expect(detail.body.data.blockedBy.map((x: { title: string }) => x.title)).toEqual(['B']);
    await send(member, 'post', `/tasks/${a.id}/status`, { version: 1, status: 'DONE' }).expect(200);
  });

  it('two opposite links sent at the same time cannot both land (project row lock)', async () => {
    const a = await task({ title: 'A' });
    const b = await task({ title: 'B' });
    const results = await Promise.all([
      send(pm, 'post', `/tasks/${a.id}/dependencies`, { dependsOnId: b.id }),
      send(pm, 'post', `/tasks/${b.id}/dependencies`, { dependsOnId: a.id }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await db.taskDependency.count()).toBe(1);
  });
});

describe('time entries (FR-P08)', () => {
  it('people log their own time; members see their own entries, the manager sees everyone', async () => {
    const t = await task();
    const mine = await send(member, 'post', `/tasks/${t.id}/time`, {
      workedOn: '2026-10-20',
      minutes: 90,
      billable: true,
      note: 'Internal: hero section',
    }).expect(201);
    expect(mine.body.data).toMatchObject({
      minutes: 90,
      mine: true,
      user: { id: seeded.users.member!.id },
    });
    await send(pm, 'post', `/tasks/${t.id}/time`, {
      workedOn: '2026-10-21',
      minutes: 30,
      billable: false,
    }).expect(201);

    const own = await get(member, `/projects/${projectId}/time`).expect(200);
    expect(own.body.data.scope).toBe('own');
    expect(own.body.data.entries).toHaveLength(1);
    expect(own.body.data.totals).toEqual({ minutes: 90, billableMinutes: 90 });

    const all = await get(pm, `/projects/${projectId}/time`).expect(200);
    expect(all.body.data.scope).toBe('all');
    expect(all.body.data.totals).toEqual({ minutes: 120, billableMinutes: 90 });
    expect(all.body.data.byPerson).toHaveLength(2);

    const board = await get(member, `/projects/${projectId}/tasks`).expect(200);
    expect(board.body.data.tasks[0].loggedMinutes).toBe(120);

    // Validation: future dates, zero and more than a day.
    for (const body of [
      { workedOn: '2099-01-01', minutes: 10 },
      { workedOn: '2026-10-20', minutes: 0 },
      { workedOn: '2026-10-20', minutes: 1441 },
      { workedOn: '2026-10-20', minutes: 10, userId: seeded.users.pm!.id },
    ]) {
      await send(member, 'post', `/tasks/${t.id}/time`, body).expect(422);
    }
    expect(await db.timeEntry.count()).toBe(2);
  });

  it('only the author edits or deletes an entry', async () => {
    const t = await task();
    const e = (
      await send(member, 'post', `/tasks/${t.id}/time`, { workedOn: '2026-10-20', minutes: 60 })
    ).body.data as { id: string; version: number };
    await send(member, 'patch', `/time-entries/${e.id}`, { version: 1, minutes: 75 }).expect(200);
    // The manager can see it but not rewrite someone else's time.
    await send(pm, 'patch', `/time-entries/${e.id}`, { version: 2, minutes: 5 }).expect(403);
    await send(pm, 'post', `/time-entries/${e.id}/delete`).expect(403);
    const stale = await send(member, 'patch', `/time-entries/${e.id}`, { version: 1, minutes: 80 });
    expect(stale.status).toBe(409);
    expect((await db.timeEntry.findUniqueOrThrow({ where: { id: e.id } })).minutes).toBe(75);
    await send(member, 'post', `/time-entries/${e.id}/delete`).expect(200);
    expect(await db.timeEntry.count()).toBe(0);
    expect(await db.auditEvent.count({ where: { action: 'time.delete' } })).toBe(1);
  });
});

describe('milestone order (O24) and the delivery dashboard', () => {
  it('moves milestones up and down and keeps sequences unique', async () => {
    for (const title of ['Design', 'Build']) {
      await send(pm, 'post', `/projects/${projectId}/milestones`, { title }).expect(201);
    }
    const order = async () =>
      (
        await db.projectMilestone.findMany({ where: { projectId }, orderBy: { sequence: 'asc' } })
      ).map((m) => m.title);
    expect(await order()).toEqual(['Kick-off', 'Design', 'Build']);
    const build = await db.projectMilestone.findFirstOrThrow({ where: { title: 'Build' } });
    await send(pm, 'post', `/projects/${projectId}/milestones/${build.id}/move`, {
      direction: 'up',
    }).expect(200);
    expect(await order()).toEqual(['Kick-off', 'Build', 'Design']);
    await send(pm, 'post', `/projects/${projectId}/milestones/${milestoneId}/move`, {
      direction: 'up',
    }).expect(200); // already first: no change
    expect(await order()).toEqual(['Kick-off', 'Build', 'Design']);
    await send(member, 'post', `/projects/${projectId}/milestones/${build.id}/move`, {
      direction: 'down',
    }).expect(403);
  });

  it('shows the viewer their own open tasks', async () => {
    await task({ title: 'Mine', dueOn: '2020-01-01' });
    await task({ title: 'Not mine', assigneeId: null });
    const res = await get(member, '/dashboard/delivery').expect(200);
    expect(res.body.data.myTasks).toEqual([
      expect.objectContaining({ title: 'Mine', overdue: true, projectId }),
    ]);
    expect(res.body.data.deliverables).toEqual({ awaitingClient: 0, overdue: 0 });
  });
});
