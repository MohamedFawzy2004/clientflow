// In-app notifications (FR-X09, ADR-059). `notify` runs inside the caller's transaction: the
// notification and its email job commit or roll back together with the event itself.
import {
  NOTIFICATION_CATEGORY_INFO,
  PERMISSIONS,
  type NotificationCategory,
  type Permission,
} from '@clientflow/contracts';
import type { Prisma } from '../generated/prisma/client.js';
import { enqueue } from '../jobs/outbox.js';
import type { Tx } from '../modules/projects/access.js';

export interface NotifyInput {
  agencyId: string;
  recipientIds: Array<string | null | undefined>;
  /** Who caused the event. They are never notified about their own action. */
  actorId?: string | null;
  category: NotificationCategory;
  type: string;
  /** Plain text for the in-app list. Never emailed (SEC-24). */
  title: string;
  /** App path starting with /app/. Built here from IDs, never from user input. */
  link: string;
  entity?: { type: string; id: string };
  /** Reminders: one notification per key and recipient, however often the scan runs. */
  dedupeKey?: string;
}

const MAX_TITLE = 300;

/** Channels for each recipient: their saved choice, else the category default. */
async function channels(tx: Tx, userIds: string[], category: NotificationCategory) {
  const saved = await tx.notificationPreference.findMany({
    where: { userId: { in: userIds }, category },
  });
  const byUser = new Map(saved.map((p) => [p.userId, p]));
  const fallback = NOTIFICATION_CATEGORY_INFO[category].defaults;
  return new Map(
    userIds.map((id) => {
      const p = byUser.get(id);
      return [id, p ? { inApp: p.inApp, email: p.email } : fallback];
    }),
  );
}

/**
 * Creates one notification per recipient (active staff of the same agency only) and queues an
 * email for those who want one. Returns how many notifications were created.
 */
export async function notify(tx: Tx, input: NotifyInput): Promise<number> {
  if (!input.link.startsWith('/app/')) throw new Error(`Notification link must be an app path`);
  const ids = [...new Set(input.recipientIds.filter((id): id is string => Boolean(id)))].filter(
    (id) => id !== input.actorId,
  );
  if (ids.length === 0) return 0;
  // Re-checked here so a caller cannot notify a client, another agency or a deactivated user.
  const users = await tx.user.findMany({
    where: { id: { in: ids }, agencyId: input.agencyId, active: true, role: { not: 'CLIENT' } },
    select: { id: true },
  });
  if (users.length === 0) return 0;
  const prefs = await channels(
    tx,
    users.map((u) => u.id),
    input.category,
  );
  const wanted = users.filter((u) => {
    const c = prefs.get(u.id)!;
    return c.inApp || c.email;
  });
  if (wanted.length === 0) return 0;
  const title = clip(input.title);
  const created = await tx.notification.createManyAndReturn({
    data: wanted.map((u) => ({
      agencyId: input.agencyId,
      recipientId: u.id,
      category: input.category,
      type: input.type,
      title,
      link: input.link,
      entityType: input.entity?.type ?? null,
      entityId: input.entity?.id ?? null,
      actorId: input.actorId ?? null,
      dedupeKey: input.dedupeKey ?? null,
      inApp: prefs.get(u.id)!.inApp,
    })),
    // A reminder that already exists for this key is not created again.
    skipDuplicates: true,
    select: { id: true, recipientId: true },
  });
  await enqueue(
    tx,
    created
      .filter((n) => prefs.get(n.recipientId)!.email)
      .map((n) => ({
        agencyId: input.agencyId,
        kind: 'email.notification' as const,
        payload: { notificationId: n.id },
        dedupeKey: `email.notification:${n.id}`,
      })),
  );
  return created.length;
}

const clip = (title: string) =>
  title.length > MAX_TITLE ? `${title.slice(0, MAX_TITLE - 1)}…` : title;

/** A reminder from the scheduled scan: always deduplicated by key, never caused by a person. */
export type ReminderInput = Omit<NotifyInput, 'agencyId' | 'category' | 'actorId' | 'dedupeKey'> & {
  dedupeKey: string;
};

