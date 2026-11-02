// The notification center (FR-X09). Every query is filtered by recipient = the signed-in user:
// nobody can list, count or mark another person's notifications (404, like any unseen record).
import {
  can,
  NOTIFICATION_CATEGORIES,
  NOTIFICATION_CATEGORY_INFO,
  type JobSummary,
  type NotificationPage,
  type NotificationPreferenceView,
  type notificationListQuerySchema,
  type notificationPreferencesSchema,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import { writeAudit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';

function requireNotifications(actor: AuthUser) {
  if (!can(actor.role, 'notifications.read')) {
    throw forbidden('Notifications are for team members.');
  }
}

const mine = (actor: AuthUser) => ({
  recipientId: actor.id,
  agencyId: actor.agencyId,
  inApp: true,
});

export async function listNotifications(
  db: Db,
  actor: AuthUser,
  q: z.output<typeof notificationListQuerySchema>,
): Promise<NotificationPage> {
  requireNotifications(actor);
  const rows = await db.notification.findMany({
    where: {
      ...mine(actor),
      ...(q.unread === 'true' ? { readAt: null } : {}),
      ...(q.before ? { createdAt: { lt: new Date(q.before) } } : {}),
    },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: q.limit + 1,
  });
  const page = rows.slice(0, q.limit);
  return {
    items: page.map((n) => ({
      id: n.id,
      category: n.category,
      type: n.type,
      title: n.title,
      link: n.link,
      createdAt: n.createdAt.toISOString(),
      readAt: n.readAt?.toISOString() ?? null,
    })),
    unreadCount: await unreadCount(db, actor),
    nextCursor: rows.length > q.limit ? page.at(-1)!.createdAt.toISOString() : null,
  };
}

export async function unreadCount(db: Db, actor: AuthUser) {
  requireNotifications(actor);
  return db.notification.count({ where: { ...mine(actor), readAt: null } });
}

export async function markRead(db: Db, actor: AuthUser, id: string) {
  requireNotifications(actor);
  if (!UUID_PATTERN.test(id)) throw notFound();
  const n = await db.notification.findFirst({ where: { id, ...mine(actor) } });
  if (!n) throw notFound();
  if (!n.readAt) await db.notification.update({ where: { id }, data: { readAt: new Date() } });
  return { id, unreadCount: await unreadCount(db, actor) };
}

/** Marks everything up to the moment the list was loaded, so a newer arrival stays unread. */
export async function markAllRead(db: Db, actor: AuthUser, upTo: string) {
  requireNotifications(actor);
  const res = await db.notification.updateMany({
    where: { ...mine(actor), readAt: null, createdAt: { lte: new Date(upTo) } },
    data: { readAt: new Date() },
  });
  return { marked: res.count, unreadCount: await unreadCount(db, actor) };
}

export async function getPreferences(
  db: Db,
  actor: AuthUser,
): Promise<NotificationPreferenceView[]> {
  requireNotifications(actor);
  const saved = await db.notificationPreference.findMany({ where: { userId: actor.id } });
  const byCategory = new Map(saved.map((p) => [p.category, p]));
  return NOTIFICATION_CATEGORIES.map((category) => {
    const info = NOTIFICATION_CATEGORY_INFO[category];
    const p = byCategory.get(category);
    return {
      category,
      label: info.label,
      description: info.description,
      inApp: p?.inApp ?? info.defaults.inApp,
      email: p?.email ?? info.defaults.email,
    };
  });
}

/** Saves the user's own channel choices (FR-X09, FR-A03 contact preferences). Audited. */
export async function savePreferences(
  db: Db,
  actor: AuthUser,
  input: z.output<typeof notificationPreferencesSchema>,
  requestId: string,
) {
  requireNotifications(actor);
  await db.$transaction(async (tx) => {
    for (const p of input.preferences) {
      await tx.notificationPreference.upsert({
        where: { userId_category: { userId: actor.id, category: p.category } },
        create: { userId: actor.id, category: p.category, inApp: p.inApp, email: p.email },
        update: { inApp: p.inApp, email: p.email },
      });
    }
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'notification.preferences',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: actor.id,
      requestId,
      metadata: Object.fromEntries(
        input.preferences.map((p) => [
          p.category,
          `${p.inApp ? 'app' : '-'}/${p.email ? 'mail' : '-'}`,
        ]),
      ),
    });
  });
  return getPreferences(db, actor);
}

// ---------------------------------------------------------------------------
// Background job health (Owner/Admin)
// ---------------------------------------------------------------------------

function requireJobs(actor: AuthUser) {
  if (!can(actor.role, 'jobs.manage')) throw forbidden('Only an owner or admin can see jobs.');
}

/**
 * Counts and the failed jobs of this agency. Jobs carry IDs only, so nothing personal is shown;
 * jobs without an agency (none exist yet) are not listed to anyone.
 */
export async function getJobSummary(db: Db, actor: AuthUser): Promise<JobSummary> {
  requireJobs(actor);
  const where = { agencyId: actor.agencyId };
  const [grouped, dead, lastScan] = await Promise.all([
    db.outboxJob.groupBy({ by: ['state'], where, _count: { _all: true } }),
    db.outboxJob.findMany({
      where: { ...where, state: 'DEAD' },
      orderBy: { finishedAt: 'desc' },
      take: 20,
    }),
    db.outboxJob.findFirst({
      where: { ...where, kind: 'reminders.scan', state: 'DONE' },
      orderBy: { finishedAt: 'desc' },
      select: { finishedAt: true },
    }),
  ]);
  const count = (s: string) => grouped.find((g) => g.state === s)?._count._all ?? 0;
  return {
    counts: {
      pending: count('PENDING'),
      running: count('RUNNING'),
      done: count('DONE'),
      dead: count('DEAD'),
    },
    dead: dead.map((j) => ({
      id: j.id,
      kind: j.kind,
      attempts: j.attempts,
      lastError: j.lastError,
      createdAt: j.createdAt.toISOString(),
      finishedAt: j.finishedAt?.toISOString() ?? null,
    })),
    lastReminderScanAt: lastScan?.finishedAt?.toISOString() ?? null,
  };
}

/** Gives a dead job a fresh set of attempts, e.g. after fixing the mail settings. Audited. */
export async function retryJob(db: Db, actor: AuthUser, id: string, requestId: string) {
  requireJobs(actor);
  if (!UUID_PATTERN.test(id)) throw notFound();
  await db.$transaction(async (tx) => {
    const res = await tx.outboxJob.updateMany({
      where: { id, agencyId: actor.agencyId, state: 'DEAD' },
      data: { state: 'PENDING', attempts: 0, availableAt: new Date(), finishedAt: null },
    });
    if (res.count === 0) throw notFound();
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'job.retry',
      outcome: 'SUCCESS',
      targetType: 'job',
      targetId: id,
      requestId,
    });
  });
  return getJobSummary(db, actor);
}
