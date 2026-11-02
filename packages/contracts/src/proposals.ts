// Proposal workflow contracts (M4): service catalog, proposals with immutable versions, internal
// review, client organizations, portal invitations and client decisions.
import { z } from 'zod';
import { CURRENCIES, MAX_AMOUNT_MINOR, parseMoneyToMinor, type Currency } from './money.js';

const uuid = z.uuid({ message: 'Choose an item from the list.' });
const version = z.number().int().positive();
const isoDate = z.iso.date({ message: 'Enter a valid date.' });
const text = (max: number, label: string) =>
  z.string().trim().max(max, `${label} must be ${max} characters or fewer.`);
/** Optional long text: "" is stored as empty (null). */
const optionalText = (max: number, label: string) =>
  text(max, label)
    .nullish()
    .transform((v) => (v === '' || v === null || v === undefined ? null : v));

// ---------------------------------------------------------------------------
// Exact arithmetic (FR-Q03, FR-F10)
// ---------------------------------------------------------------------------

/** Quantities are stored in hundredths: "1.5" → 150. Max 100,000.00. */
export const MAX_QUANTITY_CENTI = 10_000_000;

export function parseQuantityToCenti(input: string): number | null {
  const cleaned = input.trim().replace(/,/g, '');
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const centi = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  if (!Number.isSafeInteger(centi) || centi < 1 || centi > MAX_QUANTITY_CENTI) return null;
  return centi;
}

export function formatQuantity(centi: number): string {
  const whole = Math.floor(centi / 100);
  const rest = centi % 100;
  if (rest === 0) return String(whole);
  return `${whole}.${String(rest).padStart(2, '0').replace(/0$/, '')}`;
}

/** Percent with up to 2 decimals → basis points: "14" → 1400, "12.5" → 1250. 0–100%. */
export function parsePercentToBp(input: string): number | null {
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) return null;
  const bp = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return bp <= 10_000 ? bp : null;
}

export function formatBp(bp: number): string {
  return formatQuantity(bp);
}

/** Rounds a non-negative fraction half up: the rule is shown to users next to each total. */
function divRoundHalfUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator * 2n + denominator) / (denominator * 2n);
}

export interface TotalsInput {
  items: ReadonlyArray<{ quantityCenti: number; unitPriceMinor: string }>;
  discountBp: number;
  taxRateBp: number;
}

export interface ProposalTotals {
  lineTotalsMinor: string[];
  subtotalMinor: string;
  discountMinor: string;
  taxableMinor: string;
  taxMinor: string;
  totalMinor: string;
}

/**
 * Exact proposal totals with BigInt, used by the server (authoritative) and by the editor preview.
 * line = quantity × unit price; discount = subtotal × discount%; tax = (subtotal − discount) × tax%.
 * Each step rounds half up to the minor unit. Prices are tax-exclusive (ADR-028).
 */
export function computeProposalTotals(input: TotalsInput): ProposalTotals {
  const lines = input.items.map((i) =>
    divRoundHalfUp(BigInt(i.quantityCenti) * BigInt(i.unitPriceMinor), 100n),
  );
  const subtotal = lines.reduce((a, b) => a + b, 0n);
  const discount = divRoundHalfUp(subtotal * BigInt(input.discountBp), 10_000n);
  const taxable = subtotal - discount;
  const tax = divRoundHalfUp(taxable * BigInt(input.taxRateBp), 10_000n);
  return {
    lineTotalsMinor: lines.map(String),
    subtotalMinor: subtotal.toString(),
    discountMinor: discount.toString(),
    taxableMinor: taxable.toString(),
    taxMinor: tax.toString(),
    totalMinor: (taxable + tax).toString(),
  };
}

/** Totals above this cannot be stored safely and are rejected before saving. */
export const MAX_PROPOSAL_TOTAL_MINOR = MAX_AMOUNT_MINOR;

// ---------------------------------------------------------------------------
// Service catalog (FR-Q01)
// ---------------------------------------------------------------------------

const moneyField = z
  .string()
  .trim()
  .min(1, 'Enter an amount (0 is allowed).')
  .max(24, 'That amount is too long.')
  .refine((v) => parseMoneyToMinor(v, 'EGP') !== null, {
    message: 'Use a positive number with at most 2 decimals, e.g. 1500 or 1,500.50.',
  });

export const serviceCreateSchema = z
  .object({
    name: text(160, 'Name').min(1, 'Give the service a name.'),
    description: optionalText(2000, 'Description'),
    unit: text(40, 'Unit').min(1, 'Say what you charge per, e.g. hour, page or month.'),
    rate: moneyField,
    currency: z.enum(CURRENCIES, { message: 'Choose a currency.' }),
  })
  .strict();
export type ServiceCreateInput = z.input<typeof serviceCreateSchema>;

export const serviceUpdateSchema = serviceCreateSchema
  .partial()
  .extend({ version })
  .strict()
  .superRefine((v, ctx) => {
    if (v.currency !== undefined && v.rate === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['rate'],
        message: 'Re-enter the rate when changing the currency.',
      });
    }
  });
