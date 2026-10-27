// M8 contracts: change requests (versioned scope changes) and client comments (FR-S01 – FR-S05,
// FR-X08).
import { z } from 'zod';
import { parseMoneyToMinor, type Currency } from './money.js';

const uuid = z.uuid({ message: 'Choose an item from the list.' });
const version = z.number().int().positive();
const isoDate = z.iso.date({ message: 'Enter a valid date.' });
const clearableDate = z
  .union([z.literal(''), z.null(), isoDate])
  .optional()
  .transform((v) => (v === '' ? null : v));
const title = z.string().trim().min(1, 'Give it a name.').max(200, 'Keep it under 200 characters.');
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .nullish()
    .transform((v) => (v ? v : null));

// ---------------------------------------------------------------------------
// States (spec §9)
// ---------------------------------------------------------------------------

export const CHANGE_STATUSES = [
  'REQUESTED',
  'ESTIMATING',
  'IN_REVIEW',
  'AWAITING_CLIENT',
  'ACCEPTED',
  'REJECTED',
  'WITHDRAWN',
] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = {
  REQUESTED: 'Requested',
  ESTIMATING: 'Estimating',
  IN_REVIEW: 'In internal review',
  AWAITING_CLIENT: 'Waiting for the client',
  ACCEPTED: 'Accepted',
  REJECTED: 'Rejected',
  WITHDRAWN: 'Withdrawn',
};

export const CHANGE_VERSION_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED_INTERNAL',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'SUPERSEDED',
  'WITHDRAWN',
] as const;
export type ChangeVersionStatus = (typeof CHANGE_VERSION_STATUSES)[number];

/** Open changes can still be withdrawn; the rest are final. */
export const OPEN_CHANGE_STATUSES: readonly ChangeStatus[] = [
  'REQUESTED',
  'ESTIMATING',
  'IN_REVIEW',
  'AWAITING_CLIENT',
];

/** "CR-3". */
export function changeReference(n: number) {
  return `CR-${n}`;
}

/** Work items: one per line (bullets and numbering removed), at most 20, 200 characters each. */
export function workItemsFromText(text: string | null | undefined): string[] {
  if (!text) return [];
  return text
    .split(/\r?\n/)
    .map((l) =>
      l
        .replace(/^[-*•\d.)\s]+/, '')
        .trim()
        .slice(0, 200),
    )
    .filter(Boolean)
    .slice(0, 20);
}

/** Tax on a tax-exclusive price, rounded half up, in minor units (exact, no floats). */
export function taxOn(priceMinor: bigint, rateBp: number): bigint {
  return (priceMinor * BigInt(rateBp) + 5000n) / 10000n;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const changeCreateSchema = z
  .object({
    title,
    description: z
      .string()
      .trim()
      .min(3, 'Describe what should change.')
      .max(5000, 'Keep it under 5000 characters.'),
    justification: optionalText(2000),
  })
  .strict();
export type ChangeCreateInput = z.input<typeof changeCreateSchema>;

/** The project manager's estimate, saved on the draft version (FR-S02). */
export const changeDraftSchema = z
  .object({
    /** The change request's version, for optimistic locking. */
    version,
    scope: z
      .string()
      .trim()
      .min(3, 'Say what changes in the scope.')
      .max(5000, 'Keep it under 5000 characters.'),
    workItems: optionalText(5000),
    estimateMinutes: z
      .number({ message: 'Enter the estimate in hours.' })
      .int()
      .min(0)
      .max(600_000, 'Keep the estimate under 10,000 hours.')
      .nullish(),
    /** Excluding tax, as a decimal string in the project currency, e.g. "12500.00". */
    price: z.string().trim().max(24),
    newDueOn: clearableDate,
  })
  .strict();
export type ChangeDraftInput = z.input<typeof changeDraftSchema>;

/** Validates a price against a currency; null when it is not a valid amount. */
export function parseChangePrice(price: string, currency: Currency): string | null {
  if (price === '' || price === '0') return '0';
  return parseMoneyToMinor(price, currency);
}

export const changeVersionActionSchema = z.object({ version }).strict();

export const changeReviewSchema = z
  .object({
    version,
    decision: z.enum(['APPROVE', 'RETURN'], { message: 'Choose a decision.' }),
    comment: optionalText(1000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'RETURN' && (v.comment ?? '').length < 3) {
      ctx.addIssue({ code: 'custom', path: ['comment'], message: 'Say what needs to change.' });
    }
  });

export const changeWithdrawSchema = z
  .object({
    version,
    reason: z
      .string()
      .trim()
      .min(3, 'Say why it is withdrawn.')
      .max(500, 'Keep it under 500 characters.'),
  })
  .strict();

/** The client's decision on the version they were shown (FR-S03, FR-S04). */
export const changeDecisionSchema = z
  .object({
    decision: z.enum(['ACCEPT', 'REJECT'], { message: 'Choose a decision.' }),
    contentHash: z.string().regex(/^[0-9a-f]{64}$/, 'Reload the change and try again.'),
    reason: optionalText(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'REJECT' && (v.reason ?? '').length < 3) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'Tell the team why.' });
    }
  });
