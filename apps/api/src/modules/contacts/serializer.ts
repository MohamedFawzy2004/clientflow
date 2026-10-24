import type { ActivityItem, ContactDetail, ContactSummary } from '@clientflow/contracts';
import type { Activity, Contact, User } from '../../generated/prisma/client.js';

type ContactWithOwner = Contact & { owner: Pick<User, 'id' | 'name'> };
type ActivityWithActor = Activity & { actor: Pick<User, 'id' | 'name'> | null };

// Explicit field allowlists: Prisma rows are never sent to clients as they are (spec §11.3).
export function toContactSummary(c: ContactWithOwner): ContactSummary {
  return {
    id: c.id,
    fullName: c.fullName,
    email: c.emailNorm,
    phone: c.phone,
    companyName: c.companyName,
    lifecycle: c.lifecycle,
    source: c.source,
    owner: { id: c.owner.id, name: c.owner.name },
    nextActionAt: c.nextActionAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    version: c.version,
  };
}

export function toActivityItem(a: ActivityWithActor): ActivityItem {
  return {
    id: a.id,
    eventType: a.eventType,
    summary: a.summary,
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
    createdAt: a.createdAt.toISOString(),
  };
}

export function toContactDetail(c: ContactWithOwner, activities: ActivityWithActor[]): ContactDetail {
  return { ...toContactSummary(c), notes: c.notes, activities: activities.map(toActivityItem) };
}
