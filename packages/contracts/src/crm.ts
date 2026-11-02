// Sales CRM contracts (M3): contact edits, timeline entries, pipelines, deals, follow-ups.
import { z } from 'zod';
import {
  contactCreateSchema,
  CONTACT_SOURCES,
  PAGE_LIMIT_DEFAULT,
  PAGE_LIMIT_MAX,
  PHONE_PATTERN,
} from './base.js';
import type { ActivityItem, ContactDetail, ContactLifecycle, Role } from './base.js';
import { CURRENCIES, parseMoneyToMinor, type Currency } from './money.js';

const uuid = z.uuid({ message: 'Choose an item from the list.' });
const version = z.number().int().positive();
const reason = (label: string) =>
  z
    .string()
    .trim()
    .min(3, `${label} needs at least 3 characters.`)
    .max(500, `${label} must be 500 characters or fewer.`);
/** Optional field in an edit: omitted = unchanged, null or "" = cleared. */
const clearable = <T extends z.ZodType>(schema: T) =>
  z
    .union([z.literal(''), z.null(), schema])
    .optional()
    .transform((v) => (v === '' ? null : v));
const isoInstant = z.iso.datetime({ offset: true, message: 'Enter a valid date and time.' });
const isoDate = z.iso.date({ message: 'Enter a valid date.' });

// ---------------------------------------------------------------------------
// Contacts
// ---------------------------------------------------------------------------

const c = contactCreateSchema.shape;

/** Same rules as contact creation: digits, spaces, dashes or a leading +, 6–15 digits. */
const phoneField = z
  .string()
  .trim()
  .max(30, 'Phone number is too long.')
  .refine((v) => PHONE_PATTERN.test(v), { message: 'Use digits, spaces, dashes or a leading +.' })
  .refine(
    (v) => {
      const digits = v.replace(/\D/g, '').length;
      return digits >= 6 && digits <= 15;
    },
    { message: 'Phone number must contain 6 to 15 digits.' },
  );

/** Edits carry the version the user last saw: stale edits get 409 (FR-D04 pattern). */
export const contactUpdateSchema = z
  .object({
    version,
    fullName: c.fullName.optional(),
    email: clearable(z.email({ message: 'Enter a valid email address.' }).max(254)),
    phone: clearable(phoneField),
    companyName: clearable(z.string().trim().max(200, 'Company must be 200 characters or fewer.')),
    source: clearable(z.enum(CONTACT_SOURCES, { message: 'Choose a source from the list.' })),
    nextActionAt: clearable(isoInstant),
    notes: clearable(z.string().trim().max(5000, 'Notes must be 5000 characters or fewer.')),
  })
  .strict();
export type ContactUpdateInput = z.input<typeof contactUpdateSchema>;

export const versionOnlySchema = z.object({ version }).strict();
export const reassignSchema = z.object({ ownerId: uuid, version }).strict();

export const FOLLOW_UP_FILTERS = ['overdue', 'today', 'upcoming', 'none'] as const;
export type FollowUpFilter = (typeof FOLLOW_UP_FILTERS)[number];

export const contactListFiltersSchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
    q: z.string().trim().max(100).optional(),
    lifecycle: z.enum(['LEAD', 'CUSTOMER']).optional(),
    ownerId: uuid.optional(),
    source: z.enum(CONTACT_SOURCES).optional(),
    followUp: z.enum(FOLLOW_UP_FILTERS).optional(),
    archived: z.enum(['true', 'false']).optional(),
  })
  .strict();
export type ContactListFilters = z.infer<typeof contactListFiltersSchema>;

// ---------------------------------------------------------------------------
// Timeline (FR-C08)
// ---------------------------------------------------------------------------

export const ACTIVITY_KINDS = ['NOTE', 'CALL', 'EMAIL', 'MEETING'] as const;
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
export const ACTIVITY_KIND_LABELS: Record<ActivityKind, string> = {
  NOTE: 'Note',
  CALL: 'Call',
  EMAIL: 'Email',
  MEETING: 'Meeting',
};

export const activityCreateSchema = z
  .object({
    kind: z.enum(ACTIVITY_KINDS, { message: 'Choose what kind of entry this is.' }),
    body: z
      .string()
      .trim()
      .min(1, 'Write something first.')
      .max(5000, 'Keep it under 5000 characters.'),
    /** When the call/meeting happened. Defaults to now; cannot be in the future. */
    occurredAt: isoInstant.optional(),
  })
  .strict();
export type ActivityCreateInput = z.infer<typeof activityCreateSchema>;

// ---------------------------------------------------------------------------
// Pipelines and deals
// ---------------------------------------------------------------------------

export type DealStatus = 'OPEN' | 'WON' | 'LOST';

export interface StageSummary {
  id: string;
  name: string;
  position: number;
}

export interface PipelineSummary {
  id: string;
  name: string;
  stages: StageSummary[];
}

/** Decimal string such as "12500.50", converted to minor units for the given currency. */
const amountField = z
  .string()
  .trim()
  .min(1, 'Enter an amount (0 is allowed).')
  .max(24, 'That amount is too long.');