/** One notification row the scan will create, and whether its recipient wants an email. */
export interface PlannedNotification {
  data: Prisma.NotificationCreateManyInput;
  email: boolean;
}

/** Each user's channels for one category (null: not active staff, or every channel off). */
export type ChannelCache = Map<string, { inApp: boolean; email: boolean } | null>;

/**
 * The same rules as `notify`, for many reminders of one category at once (FR-A01). Returns, per
 * reminder, the rows still to create: recipients who are active staff of the agency, want the
 * category on some channel, and have no notification with that key yet. Users are looked up
 * once per scan through `cache`, and existing keys in one query per call.
 */
export async function planReminders(
  tx: Tx,
  agencyId: string,
  category: NotificationCategory,
  reminders: ReminderInput[],
  cache: ChannelCache,
): Promise<PlannedNotification[][]> {
  const recipients = (r: ReminderInput) => [
    ...new Set(r.recipientIds.filter((id): id is string => Boolean(id))),
  ];
  const unknown = [...new Set(reminders.flatMap(recipients))].filter((id) => !cache.has(id));
  if (unknown.length > 0) {
    const users = await tx.user.findMany({
      where: { id: { in: unknown }, agencyId, active: true, role: { not: 'CLIENT' } },
      select: { id: true },
    });
    const prefs =
      users.length > 0
        ? await channels(
            tx,
            users.map((u) => u.id),
            category,
          )
        : new Map<string, { inApp: boolean; email: boolean }>();
    for (const id of unknown) {
      const c = prefs.get(id);
      cache.set(id, c && (c.inApp || c.email) ? c : null);
    }
  }
  const planned = reminders.map((r) => {
    if (!r.link.startsWith('/app/')) throw new Error(`Notification link must be an app path`);
    return recipients(r).flatMap((id) => {
      const c = cache.get(id);
      if (!c) return [];
      const data: Prisma.NotificationCreateManyInput = {
        agencyId,
        recipientId: id,
        category,
        type: r.type,
        title: clip(r.title),
        link: r.link,
        entityType: r.entity?.type ?? null,
        entityId: r.entity?.id ?? null,
        dedupeKey: r.dedupeKey,
        inApp: c.inApp,
      };
      return [{ data, email: c.email }];
    });
  });
  const rows = planned.flat();
  if (rows.length === 0) return planned;
  const existing = await tx.notification.findMany({
    where: {
      recipientId: { in: [...new Set(rows.map((p) => p.data.recipientId))] },
      dedupeKey: { in: [...new Set(rows.map((p) => p.data.dedupeKey!))] },
    },
    select: { recipientId: true, dedupeKey: true },
  });
  const sent = new Set(existing.map((n) => `${n.recipientId} ${n.dedupeKey}`));
  return planned.map((list) =>
    list.filter((p) => !sent.has(`${p.data.recipientId} ${p.data.dedupeKey}`)),
  );
}

/** Writes planned reminders and queues their emails, a few statements per thousand rows. */
export async function createPlanned(tx: Tx, rows: PlannedNotification[]): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += 1000) {
    const chunk = rows.slice(i, i + 1000);
    const created = await tx.notification.createManyAndReturn({
      data: chunk.map((p) => p.data),
      // Another scan may have created some meanwhile: those are skipped, never doubled.
      skipDuplicates: true,
      select: { id: true, agencyId: true, recipientId: true, dedupeKey: true },
    });
    const wantsEmail = new Set(
      chunk.filter((p) => p.email).map((p) => `${p.data.recipientId} ${p.data.dedupeKey}`),
    );
    await enqueue(
      tx,
      created
        .filter((n) => wantsEmail.has(`${n.recipientId} ${n.dedupeKey}`))
        .map((n) => ({
          agencyId: n.agencyId,
          kind: 'email.notification' as const,
          payload: { notificationId: n.id },
          dedupeKey: `email.notification:${n.id}`,
        })),
    );
    total += created.length;
  }
  return total;
}

/** Active staff whose role has the permission, e.g. the approvers of a proposal. */
export async function usersWithPermission(tx: Tx, agencyId: string, permission: Permission) {
  const rows = await tx.user.findMany({
    where: { agencyId, active: true, role: { in: [...PERMISSIONS[permission]] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
