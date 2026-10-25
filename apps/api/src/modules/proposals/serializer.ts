import { createHash } from 'node:crypto';
import {
  formatQuantity,
  proposalReference,
  type Currency,
  type PortalProposalVersion,
  type ProposalDisplayStatus,
  type ProposalItemView,
  type ProposalReviewEntry,
  type ProposalStatus,
  type ProposalSummary,
  type ProposalVersionContent,
  type ProposalVersionListItem,
  type ProposalVersionView,
} from '@clientflow/contracts';
import type {
  Prisma,
  ProposalItem,
  ProposalReview,
  ProposalVersion,
  User,
} from '../../generated/prisma/client.js';
import { formatDateOnly } from '../../lib/agency-time.js';

export const versionInclude = {
  items: { orderBy: { position: 'asc' } },
  reviews: {
    orderBy: { occurredAt: 'asc' },
    include: { actor: { select: { id: true, name: true, role: true } } },
  },
} as const satisfies Prisma.ProposalVersionInclude;

export const proposalInclude = {
  deal: {
    select: {
      id: true,
      title: true,
      status: true,
      ownerId: true,
      owner: { select: { id: true, name: true } },
      contact: {
        select: { id: true, fullName: true, companyName: true, clientOrgId: true },
      },
    },
  },
  versions: {
    orderBy: { versionNo: 'desc' },
    select: {
      id: true,
      versionNo: true,
      status: true,
      title: true,
      totalMinor: true,
      currency: true,
      expiresOn: true,
      updatedAt: true,
    },
  },
} as const satisfies Prisma.ProposalInclude;

export type VersionRow = ProposalVersion & {
  items: ProposalItem[];
  reviews: Array<ProposalReview & { actor: Pick<User, 'id' | 'name' | 'role'> }>;
};
export type ProposalRow = Prisma.ProposalGetPayload<{ include: typeof proposalInclude }>;

/** A sent version past its expiry date (end of that day, agency time) shows as EXPIRED. */
export function displayStatus(
  status: ProposalStatus,
  expiresOn: Date,
  today: string,
): ProposalDisplayStatus {
  return status === 'SENT' && formatDateOnly(expiresOn) < today ? 'EXPIRED' : status;
}

function toItemView(i: ProposalItem): ProposalItemView {
  return {
    id: i.id,
    position: i.position,
    serviceId: i.serviceId,
    name: i.name,
    description: i.description,
    unit: i.unit,
    quantity: formatQuantity(i.quantityCenti),
    quantityCenti: i.quantityCenti,
    unitPriceMinor: i.unitPriceMinor.toString(),
    lineTotalMinor: i.lineTotalMinor.toString(),
  };
}

/** Exactly the client-visible content. Internal notes and workflow data are never part of it. */
export function toVersionContent(
  v: ProposalVersion & { items: ProposalItem[] },
): ProposalVersionContent {
  return {
    versionNo: v.versionNo,
    title: v.title,
    summary: v.summary,
    inclusions: v.inclusions,
    exclusions: v.exclusions,
    assumptions: v.assumptions,
    milestones: v.milestones,
    paymentTerms: v.paymentTerms,
    terms: v.terms,
    currency: v.currency as Currency,
    expiresOn: formatDateOnly(v.expiresOn),
    discountBp: v.discountBp,
    taxRateBp: v.taxRateBp,
    taxLabel: v.taxLabel,
    items: v.items.map(toItemView),
    subtotalMinor: v.subtotalMinor.toString(),
    discountMinor: v.discountMinor.toString(),
    taxMinor: v.taxMinor.toString(),
    totalMinor: v.totalMinor.toString(),
  };
}

/**
 * SHA-256 over a canonical rendering of the client-visible content (FR-Q09). Item IDs are left out
 * so the hash describes the terms, not database identities; keys are emitted in a fixed order.
 */
