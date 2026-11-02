// In-app notifications (FR-X09, ADR-059). `notify` runs inside the caller's transaction: the
// notification and its email job commit or roll back together with the event itself.
import {
  NOTIFICATION_CATEGORY_INFO,
  PERMISSIONS,
  type NotificationCategory,
  type Permission,
} from '@clientflow/contracts';
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
  const title =
    input.title.length > MAX_TITLE ? `${input.title.slice(0, MAX_TITLE - 1)}…` : input.title;
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

/** Active staff whose role has the permission, e.g. the approvers of a proposal. */
export async function usersWithPermission(tx: Tx, agencyId: string, permission: Permission) {
  const rows = await tx.user.findMany({
    where: { agencyId, active: true, role: { in: [...PERMISSIONS[permission]] } },
    select: { id: true },
  });
  return rows.map((r) => r.id);
}
