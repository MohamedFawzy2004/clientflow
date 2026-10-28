// M10: notifications (FR-X09), background jobs (FR-A02) and CSV imports (FR-C10).
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

export const NOTIFICATION_CATEGORIES = [
  'CLIENT_ACTIVITY',
  'APPROVALS',
  'TASKS',
  'FOLLOW_UPS',
  'INVOICES',
] as const;
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number];

export const NOTIFICATION_CATEGORY_INFO: Record<
  NotificationCategory,
  { label: string; description: string; defaults: { inApp: boolean; email: boolean } }
> = {
  CLIENT_ACTIVITY: {
    label: 'Client activity',
    description:
      'A client requested or decided on a change, reviewed a deliverable or proposal, or commented. Also items waiting on a client for more than 3 days.',
    defaults: { inApp: true, email: true },
  },
  APPROVALS: {
    label: 'Approvals',
    description:
      'A proposal or change is waiting for your approval, or your submission was approved or sent back.',
    defaults: { inApp: true, email: false },
  },
  TASKS: {
    label: 'Tasks',
    description: 'A task was assigned to you, or one of your tasks is due today or overdue.',
    defaults: { inApp: true, email: false },
  },
  FOLLOW_UPS: {
    label: 'Follow-ups',
    description:
      'A follow-up or next step you own is overdue, or a proposal you sent expires within 3 days.',
    defaults: { inApp: true, email: false },
  },
  INVOICES: {
    label: 'Invoices',
    description: 'An issued invoice passed its due date with a balance left.',
    defaults: { inApp: true, email: false },
  },
};

export interface NotificationView {
  id: string;
  category: NotificationCategory;
  type: string;
  title: string;
  /** App path, always starting with /app/. */
  link: string;
  createdAt: string;
  readAt: string | null;
}

export interface NotificationPage {
  items: NotificationView[];
  unreadCount: number;
  /** Pass as `before` to load older items; null at the end. */
  nextCursor: string | null;
}

export const notificationListQuerySchema = z
  .object({
    unread: z.enum(['true', 'false']).optional(),
    /** ISO timestamp of the oldest item already loaded. */
    before: z.iso.datetime({ offset: true }).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict();

export const notificationReadAllSchema = z
  .object({
    /** Only items created at or before this instant: a notification that arrives meanwhile stays unread. */
    upTo: z.iso.datetime({ offset: true, message: 'Send the time the list was loaded.' }),
  })
  .strict();

export interface NotificationPreferenceView {
  category: NotificationCategory;
  label: string;
  description: string;
  inApp: boolean;
  email: boolean;
}

export const notificationPreferencesSchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            category: z.enum(NOTIFICATION_CATEGORIES, { message: 'Choose a category.' }),
            inApp: z.boolean(),
            email: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(NOTIFICATION_CATEGORIES.length)
      .refine((list) => new Set(list.map((p) => p.category)).size === list.length, {
        message: 'Each category can appear once.',
      }),
  })
  .strict();
export type NotificationPreferencesInput = z.input<typeof notificationPreferencesSchema>;

// ---------------------------------------------------------------------------
// Background jobs (Owner/Admin health view)
// ---------------------------------------------------------------------------

export interface JobSummary {
  counts: { pending: number; running: number; done: number; dead: number };
  /** Newest failed-for-good jobs. Errors are short and carry no personal data. */
  dead: Array<{
    id: string;
    kind: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
    finishedAt: string | null;
  }>;
  /** When the worker last finished a reminder scan, or null if it has not run yet. */
  lastReminderScanAt: string | null;
}

// ---------------------------------------------------------------------------
// CSV imports
// ---------------------------------------------------------------------------

export const IMPORT_KINDS = ['contacts', 'deals'] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];

/** Limits that keep an import small enough to check by eye and to run in one transaction. */
export const IMPORT_MAX_BYTES = 1_000_000;
export const IMPORT_MAX_ROWS = 2000;
export const IMPORT_MAX_COLUMNS = 40;