export type ChangeDecisionInput = z.input<typeof changeDecisionSchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ChangeSummary {
  id: string;
  number: number;
  reference: string;
  title: string;
  status: ChangeStatus;
  requestedBy: { id: string; name: string; client: boolean };
  /** The latest version's price, excluding tax, if estimated. */
  priceMinor: string | null;
  currency: Currency;
  newDueOn: string | null;
  updatedAt: string;
  version: number;
}

export interface ChangeVersionView {
  id: string;
  versionNo: number;
  status: ChangeVersionStatus;
  scope: string;
  workItems: string[];
  /** Internal only. */
  estimateMinutes: number | null;
  priceMinor: string;
  taxRateBp: number;
  taxMinor: string;
  totalMinor: string;
  currency: Currency;
  newDueOn: string | null;
  contentHash: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  approvedBy: string | null;
  sentAt: string | null;
  createdBy: { id: string; name: string };
  /** Baseline before and after, set when the client accepted it. */
  effect: {
    budgetBeforeMinor: string;
    budgetAfterMinor: string;
    dueBefore: string | null;
  } | null;
  decision: {
    decision: 'ACCEPTED' | 'REJECTED';
    reason: string | null;
    by: string;
    at: string;
  } | null;
}

export interface ChangeDetail extends ChangeSummary {
  projectId: string;
  projectTitle: string;
  description: string;
  justification: string | null;
  withdrawnReason: string | null;
  versions: ChangeVersionView[];
  /** Tasks created from this change when it was accepted. */
  tasks: Array<{ id: string; title: string; status: string }>;
  access: {
    estimate: boolean;
    submit: boolean;
    /** Owner/Admin internal approval of a priced change. */
    review: boolean;
    send: boolean;
    withdraw: boolean;
  };
  /** A priced change needs internal approval before it is sent. */
  needsApproval: boolean;
}

/** The agreed scope: the accepted proposal plus every accepted change (US-12). */
export interface ScopeHistory {
  originalBudgetMinor: string;
  currentBudgetMinor: string;
  currency: Currency;
  changes: Array<{
    id: string;
    reference: string;
    title: string;
    priceMinor: string;
    acceptedAt: string;
    newDueOn: string | null;
  }>;
}

export interface PortalChangeSummary {
  id: string;
  reference: string;
  title: string;
  status: ChangeStatus;
  requestedByYou: boolean;
  priceMinor: string | null;
  totalMinor: string | null;
  currency: Currency;
  updatedAt: string;
}

export interface PortalChangeVersion {
  id: string;
  versionNo: number;
  scope: string;
  workItems: string[];
  priceMinor: string;
  taxRateBp: number;
  taxMinor: string;
  totalMinor: string;
  currency: Currency;
  newDueOn: string | null;
  contentHash: string;
  sentAt: string;
  decision: { decision: 'ACCEPTED' | 'REJECTED'; reason: string | null; at: string } | null;
}

export interface PortalChangeDetail {
  id: string;
  reference: string;
  project: { id: string; title: string; dueOn: string | null };
  title: string;
  description: string;
  justification: string | null;
  status: ChangeStatus;
  requestedByYou: boolean;
  /** Sent versions only, newest first. Internal estimates and drafts are never included. */
  versions: PortalChangeVersion[];
  /** The version awaiting the client's decision, if any. */
  open: PortalChangeVersion | null;
}

// ---------------------------------------------------------------------------
// Tasks outside the original scope (FR-S05)
// ---------------------------------------------------------------------------

export const TASK_SCOPES = ['BASELINE', 'CHANGE', 'EXCEPTION'] as const;
export type TaskScope = (typeof TASK_SCOPES)[number];
export const TASK_SCOPE_LABELS: Record<TaskScope, string> = {
  BASELINE: 'Original scope',
  CHANGE: 'Accepted change',
  EXCEPTION: 'Exception',
};

// ---------------------------------------------------------------------------
// Comments (FR-X08)
// ---------------------------------------------------------------------------

export const COMMENT_ENTITY_TYPES = ['deliverable', 'change'] as const;
export type CommentEntityType = (typeof COMMENT_ENTITY_TYPES)[number];

const commentBody = z
  .string()
  .trim()
  .min(1, 'Write a comment.')
  .max(2000, 'Keep it under 2000 characters.');

export const commentThreadQuerySchema = z
  .object({ entityType: z.enum(COMMENT_ENTITY_TYPES), entityId: uuid })
  .strict();

export const commentCreateSchema = z
  .object({ entityType: z.enum(COMMENT_ENTITY_TYPES), entityId: uuid, body: commentBody })
  .strict();
export type CommentCreateInput = z.input<typeof commentCreateSchema>;

export const commentUpdateSchema = z.object({ version, body: commentBody }).strict();

export interface CommentView {
  id: string;
  author: { id: string; name: string; client: boolean };
  /** Null once deleted; the history keeps the earlier text. */
  body: string | null;
  createdAt: string;
  editedAt: string | null;
  deleted: boolean;
  version: number;
  mine: boolean;
}

export interface CommentRevisionView {
  body: string;
  replacedAt: string;
}
