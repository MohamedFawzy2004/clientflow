// M9 contracts: invoice tracking (no payment processing), payments, cost rates and finance views
// (FR-F01 – FR-F10). All money is minor units carried as decimal strings; never floats (FR-F10).
import { z } from 'zod';
import { CURRENCIES, parseMoneyToMinor, type Currency } from './money.js';
import { parsePercentToBp, parseQuantityToCenti } from './proposals.js';

const uuid = z.uuid({ message: 'Choose an item from the list.' });
const version = z.number().int().positive();
const isoDate = z.iso.date({ message: 'Enter a valid date.' });
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Keep it under ${max} characters.`)
    .nullish()
    .transform((v) => (v ? v : null));
const money = z
  .string()
  .trim()
  .min(1, 'Enter an amount.')
  .max(24, 'That amount is too long.')
  .refine((v) => parseMoneyToMinor(v, 'EGP') !== null, {
    message: 'Use a positive number with at most 2 decimals, e.g. 1500 or 1,500.50.',
  });

// ---------------------------------------------------------------------------
// States (spec §9)
// ---------------------------------------------------------------------------

export const INVOICE_STATUSES = ['DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID'] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];
/** OVERDUE is derived (issued or partly paid, past due, balance open), never stored. */
export type InvoiceDisplayStatus = InvoiceStatus | 'OVERDUE';
export const INVOICE_STATUS_LABELS: Record<InvoiceDisplayStatus, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  PARTIALLY_PAID: 'Partly paid',
  PAID: 'Paid',
  VOID: 'Void',
  OVERDUE: 'Overdue',
};

export const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];
export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  BANK_TRANSFER: 'Bank transfer',
  CASH: 'Cash',
  CHEQUE: 'Cheque',
  OTHER: 'Other',
};

export const INVOICE_LINE_SOURCES = ['MILESTONE', 'CHANGE', 'OTHER'] as const;
export type InvoiceLineSource = (typeof INVOICE_LINE_SOURCES)[number];

/** "INV-0007". */
export function invoiceReference(n: number | null) {
  return n === null ? 'Draft' : `INV-${String(n).padStart(4, '0')}`;
}

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const invoiceCreateSchema = z
  .object({
    clientOrgId: uuid,
    /** Optional: an invoice can bill the organization without a project. */
    projectId: uuid.nullish(),
    currency: z.enum(CURRENCIES, { message: 'Choose a currency.' }).optional(),
    dueOn: isoDate,
  })
  .strict();
export type InvoiceCreateInput = z.input<typeof invoiceCreateSchema>;

export const MAX_INVOICE_ITEMS = 100;

export const invoiceItemInputSchema = z
  .object({
    description: z
      .string()
      .trim()
      .min(1, 'Describe every line.')
      .max(500, 'Keep it under 500 characters.'),
    quantity: z
      .string()
      .trim()
      .refine((v) => parseQuantityToCenti(v) !== null, {
        message: 'Use a quantity above 0 with at most 2 decimals.',
      }),
    unitPrice: money,
    source: z.enum(INVOICE_LINE_SOURCES).default('OTHER'),
    sourceId: uuid.nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.source === 'OTHER') !== !v.sourceId) {
      ctx.addIssue({
        code: 'custom',
        path: ['sourceId'],
        message: 'A milestone or change line names what it bills for.',
      });
    }
  });
export type InvoiceItemInput = z.input<typeof invoiceItemInputSchema>;

/** Replaces the whole draft (only drafts accept it). */
export const invoiceDraftSchema = z
  .object({
    version,
    dueOn: isoDate,
    taxRatePercent: z
      .string()
      .trim()
      .refine((v) => parsePercentToBp(v) !== null, {
        message: 'Use a percentage from 0 to 100 with at most 2 decimals.',
      }),
    terms: optionalText(2000),
    internalNote: optionalText(2000),
    items: z
      .array(invoiceItemInputSchema)
      .max(MAX_INVOICE_ITEMS, `At most ${MAX_INVOICE_ITEMS} lines.`),
  })
  .strict();
export type InvoiceDraftInput = z.input<typeof invoiceDraftSchema>;

export const invoiceActionSchema = z.object({ version }).strict();

export const invoiceVoidSchema = z
  .object({
    version,
    reason: z
      .string()
      .trim()
      .min(3, 'Say why it is void.')
      .max(500, 'Keep it under 500 characters.'),
  })
  .strict();

export const invoiceListQuerySchema = z
  .object({
    status: z.enum([...INVOICE_STATUSES, 'OVERDUE'] as const).optional(),
    projectId: uuid.optional(),
  })
  .strict();

/** A confirmed manual payment (FR-F03). The Idempotency-Key header is required (SEC-15). */
export const paymentCreateSchema = z
  .object({
    amount: money,
    receivedOn: isoDate,
    method: z.enum(PAYMENT_METHODS).default('BANK_TRANSFER'),
    reference: z
      .string()
      .trim()
      .max(120, 'Keep it under 120 characters.')
      .refine((v) => !/\d{13,}/.test(v.replace(/[\s-]/g, '')), {
        message: 'Use the bank or receipt reference, never a card number.',
      })
      .nullish()
      .transform((v) => (v ? v : null)),
    note: optionalText(500),
  })
  .strict();
export type PaymentCreateInput = z.input<typeof paymentCreateSchema>;

export const paymentReverseSchema = z
  .object({
    reason: z
      .string()
      .trim()
      .min(3, 'Say why the payment is reversed.')
      .max(500, 'Keep it under 500 characters.'),
  })
  .strict();

export const costRateSchema = z
  .object({
    hourly: money,
    currency: z.enum(CURRENCIES, { message: 'Choose a currency.' }),
    effectiveFrom: isoDate,
  })
  .strict();
export type CostRateInput = z.input<typeof costRateSchema>;

export const financeReportQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    projectId: uuid.optional(),
    managerId: uuid.optional(),
    status: z.enum([...INVOICE_STATUSES, 'OVERDUE'] as const).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.from > v.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end is before the start.' });
    }
  });
export type FinanceReportQuery = z.input<typeof financeReportQuerySchema>;

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface InvoiceSummary {
  id: string;
  reference: string;
  number: number | null;
  status: InvoiceStatus;
  displayStatus: InvoiceDisplayStatus;
  clientOrg: { id: string; name: string };
  project: { id: string; title: string } | null;
  currency: Currency;
  dueOn: string;
  issuedOn: string | null;
  totalMinor: string;
  paidMinor: string;
  balanceMinor: string;
  published: boolean;
  version: number;
}

export interface InvoiceItemView {
  id: string;
  position: number;
  description: string;
  quantity: string;
  quantityCenti: number;
  unitPriceMinor: string;
  lineTotalMinor: string;
  source: InvoiceLineSource;
  sourceId: string | null;
}

export interface PaymentView {
  id: string;
  kind: 'PAYMENT' | 'REVERSAL';
  amountMinor: string;
  receivedOn: string;
  method: PaymentMethod;
  reference: string | null;
  note: string | null;
  recordedBy: string;
  createdAt: string;
  /** For a payment that was reversed: the reversal's id. */
  reversedBy: string | null;
}

export interface InvoiceDetail extends InvoiceSummary {
  taxRateBp: number;
  subtotalMinor: string;
  taxMinor: string;
  terms: string | null;
  /** Staff only. */
  internalNote: string | null;
  billedTo: { name: string; contact: string | null } | null;
  issuer: { name: string; details: string | null } | null;
  items: InvoiceItemView[];
  payments: PaymentView[];
  voidReason: string | null;
  access: {
    edit: boolean;
    issue: boolean;
    publish: boolean;
    void: boolean;
    /** Finance and Owner only (FR-F04). */
    recordPayment: boolean;
  };
}

/** What a project can still bill: milestones and accepted changes (spec J5 step 3). */
export interface BillableItems {
  currency: Currency;
  budgetMinor: string;
  /** Excluding tax, issued (non-void) invoices of this project. */
  invoicedMinor: string;
  milestones: Array<{ id: string; title: string; status: string; invoiced: boolean }>;
  changes: Array<{
    id: string;
    reference: string;
    title: string;
    priceMinor: string;
    invoiced: boolean;
  }>;
}

/**
 * Project money (FR-F05 – FR-F07, US-23). Expected, invoiced and received are kept apart, and
 * the margin is an estimate that says how complete its cost data is.
 */
export interface ProjectFinance {
  currency: Currency;
  /** Agreed budget excluding tax (proposal + accepted changes). */
  expectedMinor: string;
  /** Issued, not void, excluding tax. */
  invoicedMinor: string;
  /** Issued, not void, including tax. */
  invoicedTotalMinor: string;
  /** Cash received (payments minus reversals), including tax. */
  receivedMinor: string;
  outstandingMinor: string;
  cost: {
    /** Minutes × the rate in effect that day, only rates in the project currency. */
    estimatedMinor: string;
    minutesCosted: number;
    minutesTotal: number;
    /** Share of logged minutes that have a usable rate, 0–100. */
    completenessPercent: number;
    /** People whose time has no usable rate (names only, no rates). */
    missingRates: string[];
  };
  /** expected − estimated cost. Labelled an estimate everywhere (FR-F07). */
  estimatedMarginMinor: string;
  /** Owner/Admin/Finance; PMs get the estimate without invoices list access. */
  scope: 'full' | 'estimate';
  billable: BillableItems | null;
}

export interface CostRateView {
  user: { id: string; name: string; role: string };
  current: { hourlyMinor: string; currency: Currency; effectiveFrom: string } | null;
  history: Array<{ hourlyMinor: string; currency: Currency; effectiveFrom: string; setBy: string }>;
}

export interface FinanceTotals {
  currency: Currency;
  invoiced: { count: number; totalMinor: string };
  receivedMinor: string;
  outstandingMinor: string;
  overdue: { count: number; balanceMinor: string };
  /** Open balance by days past due. */
  aging: { current: string; d1to30: string; d31to60: string; d61to90: string; over90: string };
}

export interface FinanceReport {
  /** One block per currency: amounts in different currencies are never added (spec §8.2). */
  totals: FinanceTotals[];
  invoices: InvoiceSummary[];
  filters: { from: string | null; to: string | null };
}

export interface PortalInvoiceSummary {
  id: string;
  reference: string;
  displayStatus: InvoiceDisplayStatus;
  project: { id: string; title: string } | null;
  currency: Currency;
  issuedOn: string;
  dueOn: string;
  totalMinor: string;
  paidMinor: string;
  balanceMinor: string;
}

export interface PortalInvoiceDetail extends PortalInvoiceSummary {
  taxRateBp: number;
  subtotalMinor: string;
  taxMinor: string;
  terms: string | null;
  billedTo: { name: string; contact: string | null };
  issuer: { name: string; details: string | null };
  items: Array<{
    description: string;
    quantity: string;
    unitPriceMinor: string;
    lineTotalMinor: string;
  }>;
  /** Payments received (reversed ones excluded), without internal notes. */
  payments: Array<{ receivedOn: string; amountMinor: string; method: PaymentMethod }>;
}