export const IMPORT_FIELDS = {
  contacts: [
    { key: 'fullName', label: 'Name', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'companyName', label: 'Company', required: false },
    { key: 'source', label: 'Source', required: false },
    { key: 'lifecycle', label: 'Lead or customer', required: false },
    { key: 'nextActionAt', label: 'Next follow-up', required: false },
    { key: 'notes', label: 'Notes', required: false },
    { key: 'ownerEmail', label: 'Owner email', required: false },
  ],
  deals: [
    { key: 'title', label: 'Deal name', required: true },
    { key: 'contactEmail', label: 'Contact email', required: true },
    { key: 'amount', label: 'Value', required: false },
    { key: 'currency', label: 'Currency', required: false },
    { key: 'stage', label: 'Stage', required: false },
    { key: 'expectedCloseOn', label: 'Expected close', required: false },
    { key: 'nextStep', label: 'Next step', required: false },
    { key: 'nextStepAt', label: 'Next step date', required: false },
    { key: 'ownerEmail', label: 'Owner email', required: false },
  ],
} as const satisfies Record<
  ImportKind,
  ReadonlyArray<{ key: string; label: string; required: boolean }>
>;

export type ImportField<K extends ImportKind = ImportKind> =
  (typeof IMPORT_FIELDS)[K][number]['key'];

/** Field → column header in the file (or null = not imported). */
const mappingSchema = z.record(z.string().max(60), z.string().max(200).nullable());

export const importPreviewSchema = z
  .object({
    kind: z.enum(IMPORT_KINDS, { message: 'Choose what to import.' }),
    filename: z.string().trim().max(200).optional(),
    csv: z
      .string()
      .min(1, 'The file is empty.')
      .max(IMPORT_MAX_BYTES, 'The file is larger than 1 MB. Split it into smaller files.'),
    /** Omitted on the first preview: the server suggests a mapping from the headers. */
    mapping: mappingSchema.optional(),
  })
  .strict();
export type ImportPreviewInput = z.input<typeof importPreviewSchema>;

export const importCommitSchema = importPreviewSchema
  .extend({
    mapping: mappingSchema,
    /** Rows that match an existing record: skip them (default) or create them anyway. */
    duplicates: z.enum(['skip', 'create']).default('skip'),
    /** Hash from the preview: the server refuses to import a different file than the one shown. */
    fileSha256: z.string().regex(/^[0-9a-f]{64}$/, 'Preview the file again before importing.'),
  })
  .strict();
export type ImportCommitInput = z.input<typeof importCommitSchema>;

export type ImportRowStatus = 'ready' | 'duplicate' | 'error';

export interface ImportPreviewRow {
  /** Line number in the file (the header is line 1). */
  line: number;
  status: ImportRowStatus;
  /** The mapped values as text, for display. */
  values: Record<string, string>;
  /** Field → messages. */
  errors: Record<string, string[]>;
  /** What the row duplicates: an existing record or an earlier line of the file. */
  duplicateOf:
    { kind: 'existing'; id: string; label: string } | { kind: 'line'; line: number } | null;
}

export interface ImportPreview {
  kind: ImportKind;
  fileSha256: string;
  headers: string[];
  mapping: Record<string, string | null>;
  rows: ImportPreviewRow[];
  counts: { total: number; ready: number; duplicate: number; error: number };
  /** Problems with the file as a whole (missing required column, …). Import is blocked while set. */
  fileErrors: string[];
}

export interface ImportRunView {
  id: string;
  kind: ImportKind;
  filename: string | null;
  actor: { id: string; name: string };
  rowsTotal: number;
  rowsCreated: number;
  rowsSkipped: number;
  rowsFailed: number;
  createdAt: string;
  undoneAt: string | null;
}

export interface ImportCommitResult {
  run: ImportRunView;
  /** Lines that were not imported and why (errors, and duplicates when skipped). */
  notImported: Array<{ line: number; reason: string }>;
  replayed: boolean;
}

export interface ImportUndoResult {
  run: ImportRunView;
  archived: number;
  /** Records changed since the import are left as they are. */
  keptChanged: number;
}
