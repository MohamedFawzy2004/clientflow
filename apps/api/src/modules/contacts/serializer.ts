import type { ContactDetail, ContactSummary, ContactWithDeals } from '@clientflow/contracts';
import type { Activity, Contact, User } from '../../generated/prisma/client.js';
import { toTimelineEntry } from '../../lib/timeline.js';
import { type DealRow, toDealSummary } from '../deals/serializer.js';

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
    convertedAt: c.convertedAt?.toISOString() ?? null,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    version: c.version,
  };
}

export function toContactDetail(
  c: ContactWithOwner,
  activities: ActivityWithActor[],
): ContactDetail {
  return { ...toContactSummary(c), notes: c.notes, activities: activities.map(toTimelineEntry) };
}

export function toContactWithDeals(
  c: ContactWithOwner,
  activities: ActivityWithActor[],
  deals: DealRow[],
): ContactWithDeals {
  return { ...toContactDetail(c, activities), deals: deals.map(toDealSummary) };
}