export type ServiceUpdateInput = z.input<typeof serviceUpdateSchema>;

export interface ServiceSummary {
  id: string;
  name: string;
  description: string | null;
  unit: string;
  rateMinor: string;
  currency: Currency;
  archivedAt: string | null;
  version: number;
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export const PROPOSAL_STATUSES = [
  'DRAFT',
  'IN_REVIEW',
  'APPROVED_INTERNAL',
  'SENT',
  'ACCEPTED',
  'REJECTED',
  'CHANGES_REQUESTED',
  'SUPERSEDED',
] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
/** What people see. EXPIRED is derived from the expiry date of a sent version (FR-Q08). */
export type ProposalDisplayStatus = ProposalStatus | 'EXPIRED';

export const PROPOSAL_STATUS_LABELS: Record<ProposalDisplayStatus, string> = {
  DRAFT: 'Draft',
  IN_REVIEW: 'In review',
  APPROVED_INTERNAL: 'Approved internally',
  SENT: 'Sent to client',
  ACCEPTED: 'Accepted',
  REJECTED: 'Declined',
  CHANGES_REQUESTED: 'Changes requested',
  SUPERSEDED: 'Superseded',
  EXPIRED: 'Expired',
};

export const proposalCreateSchema = z
  .object({
    dealId: uuid,
    title: text(200, 'Title').min(1).optional(),
  })
  .strict();
export type ProposalCreateInput = z.input<typeof proposalCreateSchema>;

export const MAX_PROPOSAL_ITEMS = 100;

export const proposalItemInputSchema = z
  .object({
    serviceId: uuid.nullish(),
    name: text(200, 'Item name').min(1, 'Name every line.'),
    description: optionalText(2000, 'Description'),
    unit: text(40, 'Unit').min(1, 'Add a unit, e.g. hour or page.'),
    quantity: z
      .string()
      .trim()
      .refine((v) => parseQuantityToCenti(v) !== null, {
        message: 'Use a quantity above 0 with at most 2 decimals.',
      }),
    unitPrice: moneyField,
  })
  .strict();
export type ProposalItemInput = z.input<typeof proposalItemInputSchema>;

const percentField = z
  .string()
  .trim()
  .refine((v) => parsePercentToBp(v) !== null, {
    message: 'Use a percentage from 0 to 100 with at most 2 decimals.',
  });

/** Replaces the whole draft content. Only DRAFT versions accept it (FR-Q04). */
export const proposalDraftUpdateSchema = z
  .object({
    version,
    title: text(200, 'Title').min(1, 'Give the proposal a title.'),
    summary: optionalText(5000, 'Summary'),
    inclusions: optionalText(5000, 'Included'),
    exclusions: optionalText(5000, 'Not included'),
    assumptions: optionalText(5000, 'Assumptions'),
    milestones: optionalText(5000, 'Milestones'),
    paymentTerms: optionalText(2000, 'Payment terms'),
    terms: optionalText(10000, 'Terms'),
    internalNotes: optionalText(5000, 'Internal notes'),
    expiresOn: isoDate,
    discountPercent: percentField,
    taxRatePercent: percentField,
    taxLabel: text(40, 'Tax label').min(1, 'Name the tax, e.g. VAT.'),
    items: z
      .array(proposalItemInputSchema)
      .max(MAX_PROPOSAL_ITEMS, `Use at most ${MAX_PROPOSAL_ITEMS} lines.`),
  })
  .strict();
export type ProposalDraftUpdateInput = z.input<typeof proposalDraftUpdateSchema>;

export const proposalVersionActionSchema = z.object({ version }).strict();

export const internalReviewSchema = z
  .object({
    version,
    decision: z.enum(['APPROVE', 'REQUEST_CHANGES'], { message: 'Choose a decision.' }),
    comment: optionalText(2000, 'Comment'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision === 'REQUEST_CHANGES' && (v.comment ?? '').length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message: 'Say what needs to change (at least 3 characters).',
      });
    }
  });
export type InternalReviewInput = z.input<typeof internalReviewSchema>;

export const proposalListQuerySchema = z
  .object({
    status: z.enum(PROPOSAL_STATUSES).optional(),
    dealId: uuid.optional(),
  })
  .strict();

export interface ProposalItemView {
  id: string;
  position: number;
  serviceId: string | null;
  name: string;
  description: string | null;
  unit: string;
  quantity: string;
  quantityCenti: number;
  unitPriceMinor: string;
  lineTotalMinor: string;
}

/** Client-visible content of one version: exactly what the content hash covers. */
export interface ProposalVersionContent {
  versionNo: number;
  title: string;
  summary: string | null;
  inclusions: string | null;
  exclusions: string | null;
  assumptions: string | null;
  milestones: string | null;
  paymentTerms: string | null;
  terms: string | null;
  currency: Currency;
  expiresOn: string;
  discountBp: number;
  taxRateBp: number;
  taxLabel: string;
  items: ProposalItemView[];
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
}

