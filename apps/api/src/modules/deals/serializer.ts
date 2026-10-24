import type { Currency, DealDetail, DealSummary, TimelineEntry } from '@clientflow/contracts';
import type { Contact, Deal, PipelineStage, User } from '../../generated/prisma/client.js';
import { formatDateOnly } from '../../lib/agency-time.js';

export const dealInclude = {
  stage: { select: { id: true, name: true, position: true } },
  contact: { select: { id: true, fullName: true, companyName: true } },
  owner: { select: { id: true, name: true } },
} as const;

export type DealRow = Deal & {
  stage: Pick<PipelineStage, 'id' | 'name' | 'position'>;
  contact: Pick<Contact, 'id' | 'fullName' | 'companyName'>;
  owner: Pick<User, 'id' | 'name'>;
};

// Explicit allowlist. BigInt amounts become decimal strings so JSON never rounds them.
export function toDealSummary(d: DealRow): DealSummary {
  return {
    id: d.id,
    title: d.title,
    amountMinor: d.amountMinor.toString(),
    currency: d.currency as Currency,
    status: d.status,
    stage: { id: d.stage.id, name: d.stage.name, position: d.stage.position },
    contact: { id: d.contact.id, fullName: d.contact.fullName, companyName: d.contact.companyName },
    owner: { id: d.owner.id, name: d.owner.name },
    expectedCloseOn: d.expectedCloseOn ? formatDateOnly(d.expectedCloseOn) : null,
    nextStep: d.nextStep,
    nextStepAt: d.nextStepAt?.toISOString() ?? null,
    closedAt: d.closedAt?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
    version: d.version,
  };
}

export function toDealDetail(
  d: DealRow & { closedBy: Pick<User, 'id' | 'name'> | null },
  activities: TimelineEntry[],
): DealDetail {
  return {
    ...toDealSummary(d),
    lostReason: d.lostReason,
    wonOverrideReason: d.wonOverrideReason,
    closedBy: d.closedBy ? { id: d.closedBy.id, name: d.closedBy.name } : null,
    activities,
  };
}