function checkAmount(
  value: { amount?: string | undefined; currency?: Currency | undefined },
  ctx: z.RefinementCtx,
  fallbackCurrency?: Currency,
) {
  if (value.amount === undefined) return;
  const currency = value.currency ?? fallbackCurrency ?? 'EGP';
  if (parseMoneyToMinor(value.amount, currency) === null) {
    ctx.addIssue({
      code: 'custom',
      path: ['amount'],
      message: 'Use a positive number with at most 2 decimals, e.g. 12500 or 12,500.50.',
    });
  }
}

export const dealCreateSchema = z
  .object({
    contactId: uuid,
    title: z
      .string()
      .trim()
      .min(1, 'Give the deal a name.')
      .max(200, 'Name must be 200 characters or fewer.'),
    amount: amountField,
    currency: z.enum(CURRENCIES, { message: 'Choose a currency.' }),
    stageId: uuid.optional(),
    expectedCloseOn: z
      .union([z.literal(''), isoDate])
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    nextStep: z
      .string()
      .trim()
      .max(300, 'Keep the next step under 300 characters.')
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
    nextStepAt: z
      .union([z.literal(''), isoInstant])
      .optional()
      .transform((v) => (v === '' ? undefined : v)),
  })
  .strict()
  .superRefine((v, ctx) => checkAmount(v, ctx));
export type DealCreateInput = z.input<typeof dealCreateSchema>;

export const dealUpdateSchema = z
  .object({
    version,
    title: z.string().trim().min(1, 'Give the deal a name.').max(200).optional(),
    amount: amountField.optional(),
    currency: z.enum(CURRENCIES).optional(),
    expectedCloseOn: clearable(isoDate),
    nextStep: clearable(z.string().trim().max(300, 'Keep the next step under 300 characters.')),
    nextStepAt: clearable(isoInstant),
  })
  .strict()
  .superRefine((v, ctx) => {
    // Changing the currency alone would silently reinterpret the stored minor units.
    if (v.currency !== undefined && v.amount === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['amount'],
        message: 'Re-enter the amount when changing the currency.',
      });
    }
    checkAmount(v, ctx);
  });
export type DealUpdateInput = z.input<typeof dealUpdateSchema>;

export const dealMoveSchema = z.object({ stageId: uuid, version }).strict();

export const dealCloseSchema = z.discriminatedUnion('outcome', [
  z
    .object({ outcome: z.literal('WON'), version, overrideReason: reason('The reason').optional() })
    .strict(),
  z.object({ outcome: z.literal('LOST'), version, reason: reason('The reason') }).strict(),
]);
export type DealCloseInput = z.infer<typeof dealCloseSchema>;

export const dealReopenSchema = z.object({ version, reason: reason('The reason') }).strict();

export const dealListQuerySchema = z
  .object({
    page: z.coerce.number().int().min(1).max(10_000).default(1),
    limit: z.coerce.number().int().min(1).max(PAGE_LIMIT_MAX).default(PAGE_LIMIT_DEFAULT),
    q: z.string().trim().max(100).optional(),
    status: z.enum(['OPEN', 'WON', 'LOST']).optional(),
    stageId: uuid.optional(),
    ownerId: uuid.optional(),
    contactId: uuid.optional(),
  })
  .strict();
export type DealListQuery = z.infer<typeof dealListQuerySchema>;

export interface DealSummary {
  id: string;
  title: string;
  /** Integer minor units as a decimal string (exact). */
  amountMinor: string;
  currency: Currency;
  status: DealStatus;
  stage: StageSummary;
  contact: { id: string; fullName: string; companyName: string | null };
  owner: { id: string; name: string };
  expectedCloseOn: string | null;
  nextStep: string | null;
  nextStepAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  version: number;
}

export interface DealDetail extends DealSummary {
  lostReason: string | null;
  wonOverrideReason: string | null;
  closedBy: { id: string; name: string } | null;
  /** Set when the deal was won by a client accepting a proposal version (M4). */
  acceptedProposal: { id: string; reference: string; versionNo: number } | null;
  /** The delivery project this deal was handed off to (M6). */
  project: { id: string; title: string } | null;
  activities: TimelineEntry[];
}

export interface BoardColumn extends StageSummary {
  deals: DealSummary[];
  /** Open deal count in this stage (may exceed the deals returned). */
  count: number;
  /** Totals per currency, never added across currencies. */
  totals: Partial<Record<Currency, string>>;
}

export interface DealBoard {
  pipeline: { id: string; name: string };
  columns: BoardColumn[];
}

// ---------------------------------------------------------------------------
// Timeline entries, owners, follow-ups
// ---------------------------------------------------------------------------

export type TimelineEntry = ActivityItem;

/** Contact detail with the deals the viewer may see (scoped separately from the contact). */
export interface ContactWithDeals extends ContactDetail {
  /** The customer organization whose portal users receive proposals (M4). */
  clientOrg: { id: string; name: string } | null;
  deals: DealSummary[];
}

export interface AssignableUser {
  id: string;
  name: string;
  role: Role;
}

export interface FollowUpItem {
  type: 'contact' | 'deal';
  id: string;
  title: string;
  subtitle: string | null;
  dueAt: string | null;
  owner: { id: string; name: string };
  lifecycle?: ContactLifecycle;
}

export interface FollowUpQueue {
  overdue: FollowUpItem[];
  today: FollowUpItem[];
  upcoming: FollowUpItem[];
  /** Open deals and active leads with no scheduled next step (FR-D07). */
  noNextStep: FollowUpItem[];
  counts: { overdue: number; today: number; upcoming: number; noNextStep: number };
}
