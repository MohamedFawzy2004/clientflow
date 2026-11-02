import type { TimelineEntry } from '@clientflow/contracts';
import type { Activity, Prisma, User } from '../generated/prisma/client.js';
import type { AuthUser } from '../types/express.js';

type Tx = Pick<Prisma.TransactionClient, 'activity'>;

export interface TimelineInput {
  entityType: 'contact' | 'deal';
  entityId: string;
  eventType: string;
  summary: string;
  body?: string | null;
  occurredAt?: Date;
}

/** Appends a business timeline entry (spec §8.1 `activities`). Summaries never contain secrets. */
export function recordActivity(tx: Tx, actor: AuthUser, input: TimelineInput) {
  return tx.activity.create({
    data: {
      agencyId: actor.agencyId,
      actorId: actor.id,
      entityType: input.entityType,
      entityId: input.entityId,
      eventType: input.eventType,
      summary: input.summary.slice(0, 500),
      body: input.body ?? null,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    },
  });
}

export const actorSelect = { actor: { select: { id: true, name: true } } } as const;

export function toTimelineEntry(
  a: Activity & { actor: Pick<User, 'id' | 'name'> | null },
): TimelineEntry {
  return {
    id: a.id,
    eventType: a.eventType,
    summary: a.summary,
    body: a.body,
    actor: a.actor ? { id: a.actor.id, name: a.actor.name } : null,
    occurredAt: a.occurredAt.toISOString(),
    createdAt: a.createdAt.toISOString(),
  };
}
