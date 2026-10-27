// M10: notifications (FR-X09, FR-P10), the job outbox and worker (FR-A02, FR-A03, SEC-24) and
// scheduled reminders (FR-A01, FR-S09).
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { backoffMs, claimJobs, CLAIM_SECONDS, describeError, enqueue } from '../src/jobs/outbox.js';
import { runReminderScan } from '../src/jobs/reminders.js';
import { runDueJobs, scheduleReminderScans } from '../src/jobs/worker.js';
import { DevSinkMailer } from '../src/lib/mailer.js';
import { notify } from '../src/lib/notify.js';
import { createLogger } from '../src/middleware/logger.js';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';
import { makeClientOrg, makeDeal, makeProject } from './proposal-fixtures.js';

const db = testDb();
afterAll(() => db.$disconnect());

type Agent = Awaited<ReturnType<typeof login>>;
let seeded: SeededAgency;
let t: ReturnType<typeof makeApp>;
let pm: Agent;
let owner: Agent;
let admin: Agent;
let member: Agent;
let finance: Agent;
let client: Agent;
let projectId: string;
let orgId: string;
let clientUserId: string;

const send = (
  a: Agent,
  method: 'post' | 'patch' | 'put',
  path: string,
  body: object = {},
  headers: Record<string, string> = {},
) => {
  let r = a.agent[method](`/api/v1${path}`).set('Origin', ORIGIN).set('X-CSRF-Token', a.csrf);
  for (const [k, v] of Object.entries(headers)) r = r.set(k, v);
  return r.send(body);
};
const get = (a: Agent, path: string) => a.agent.get(`/api/v1${path}`);
const inbox = async (a: Agent) =>
  (await get(a, '/notifications').expect(200)).body.data as {
    items: Array<{ id: string; type: string; title: string; link: string; readAt: string | null }>;
    unreadCount: number;
  };
const silent = createLogger('silent');

async function sentChange() {
  const c = await send(pm, 'post', `/projects/${projectId}/changes`, {
    title: 'Arabic version',
    description: 'Add an Arabic version of every page.',
  }).expect(201);
  const d = await send(pm, 'put', `/changes/${c.body.data.id}/draft`, {
    version: c.body.data.version,
    scope: 'Translate all pages.',
    estimateMinutes: 600,
    price: '5000.00',
  }).expect(200);
  const s = await send(pm, 'post', `/changes/${d.body.data.id}/submit`, {
    version: d.body.data.version,
  }).expect(200);
  const a = await send(owner, 'post', `/changes/${d.body.data.id}/review`, {
    version: s.body.data.version,
    decision: 'APPROVE',
  }).expect(200);
  const out = await send(pm, 'post', `/changes/${d.body.data.id}/send`, {
    version: a.body.data.version,
  }).expect(200);
  return out.body.data as { id: string; versions: Array<{ contentHash: string }> };
}

/** An issued, unpaid invoice due on `dueOn`, written directly (its rules are tested in M9). */
async function issuedInvoice(dueOn: string) {
  return db.invoice.create({
    data: {
      agencyId: seeded.agencyId,
      clientOrgId: orgId,
      number: (await db.invoice.count()) + 1,
      status: 'ISSUED',
      currency: 'EGP',
      dueOn: new Date(`${dueOn}T00:00:00Z`),
      issuedOn: new Date('2026-10-01T00:00:00Z'),
      issuedAt: new Date('2026-10-01T08:00:00Z'),
      issuedById: seeded.users.finance!.id,
      subtotalMinor: 100_000n,
      taxMinor: 14_000n,
      totalMinor: 114_000n,
      createdById: seeded.users.finance!.id,
    },
  });
}

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  t = makeApp();
  const contact = await db.contact.create({
    data: {
      agencyId: seeded.agencyId,
      ownerId: seeded.users.owner!.id,
      fullName: 'Client contact',
    },
  });
  const org = await makeClientOrg(db, seeded.agencyId, contact.id, { email: 'a@client.test' });
  orgId = org.orgId;
  clientUserId = org.clientUserId;
  projectId = (
    await makeProject(db, {
      agencyId: seeded.agencyId,
      managerId: seeded.users.pm!.id,
      createdById: seeded.users.pm!.id,
      memberIds: [seeded.users.member!.id],
      clientOrgId: orgId,
    })
  ).projectId;
  await db.project.update({
    where: { id: projectId },
    data: { state: 'ACTIVE', title: 'Harbour website' },
  });
  await db.projectShare.create({
    data: {
      agencyId: seeded.agencyId,
      projectId,
      userId: clientUserId,
      sharedById: seeded.users.pm!.id,
    },
  });
  pm = await login(t.app, seeded.users.pm!.email);
  owner = await login(t.app, seeded.users.owner!.email);
  admin = await login(t.app, seeded.users.admin!.email);
  member = await login(t.app, seeded.users.member!.email);
  finance = await login(t.app, seeded.users.finance!.email);
  client = await login(t.app, 'a@client.test');
});