export interface ProposalReviewEntry {
  id: string;
  kind: 'INTERNAL' | 'CLIENT';
  decision: 'SUBMITTED' | 'APPROVED' | 'CHANGES_REQUESTED' | 'SENT' | 'ACCEPTED' | 'REJECTED';
  comment: string | null;
  actor: { id: string; name: string };
  occurredAt: string;
}

export interface ProposalVersionView extends ProposalVersionContent {
  id: string;
  status: ProposalStatus;
  displayStatus: ProposalDisplayStatus;
  /** Staff only (never in the portal view). */
  internalNotes: string | null;
  contentHash: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  decidedAt: string | null;
  version: number;
  reviews: ProposalReviewEntry[];
}

export interface ProposalVersionListItem {
  id: string;
  versionNo: number;
  status: ProposalStatus;
  displayStatus: ProposalDisplayStatus;
  totalMinor: string;
  currency: Currency;
  updatedAt: string;
}

export interface ProposalSummary {
  id: string;
  reference: string;
  title: string;
  status: ProposalStatus;
  displayStatus: ProposalDisplayStatus;
  currentVersionNo: number;
  totalMinor: string;
  currency: Currency;
  expiresOn: string;
  deal: { id: string; title: string; status: 'OPEN' | 'WON' | 'LOST' };
  contact: { id: string; fullName: string; companyName: string | null };
  owner: { id: string; name: string };
  updatedAt: string;
  version: number;
}

export interface ProposalDetail extends ProposalSummary {
  versions: ProposalVersionListItem[];
  /** The version shown by default: the open draft if any, otherwise the latest. */
  current: ProposalVersionView;
  clientOrg: { id: string; name: string; activePortalUsers: number } | null;
}

export function proposalReference(n: number): string {
  return `P-${String(n).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Client organizations and portal users (spec §1.1: CLIENT via invitation)
// ---------------------------------------------------------------------------

export const clientOrgCreateSchema = z
  .object({ name: text(200, 'Organization name').min(1, 'Name the organization.') })
  .strict();

export const portalInviteSchema = z
  .object({
    email: z
      .email({ message: 'Enter a valid email address.' })
      .max(254, 'Email is too long.')
      .transform((v) => v.trim()),
  })
  .strict();

export interface PortalUserSummary {
  id: string;
  name: string;
  email: string;
  active: boolean;
  lastLoginAt: string | null;
  version: number;
}

export interface PortalInvitationSummary {
  id: string;
  email: string;
  status: 'PENDING' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED';
  expiresAt: string;
}

export interface ClientOrgDetail {
  id: string;
  name: string;
  portalUsers: PortalUserSummary[];
  invitations: PortalInvitationSummary[];
}

export interface PortalInvitationCreated {
  invitation: PortalInvitationSummary;
  acceptUrl: string;
  emailDelivery: 'sent_to_dev_sink' | 'disabled';
}

// ---------------------------------------------------------------------------
// Client portal (FR-Q07–Q09, FR-Q11)
// ---------------------------------------------------------------------------

export const CLIENT_DECISIONS = ['ACCEPT', 'REJECT', 'REQUEST_CHANGES'] as const;
export type ClientDecision = (typeof CLIENT_DECISIONS)[number];

export const clientDecisionSchema = z
  .object({
    decision: z.enum(CLIENT_DECISIONS, { message: 'Choose a decision.' }),
    /** The hash of the version the client was shown. A mismatch means the page is out of date. */
    contentHash: z.string().regex(/^[0-9a-f]{64}$/, 'Reload the proposal and try again.'),
    comment: optionalText(2000, 'Comment'),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision !== 'ACCEPT' && (v.comment ?? '').length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['comment'],
        message: 'Tell the team why (at least 3 characters).',
      });
    }
  });
export type ClientDecisionInput = z.input<typeof clientDecisionSchema>;

/** Portal version view: content only, no internal notes, reviews or staff names. */
export interface PortalProposalVersion extends ProposalVersionContent {
  id: string;
  status: ProposalStatus;
  displayStatus: ProposalDisplayStatus;
  contentHash: string;
  sentAt: string;
  decidedAt: string | null;
  decision: {
    decision: 'ACCEPTED' | 'REJECTED' | 'CHANGES_REQUESTED';
    by: string;
    at: string;
    comment: string | null;
  } | null;
}

export interface PortalProposalSummary {
  id: string;
  reference: string;
  title: string;
  versionNo: number;
  displayStatus: ProposalDisplayStatus;
  totalMinor: string;
  currency: Currency;
  expiresOn: string;
  sentAt: string;
}

export interface PortalProposalDetail {
  id: string;
  reference: string;
  agencyName: string;
  clientOrgName: string;
  /** The live version (sent, or the decided one). Older sent versions are listed for reference. */
  current: PortalProposalVersion;
  history: Array<{ versionNo: number; displayStatus: ProposalDisplayStatus; sentAt: string }>;
}

/** Shown next to every acceptance control and on the printed version (FR-Q11, ADR-029). */
export const OPERATIONAL_APPROVAL_NOTICE =
  'Accepting records your operational approval of this version (who, when and exactly which terms). It is not a formal electronic signature.';