export function contentHash(proposalId: string, content: ProposalVersionContent): string {
  const canonical = JSON.stringify([
    'clientflow.proposal.v1',
    proposalId,
    content.versionNo,
    content.title,
    content.summary,
    content.inclusions,
    content.exclusions,
    content.assumptions,
    content.milestones,
    content.paymentTerms,
    content.terms,
    content.currency,
    content.expiresOn,
    content.discountBp,
    content.taxRateBp,
    content.taxLabel,
    content.items.map((i) => [
      i.position,
      i.name,
      i.description,
      i.unit,
      i.quantityCenti,
      i.unitPriceMinor,
      i.lineTotalMinor,
    ]),
    content.subtotalMinor,
    content.discountMinor,
    content.taxMinor,
    content.totalMinor,
  ]);
  return createHash('sha256').update(canonical, 'utf8').digest('hex');
}

function toReviewEntry(r: VersionRow['reviews'][number]): ProposalReviewEntry {
  return {
    id: r.id,
    kind: r.kind,
    decision: r.decision,
    comment: r.comment,
    actor: { id: r.actor.id, name: r.actor.name },
    occurredAt: r.occurredAt.toISOString(),
  };
}

export function toVersionView(v: VersionRow, today: string): ProposalVersionView {
  return {
    ...toVersionContent(v),
    id: v.id,
    status: v.status,
    displayStatus: displayStatus(v.status, v.expiresOn, today),
    internalNotes: v.internalNotes,
    contentHash: v.contentHash,
    submittedAt: v.submittedAt?.toISOString() ?? null,
    approvedAt: v.approvedAt?.toISOString() ?? null,
    sentAt: v.sentAt?.toISOString() ?? null,
    decidedAt: v.decidedAt?.toISOString() ?? null,
    version: v.version,
    reviews: v.reviews.map(toReviewEntry),
  };
}

export function toVersionListItem(
  v: ProposalRow['versions'][number],
  today: string,
): ProposalVersionListItem {
  return {
    id: v.id,
    versionNo: v.versionNo,
    status: v.status,
    displayStatus: displayStatus(v.status, v.expiresOn, today),
    totalMinor: v.totalMinor.toString(),
    currency: v.currency as Currency,
    updatedAt: v.updatedAt.toISOString(),
  };
}

/** The version a list row describes: the accepted one if any, otherwise the newest. */
export function headlineVersion(p: ProposalRow) {
  return p.versions.find((v) => v.status === 'ACCEPTED') ?? p.versions[0]!;
}

export function toProposalSummary(p: ProposalRow, today: string): ProposalSummary {
  const head = headlineVersion(p);
  return {
    id: p.id,
    reference: proposalReference(p.number),
    title: head.title,
    status: p.status,
    displayStatus: displayStatus(p.status, head.expiresOn, today),
    currentVersionNo: p.currentVersionNo,
    totalMinor: head.totalMinor.toString(),
    currency: head.currency as Currency,
    expiresOn: formatDateOnly(head.expiresOn),
    deal: { id: p.deal.id, title: p.deal.title, status: p.deal.status },
    contact: {
      id: p.deal.contact.id,
      fullName: p.deal.contact.fullName,
      companyName: p.deal.contact.companyName,
    },
    owner: { id: p.deal.owner.id, name: p.deal.owner.name },
    updatedAt: p.updatedAt.toISOString(),
    version: p.version,
  };
}

/** Portal view of a sent version: no internal notes, no staff reviews, no staff names. */
export function toPortalVersion(v: VersionRow, today: string): PortalProposalVersion {
  const decision = v.reviews.find((r) => r.kind === 'CLIENT');
  return {
    ...toVersionContent(v),
    id: v.id,
    status: v.status,
    displayStatus: displayStatus(v.status, v.expiresOn, today),
    contentHash: v.contentHash!,
    sentAt: v.sentAt!.toISOString(),
    decidedAt: v.decidedAt?.toISOString() ?? null,
    decision: decision
      ? {
          decision: decision.decision as 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED',
          by: decision.actor.name,
          at: decision.occurredAt.toISOString(),
          comment: decision.comment,
        }
      : null,
  };
}
