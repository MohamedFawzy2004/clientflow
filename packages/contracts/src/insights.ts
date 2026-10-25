// M5 contracts: sales dashboard, reminders and agency settings.
import { z } from 'zod';
import { CURRENCIES, type Currency } from './money.js';

const isoDate = z.iso.date({ message: 'Enter a valid date.' });

// ---------------------------------------------------------------------------
// Dashboard (FR-F08, US-15, T-ACL-05)
// ---------------------------------------------------------------------------

export const dashboardQuerySchema = z
  .object({
    /** Inclusive agency-local dates. Defaults: first day of this month → today. */
    from: isoDate.optional(),
    to: isoDate.optional(),
    /** Managers only: narrow every number to one owner. */
    ownerId: z.uuid({ message: 'Choose an owner from the list.' }).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.from && v.to && v.from > v.to) {
      ctx.addIssue({ code: 'custom', path: ['to'], message: 'The end date is before the start.' });
    }
  });
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

export type MoneyTotals = Partial<Record<Currency, string>>;

export interface OwnerRow {
  owner: { id: string; name: string };
  openDeals: number;
  openTotals: MoneyTotals;
  won: number;
  wonTotals: MoneyTotals;
}

export interface SalesDashboard {
  range: { from: string; to: string; timeZone: string };
  /** The owner every number is narrowed to, if any (always the viewer for SALES). */
  owner: { id: string; name: string } | null;
  pipeline: { openDeals: number; totals: MoneyTotals };
  won: { count: number; totals: MoneyTotals };
  lost: { count: number };
  /** Won ÷ (won + lost) closed in the range, as a whole percent; null when nothing closed. */
  winRatePercent: number | null;
  newLeads: number;
  proposals: {
    inReview: number;
    awaitingClient: number;
    expiringIn7Days: number;
    accepted: number;
    acceptedTotals: MoneyTotals;
  };
  followUps: { overdue: number; dueToday: number };
  /** Managers only. */
  byOwner: OwnerRow[] | null;
}

// ---------------------------------------------------------------------------
// Reminders (FR-A01)
// ---------------------------------------------------------------------------

export const REMINDER_KINDS = [
  'follow_up_overdue',
  'follow_up_today',
  'proposal_review',
  'proposal_changes',
  'proposal_expiring',
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export interface Reminder {
  kind: ReminderKind;
  id: string;
  title: string;
  detail: string;
  href: string;
  dueAt: string | null;
}

export interface ReminderList {
  items: Reminder[];
  /** The list is capped; this is the full count. */
  total: number;
}

// ---------------------------------------------------------------------------
// Agency settings (FR-I09)
// ---------------------------------------------------------------------------

export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

/** True when the runtime knows this IANA zone (e.g. Africa/Cairo). */
export function isValidTimeZone(tz: string): boolean {
  if (!/^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+){0,2}$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-GB', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

const optional = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} must be ${max} characters or fewer.`)
    .nullish()
    .transform((v) => (v === '' || v === null || v === undefined ? null : v));

export const agencySettingsSchema = z
  .object({
    version: z.number().int().positive(),
    name: z.string().trim().min(1, 'Enter the agency name.').max(200),
    // Trimmed and lower-cased before validation, so pasted addresses with spaces still pass.
    contactEmail: z
      .union([
        z.null(),
        z
          .string()
          .trim()
          .toLowerCase()
          .pipe(
            z.union([z.literal(''), z.email({ message: 'Enter a valid email address.' }).max(254)]),
          ),
      ])
      .optional()
      .transform((v) => (v ? v : null)),
    phone: optional(40, 'Phone'),
    address: optional(500, 'Address'),
    defaultCurrency: z.enum(CURRENCIES, { message: 'Choose a currency.' }),
    timeZone: z
      .string()
      .trim()
      .refine(isValidTimeZone, { message: 'Use a time zone name such as Africa/Cairo.' }),
    workingDays: z
      .array(z.number().int().min(0).max(6))
      .min(1, 'Pick at least one working day.')
      .max(7)
      .transform((days) => [...new Set(days)].sort((a, b) => a - b)),
  })
  .strict();
export type AgencySettingsInput = z.input<typeof agencySettingsSchema>;

export interface AgencySettings {
  id: string;
  name: string;
  contactEmail: string | null;
  phone: string | null;
  address: string | null;
  defaultCurrency: Currency;
  timeZone: string;
  workingDays: number[];
  version: number;
}