describe('notifications from events (FR-X09, FR-P10)', () => {
  it('reach the right people, never the actor, and only once per event', async () => {
    const c = await send(pm, 'post', `/projects/${projectId}/changes`, {
      title: 'Arabic version',
      description: 'Add an Arabic version.',
    }).expect(201);
    const d = await send(pm, 'put', `/changes/${c.body.data.id}/draft`, {
      version: c.body.data.version,
      scope: 'Translate all pages.',
      estimateMinutes: 600,
      price: '5000.00',
    }).expect(200);
    await send(pm, 'post', `/changes/${d.body.data.id}/submit`, {
      version: d.body.data.version,
    }).expect(200);
    // Approvers (Owner and Admin) hear about it; the PM who submitted does not.
    for (const a of [owner, admin]) {
      const box = await inbox(a);
      expect(box.unreadCount).toBe(1);
      expect(box.items[0]).toMatchObject({
        type: 'change.submitted',
        link: `/app/projects/${projectId}/changes/${c.body.data.id}`,
      });
      expect(box.items[0]!.title).toContain('CR-1');
    }
    for (const a of [pm, member, finance]) expect((await inbox(a)).unreadCount).toBe(0);
    // In-app only by default for approvals: no email job.
    expect(await db.outboxJob.count({ where: { kind: 'email.notification' } })).toBe(0);
  });

  it('client decisions and comments notify the PM, with a link-only email (SEC-24)', async () => {
    const ch = await sentChange();
    await send(client, 'post', `/portal/changes/${ch.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: ch.versions[0]!.contentHash,
    }).expect(200);
    await send(client, 'post', '/portal/comments', {
      entityType: 'change',
      entityId: ch.id,
      body: 'Thanks, go ahead!',
    }).expect(201);
    const box = await inbox(pm);
    expect(box.items.map((n) => n.type).sort()).toEqual([
      // The owner's approval (in-app only) arrived first.
      'change.approved',
      'change.client_accepted',
      'comment.client',
    ]);
    // The client is never a recipient, and portal users have no notification center (403).
    expect(await db.notification.count({ where: { recipientId: clientUserId } })).toBe(0);
    await get(client, '/notifications').expect(403);

    const run = await t.drainJobs();
    expect(run.dead).toBe(0);
    const mails = t.mailer.messages.filter((m) => m.to === seeded.users.pm!.email);
    expect(mails.map((m) => m.kind).sort()).toEqual(['change_decision', 'client_comment']);
    for (const m of mails) {
      expect(m.text).toContain(`${ORIGIN}/app/projects/${projectId}/changes/${ch.id}`);
      // No titles, names, project names or comment text in the email.
      for (const secret of ['Harbour website', 'Thanks, go ahead', 'Arabic version', 'CR-1']) {
        expect(m.text).not.toContain(secret);
        expect(m.subject).not.toContain(secret);
      }
    }
    // Running the worker again sends nothing more.
    await t.drainJobs();
    expect(t.mailer.messages.filter((m) => m.to === seeded.users.pm!.email)).toHaveLength(2);
    const sent = await db.notification.findMany({ where: { recipientId: seeded.users.pm!.id } });
    expect(sent.map((n) => [n.category, n.emailedAt !== null]).sort()).toEqual([
      ['APPROVALS', false],
      ['CLIENT_ACTIVITY', true],
      ['CLIENT_ACTIVITY', true],
    ]);
  });

  it('task assignment notifies the assignee, not a PM assigning themselves', async () => {
    const a = await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Homepage copy',
      assigneeId: seeded.users.member!.id,
    }).expect(201);
    await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Kick-off call',
      assigneeId: seeded.users.pm!.id,
    }).expect(201);
    const box = await inbox(member);
    expect(box.items).toHaveLength(1);
    expect(box.items[0]).toMatchObject({
      type: 'task.assigned',
      link: `/app/projects/${projectId}/board`,
    });
    expect(box.items[0]!.title).toContain('Homepage copy');
    expect((await inbox(pm)).items).toHaveLength(0);
    // Reassigning to the same person is no event; to someone else is.
    await send(pm, 'patch', `/tasks/${a.body.data.id}`, {
      version: a.body.data.version,
      assigneeId: seeded.users.pm!.id,
    }).expect(200);
    expect((await inbox(member)).items).toHaveLength(1);
  });

  it('a failed request leaves no notification and no job behind', async () => {
    const ch = await sentChange();
    const before = [await db.notification.count(), await db.outboxJob.count()];
    await send(client, 'post', `/portal/changes/${ch.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: 'b'.repeat(64),
    }).expect(409);
    expect([await db.notification.count(), await db.outboxJob.count()]).toEqual(before);
    // A rolled-back transaction takes its notification with it.
    await expect(
      db.$transaction(async (tx) => {
        await notify(tx, {
          agencyId: seeded.agencyId,
          recipientIds: [seeded.users.pm!.id],
          category: 'CLIENT_ACTIVITY',
          type: 'test.rollback',
          title: 'Should vanish',
          link: '/app/dashboard',
        });
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(await db.notification.count({ where: { type: 'test.rollback' } })).toBe(0);
  });

  it('skips deactivated users, clients and other agencies, and refuses non-app links', async () => {
    await db.user.update({ where: { id: seeded.users.admin!.id }, data: { active: false } });
    const created = await db.$transaction((tx) =>
      notify(tx, {
        agencyId: seeded.agencyId,
        recipientIds: [
          seeded.users.admin!.id,
          clientUserId,
          randomUUID(),
          seeded.users.pm!.id,
          null,
        ],
        category: 'TASKS',
        type: 'test.filter',
        title: 'Hello',
        link: '/app/dashboard',
      }),
    );
    expect(created).toBe(1);
    await expect(
      db.$transaction((tx) =>
        notify(tx, {
          agencyId: seeded.agencyId,
          recipientIds: [seeded.users.pm!.id],
          category: 'TASKS',
          type: 'test.link',
          title: 'Hello',
          link: 'https://evil.test/',
        }),
      ),
    ).rejects.toThrow();
    // The database refuses it too.
    await expect(
      db.notification.create({
        data: {
          agencyId: seeded.agencyId,
          recipientId: seeded.users.pm!.id,
          category: 'TASKS',
          type: 'x',
          title: 'x',
          link: '//evil.test',
        },
      }),
    ).rejects.toThrow();
  });
});

describe('notification center (FR-X09)', () => {
  async function three() {
    for (const title of ['One', 'Two', 'Three']) {
      await db.$transaction((tx) =>
        notify(tx, {
          agencyId: seeded.agencyId,
          recipientIds: [seeded.users.pm!.id],
          category: 'TASKS',
          type: 'test.item',
          title,
          link: `/app/projects/${projectId}/board`,
        }),
      );
    }
  }

  it('lists only my notifications, newest first, with paging and an unread filter', async () => {
    await three();
    const first = (await get(pm, '/notifications?limit=2').expect(200)).body.data;
    expect(first.items.map((n: { title: string }) => n.title)).toEqual(['Three', 'Two']);
    expect(first.unreadCount).toBe(3);
    const next = (
      await get(pm, `/notifications?limit=2&before=${encodeURIComponent(first.nextCursor)}`).expect(
        200,
      )
    ).body.data;
    expect(next.items.map((n: { title: string }) => n.title)).toEqual(['One']);
    expect(next.nextCursor).toBeNull();
    expect((await get(pm, '/notifications/unread-count').expect(200)).body.data.count).toBe(3);
    expect((await inbox(member)).items).toHaveLength(0);
    await get(pm, '/notifications?limit=500').expect(422);
    await get(pm, '/notifications?recipientId=x').expect(422);
  });

  it('marks one or all as read; someone else’s notification is a 404', async () => {
    await three();
    const items = (await inbox(pm)).items;
    // Another user cannot read or mark it, and cannot tell that it exists.
    await send(member, 'patch', `/notifications/${items[0]!.id}/read`).expect(404);
    await send(member, 'patch', `/notifications/not-a-uuid/read`).expect(404);
    const one = await send(pm, 'patch', `/notifications/${items[0]!.id}/read`).expect(200);
    expect(one.body.data.unreadCount).toBe(2);
    await send(pm, 'patch', `/notifications/${items[0]!.id}/read`).expect(200);
    // "Mark all" covers what the list showed; a notification arriving later stays unread.
    const upTo = new Date().toISOString();
    await new Promise((r) => setTimeout(r, 10));
    await db.$transaction((tx) =>
      notify(tx, {
        agencyId: seeded.agencyId,
        recipientIds: [seeded.users.pm!.id],
        category: 'TASKS',
        type: 'test.late',
        title: 'Late',
        link: '/app/dashboard',
      }),
    );
    const all = await send(pm, 'post', '/notifications/read-all', { upTo }).expect(200);
    expect(all.body.data).toEqual({ marked: 2, unreadCount: 1 });
    await send(pm, 'post', '/notifications/read-all', {}).expect(422);
    await send(pm, 'patch', `/notifications/${items[0]!.id}/read`)
      .set('X-CSRF-Token', 'bad')
      .expect(403);
  });

  it('preferences: defaults, saved choices per channel, audited, and applied to new events', async () => {
    const defaults = (await get(member, '/notification-preferences').expect(200)).body.data;
    expect(
      defaults.find((p: { category: string }) => p.category === 'CLIENT_ACTIVITY'),
    ).toMatchObject({
      inApp: true,
      email: true,
    });
    expect(defaults.find((p: { category: string }) => p.category === 'TASKS')).toMatchObject({
      inApp: true,
      email: false,
    });
    await send(member, 'put', '/notification-preferences', {
      preferences: [{ category: 'TASKS', inApp: false, email: true }],
    }).expect(200);
    await send(member, 'put', '/notification-preferences', {
      preferences: [
        { category: 'TASKS', inApp: true, email: true },
        { category: 'TASKS', inApp: false, email: false },
      ],
    }).expect(422);
    await send(member, 'put', '/notification-preferences', {
      preferences: [{ category: 'NOPE', inApp: true, email: true }],
    }).expect(422);
    expect(await db.auditEvent.count({ where: { action: 'notification.preferences' } })).toBe(1);

    // In-app off, email on: not in the list, but emailed.
    await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Write copy',
      assigneeId: seeded.users.member!.id,
    }).expect(201);
    expect((await inbox(member)).items).toHaveLength(0);
    await t.drainJobs();
    expect(t.mailer.messages.filter((m) => m.to === seeded.users.member!.email)).toHaveLength(1);

    // Both off: nothing at all.
    await send(member, 'put', '/notification-preferences', {
      preferences: [{ category: 'TASKS', inApp: false, email: false }],
    }).expect(200);
    const before = await db.notification.count();
    await send(pm, 'post', `/projects/${projectId}/tasks`, {
      title: 'Review copy',
      assigneeId: seeded.users.member!.id,
    }).expect(201);
    expect(await db.notification.count()).toBe(before);
    // Each user changes only their own preferences.
    expect((await get(pm, '/notification-preferences').expect(200)).body.data[2]).toMatchObject({
      category: 'TASKS',
      inApp: true,
    });
  });
});

describe('job outbox and worker (FR-A02)', () => {
  const deps = () => ({ db, mailer: t.mailer, logger: silent, publicUrl: ORIGIN });

  async function emailJob() {
    await db.$transaction((tx) =>
      notify(tx, {
        agencyId: seeded.agencyId,
        recipientIds: [seeded.users.pm!.id],
        category: 'CLIENT_ACTIVITY',
        type: 'comment.client',
        title: 'A client commented',
        link: `/app/projects/${projectId}`,
      }),
    );
    return db.outboxJob.findFirstOrThrow({ where: { kind: 'email.notification' } });
  }

  it('enqueue with the same dedupe key is a no-op; payloads are checked', async () => {
    const job = {
      agencyId: seeded.agencyId,
      kind: 'reminders.scan' as const,
      payload: { agencyId: seeded.agencyId },
      dedupeKey: 'same',
    };
    await enqueue(db, [job]);
    await enqueue(db, [job]);
    expect(await db.outboxJob.count()).toBe(1);
    await expect(
      enqueue(db, [{ ...job, dedupeKey: 'x', payload: { agencyId: 'nope' } }]),
    ).rejects.toThrow();
    await scheduleReminderScans(deps(), 60_000);
    await scheduleReminderScans(deps(), 60_000);
    expect(await db.outboxJob.count({ where: { kind: 'reminders.scan' } })).toBe(2);
  });

  it('retries with backoff, then succeeds; the error is kept without addresses', async () => {
    const job = await emailJob();
    t.mailer.failures.push({ afterSend: false });
    const before = Date.now();
    expect(await runDueJobs(deps())).toEqual({ done: 0, retried: 1, dead: 0 });
    const after = await db.outboxJob.findUniqueOrThrow({ where: { id: job.id } });
    expect(after).toMatchObject({ state: 'PENDING', attempts: 1, lockedUntil: null });
    expect(after.lastError).toBe('Error: Mail provider unavailable');
    const wait = after.availableAt.getTime() - before;
    expect(wait).toBeGreaterThanOrEqual(24_000);
    expect(wait).toBeLessThanOrEqual(37_000);
    // Not due yet: nothing runs.
    expect(await runDueJobs(deps())).toEqual({ done: 0, retried: 0, dead: 0 });
    await db.outboxJob.update({ where: { id: job.id }, data: { availableAt: new Date() } });
    expect(await runDueJobs(deps())).toEqual({ done: 1, retried: 0, dead: 0 });
    expect(t.mailer.messages).toHaveLength(1);
    expect(describeError(new Error('550 rejected: pm@agency.test unknown'))).toBe(
      'Error: 550 rejected: [address] unknown',
    );
    expect([1, 2, 3, 10].map((n) => backoffMs(n, () => 0.5))).toEqual([
      30_000, 60_000, 120_000, 3_600_000,
    ]);
  });

  it('a crash after the provider accepted the email does not send it twice', async () => {
    const job = await emailJob();
    t.mailer.failures.push({ afterSend: true });
    expect(await runDueJobs(deps())).toMatchObject({ retried: 1 });
    await db.outboxJob.update({ where: { id: job.id }, data: { availableAt: new Date() } });
    expect(await runDueJobs(deps())).toMatchObject({ done: 1 });
    expect(t.mailer.messages).toHaveLength(1);
    // The dev sink drops repeats with the same key as well.
    const dir = mkdtempSync(join(tmpdir(), 'clientflow-sink-'));
    const sink = new DevSinkMailer(dir, silent);
    const msg = { kind: 'x', to: 'a@b.test', subject: 's', text: 't', idempotencyKey: 'k-1' };
    await sink.send(msg);
    await sink.send(msg);
    expect(readdirSync(dir)).toHaveLength(1);
  });

  it('dead-letters after the last attempt; owner/admin see it and can retry (audited)', async () => {
    const job = await emailJob();
    await db.outboxJob.update({ where: { id: job.id }, data: { maxAttempts: 2 } });
    t.mailer.failures.push({ afterSend: false }, { afterSend: false });
    await runDueJobs(deps());
    await db.outboxJob.update({ where: { id: job.id }, data: { availableAt: new Date() } });
    expect(await runDueJobs(deps())).toEqual({ done: 0, retried: 0, dead: 1 });
    const summary = (await get(owner, '/jobs').expect(200)).body.data;
    expect(summary.counts.dead).toBe(1);
    expect(summary.dead[0]).toMatchObject({ id: job.id, kind: 'email.notification', attempts: 2 });
    expect(JSON.stringify(summary)).not.toContain('@');
    for (const a of [pm, finance, member, client]) await get(a, '/jobs').expect(403);
    await send(pm, 'post', `/jobs/${job.id}/retry`).expect(403);
    await send(admin, 'post', `/jobs/${randomUUID()}/retry`).expect(404);
    await send(admin, 'post', `/jobs/${job.id}/retry`).expect(200);
    expect(await runDueJobs(deps())).toMatchObject({ done: 1 });
    expect(await db.auditEvent.count({ where: { action: 'job.retry' } })).toBe(1);
    // A retried job that is not dead any more cannot be retried again.
    await send(admin, 'post', `/jobs/${job.id}/retry`).expect(404);
  });

  it('two workers never take the same job; a crashed worker’s job is picked up after its claim', async () => {
    for (let i = 0; i < 6; i++) {
      await enqueue(db, [
        {
          agencyId: seeded.agencyId,
          kind: 'reminders.scan',
          payload: { agencyId: seeded.agencyId },
          dedupeKey: `k${i}`,
        },
      ]);
    }
    const [a, b] = await Promise.all([claimJobs(db, 4), claimJobs(db, 4)]);
    const ids = [...a, ...b].map((j) => j.id);
    expect(ids).toHaveLength(6);
    expect(new Set(ids).size).toBe(6);
    // Nobody completes them (the workers "crashed"). Before the claim expires: nothing to do.
    expect(await claimJobs(db, 10)).toHaveLength(0);
    const later = new Date(Date.now() + (CLAIM_SECONDS + 1) * 1000);
    const again = await claimJobs(db, 10, later);
    expect(again).toHaveLength(6);
    expect(again.every((j) => j.attempts === 2)).toBe(true);
  });
});

describe('scheduled reminders (FR-A01, FR-S09)', () => {
  const scan = (now: Date) => runReminderScan(db, seeded.agencyId, now);
  const types = async (userId: string) =>
    (
      await db.notification.findMany({ where: { recipientId: userId }, orderBy: { type: 'asc' } })
    ).map((n) => n.type);

  it('follow-ups, deals and tasks: once per due date, only recent ones', async () => {
    const now = new Date('2026-11-10T10:00:00Z');
    const owner = seeded.users.salesA!.id;
    await db.contact.createMany({
      data: [
        {
          agencyId: seeded.agencyId,
          ownerId: owner,
          fullName: 'Due',
          nextActionAt: new Date('2026-11-10T09:00:00Z'),
        },
        {
          agencyId: seeded.agencyId,
          ownerId: owner,
          fullName: 'Old',
          nextActionAt: new Date('2026-10-20T09:00:00Z'),
        },
        {
          agencyId: seeded.agencyId,
          ownerId: owner,
          fullName: 'Later',
          nextActionAt: new Date('2026-11-11T09:00:00Z'),
        },
      ],
    });
    const contact = await db.contact.findFirstOrThrow({ where: { fullName: 'Due' } });
    const deal = await makeDeal(db, seeded.agencyId, owner, { contactId: contact.id });
    await db.deal.update({
      where: { id: deal.id },
      data: { nextStep: 'Call back', nextStepAt: new Date('2026-11-09T12:00:00Z') },
    });
    await db.task.create({
      data: {
        agencyId: seeded.agencyId,
        projectId,
        title: 'Due today',
        assigneeId: seeded.users.member!.id,
        createdById: seeded.users.pm!.id,
        dueOn: new Date('2026-11-10T00:00:00Z'),
      },
    });
    const first = await scan(now);
    expect(first.scanned).toBe(true);
    expect(await types(owner)).toEqual([
      'reminder.follow_up_overdue',
      'reminder.next_step_overdue',
    ]);
    expect(await types(seeded.users.member!.id)).toEqual(['reminder.task_due']);
    // Running again (or later the same day) adds nothing.
    expect((await scan(new Date('2026-11-10T11:00:00Z'))).created).toBe(0);
    // A new follow-up date that is missed again is a new reminder.
    await db.contact.update({
      where: { id: contact.id },
      data: { nextActionAt: new Date('2026-11-12T09:00:00Z') },
    });
    expect((await scan(new Date('2026-11-12T10:00:00Z'))).created).toBeGreaterThanOrEqual(1);
  });

  it('overdue invoices use the agency’s day (Africa/Cairo), go to finance only, and email nobody by default', async () => {
    const inv = await issuedInvoice('2027-01-31');
    // 23:30 in Cairo on the due date: not overdue yet (UTC would already be the same day too).
    expect((await scan(new Date('2027-01-31T21:30:00Z'))).created).toBe(0);
    // 00:30 in Cairo on Feb 1, still Jan 31 in UTC: overdue for the agency.
    expect((await scan(new Date('2027-01-31T22:30:00Z'))).created).toBe(3);
    const rows = await db.notification.findMany({ where: { type: 'reminder.invoice_overdue' } });
    expect(rows.map((r) => r.recipientId).sort()).toEqual(
      [seeded.users.owner!.id, seeded.users.admin!.id, seeded.users.finance!.id].sort(),
    );
    expect(rows[0]!.link).toBe(`/app/invoices/${inv.id}`);
    expect(rows[0]!.title).toContain('INV-0001');
    expect(await db.outboxJob.count({ where: { kind: 'email.notification' } })).toBe(0);
    // Paid invoices are not reminded about.
    await db.invoice.update({
      where: { id: inv.id },
      data: { paidMinor: 114_000n, status: 'PAID' },
    });
    await issuedInvoice('2027-01-31');
    await db.invoice.updateMany({
      where: { status: 'ISSUED' },
      data: { paidMinor: 114_000n, status: 'PAID' },
    });
    expect((await scan(new Date('2027-02-05T10:00:00Z'))).created).toBe(0);
  });

  it('changes waiting on the client for 3 days remind the PM once; scans running at once do not double up', async () => {
    const ch = await sentChange();
    const sentAt = (
      await db.changeVersion.findFirstOrThrow({ where: { changeRequestId: ch.id, status: 'SENT' } })
    ).sentAt!;
    expect((await scan(new Date(sentAt.getTime() + 2 * 86_400_000))).created).toBe(0);
    const later = new Date(sentAt.getTime() + 4 * 86_400_000);
    const results = await Promise.all([scan(later), scan(later), scan(later)]);
    expect(results.reduce((n, r) => n + r.created, 0)).toBe(1);
    const n = await db.notification.findFirstOrThrow({
      where: { type: 'reminder.client_decision_waiting' },
    });
    expect(n.recipientId).toBe(seeded.users.pm!.id);
    expect(n.link).toBe(`/app/projects/${projectId}/changes/${ch.id}`);
  });

  it('runs as a job: the scan job completes and the health view shows when it last ran', async () => {
    await scheduleReminderScans(
      { db, mailer: t.mailer, logger: silent, publicUrl: ORIGIN },
      60_000,
    );
    expect((await get(owner, '/jobs').expect(200)).body.data.lastReminderScanAt).toBeNull();
    expect(await t.drainJobs()).toMatchObject({ done: 1, dead: 0 });
    expect((await get(owner, '/jobs').expect(200)).body.data.lastReminderScanAt).not.toBeNull();
  });
});
