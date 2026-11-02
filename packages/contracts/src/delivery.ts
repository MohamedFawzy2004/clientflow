// M7 contracts: tasks, time entries, private files, deliverables and the client portal for projects.
import { z } from 'zod';
import type { MilestoneStatus, ProjectState } from './projects.js';

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
/** Optional link that can be cleared with null. */
const clearableUuid = z.union([z.null(), uuid]).optional();

// ---------------------------------------------------------------------------
// Tasks (FR-P05 – FR-P07, FR-P09)
// ---------------------------------------------------------------------------

export const TASK_STATUSES = [
  'TODO',
  'IN_PROGRESS',
  'BLOCKED',
  'IN_REVIEW',
  'DONE',
  'CANCELED',
] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_STATUS_LABELS: Record<TaskStatus, string> = {
  TODO: 'To do',
  IN_PROGRESS: 'In progress',
  BLOCKED: 'Blocked',
  IN_REVIEW: 'In review',
  DONE: 'Done',
  CANCELED: 'Canceled',
};

/** Board columns. Canceled tasks are listed separately. */
export const BOARD_STATUSES = ['TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE'] as const;

/** Statuses an assignee may set on their own task. Canceling is the project manager's call. */
export const ASSIGNEE_STATUSES: readonly TaskStatus[] = BOARD_STATUSES;

export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];
export const TASK_PRIORITY_LABELS: Record<TaskPriority, string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
  URGENT: 'Urgent',
};

/** Up to 10,000 hours, in whole minutes. */
export const MAX_ESTIMATE_MINUTES = 600_000;
const estimateMinutes = z
  .number({ message: 'Enter the estimate in hours.' })
  .int()
  .min(0, 'The estimate cannot be negative.')
  .max(MAX_ESTIMATE_MINUTES, 'Keep the estimate under 10,000 hours.');

export const taskCreateSchema = z
  .object({
    title,
    description: optionalText(5000),
    assigneeId: uuid.nullish(),
    milestoneId: uuid.nullish(),
    dueOn: isoDate.nullish(),
    priority: z.enum(TASK_PRIORITIES).default('MEDIUM'),
    estimateMinutes: estimateMinutes.nullish(),
  })
  .strict();
export type TaskCreateInput = z.input<typeof taskCreateSchema>;

export const taskUpdateSchema = z
  .object({
    version,
    title: title.optional(),
    description: optionalText(5000).optional(),
    assigneeId: clearableUuid,
    milestoneId: clearableUuid,
    dueOn: clearableDate,
    priority: z.enum(TASK_PRIORITIES).optional(),
    estimateMinutes: z.union([z.null(), estimateMinutes]).optional(),
  })
  .strict();
export type TaskUpdateInput = z.input<typeof taskUpdateSchema>;

export const taskStatusSchema = z
  .object({ version, status: z.enum(TASK_STATUSES, { message: 'Choose a status.' }) })
  .strict();

export const taskDependencySchema = z.object({ dependsOnId: uuid }).strict();

export const taskListQuerySchema = z
  .object({
    assignee: z.enum(['me']).optional(),
    status: z.enum(TASK_STATUSES).optional(),
  })
  .strict();

export interface TaskLink {
  id: string;
  title: string;
  status: TaskStatus;
}

export interface TaskView {
  id: string;
  projectId: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  assignee: { id: string; name: string } | null;
  milestone: { id: string; title: string } | null;
  dueOn: string | null;
  /** Past due and not done or canceled (agency timezone). */
  overdue: boolean;
  estimateMinutes: number | null;
  loggedMinutes: number;
  /** Tasks this one waits for that are not done or canceled yet. */
  openBlockers: TaskLink[];
  completedAt: string | null;
  updatedAt: string;
  version: number;
  /** What the viewer may do (the API checks again on every request). */
  access: { edit: boolean; status: boolean; logTime: boolean };
}

export interface TaskDetail extends TaskView {
  project: { id: string; title: string };
  blockedBy: TaskLink[];
  blocking: TaskLink[];
  /** All entries for the project manager; only the viewer's own entries for everyone else. */
  timeEntries: TimeEntryView[];
  createdBy: { id: string; name: string };
  createdAt: string;
}

export interface TaskBoard {
  tasks: TaskView[];
  /** People the task can be assigned to: the project manager and members. */
  assignees: Array<{ id: string; name: string }>;
  access: { create: boolean };
}

// ---------------------------------------------------------------------------
// Time entries (FR-P08)
// ---------------------------------------------------------------------------

export const MAX_ENTRY_MINUTES = 24 * 60;
const minutes = z
  .number({ message: 'Enter the time spent.' })
  .int('Use whole minutes.')
  .min(1, 'Log at least one minute.')
  .max(MAX_ENTRY_MINUTES, 'One entry can be at most 24 hours. Split longer work by day.');

export const timeEntryCreateSchema = z
  .object({
    workedOn: isoDate,
    minutes,
    billable: z.boolean().default(true),
    note: optionalText(1000),
  })
  .strict();
export type TimeEntryCreateInput = z.input<typeof timeEntryCreateSchema>;

export const timeEntryUpdateSchema = z
  .object({
    version,
    workedOn: isoDate.optional(),
    minutes: minutes.optional(),
    billable: z.boolean().optional(),
    note: optionalText(1000).optional(),
  })
  .strict();
export type TimeEntryUpdateInput = z.input<typeof timeEntryUpdateSchema>;

export interface TimeEntryView {
  id: string;
  task: { id: string; title: string };
  user: { id: string; name: string };
  workedOn: string;
  minutes: number;
  billable: boolean;
  note: string | null;
  version: number;
  /** The viewer wrote it, so they may change or delete it. */
  mine: boolean;
}

export interface ProjectTime {
  /** `all` for the project manager, Owner and Admin; `own` for everyone else. */
  scope: 'all' | 'own';
  totals: { minutes: number; billableMinutes: number };
  byPerson: Array<{ user: { id: string; name: string }; minutes: number; billableMinutes: number }>;
  entries: TimeEntryView[];
}

/** "90" → "1h 30m". */
export function formatMinutes(total: number): string {
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

// ---------------------------------------------------------------------------
// Files (FR-X05 – FR-X07, SEC-12, SEC-13)
// ---------------------------------------------------------------------------

/**
 * Allowed uploads by extension. The server decides the content type from this table and checks
 * the file's signature; HTML, SVG, scripts and executables are never accepted (FR-X07).
 */
export const FILE_TYPES = {
  pdf: { mime: 'application/pdf', label: 'PDF' },
  png: { mime: 'image/png', label: 'PNG image' },
  jpg: { mime: 'image/jpeg', label: 'JPEG image' },
  jpeg: { mime: 'image/jpeg', label: 'JPEG image' },
  webp: { mime: 'image/webp', label: 'WebP image' },
  gif: { mime: 'image/gif', label: 'GIF image' },
  docx: {
    mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    label: 'Word document',
  },
  xlsx: {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    label: 'Excel workbook',
  },
  pptx: {
    mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    label: 'PowerPoint deck',
  },
  zip: { mime: 'application/zip', label: 'ZIP archive' },
  txt: { mime: 'text/plain', label: 'Text file' },
  csv: { mime: 'text/csv', label: 'CSV file' },
  md: { mime: 'text/markdown', label: 'Markdown file' },
} as const;
export type FileExtension = keyof typeof FILE_TYPES;
export const FILE_EXTENSIONS = Object.keys(FILE_TYPES) as FileExtension[];
export const DEFAULT_FILE_MAX_BYTES = 25 * 1024 * 1024;

export function fileExtension(name: string): string {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function isAllowedExtension(ext: string): ext is FileExtension {
  return Object.hasOwn(FILE_TYPES, ext);
}

/** "2621440" → "2.5 MB". */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1).replace(/\.0$/, '')} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1).replace(/\.0$/, '')} MB`;
}

export const FILE_SCAN_STATUSES = ['PENDING', 'CLEAN', 'QUARANTINED'] as const;
export type FileScanStatus = (typeof FILE_SCAN_STATUSES)[number];

export interface FileView {
  id: string;
  name: string;
  extension: string;
  sizeBytes: number;
  sha256: string;
  scanStatus: FileScanStatus;
  uploadedBy: { id: string; name: string };
  createdAt: string;
  /** The deliverable version that uses this file, if any. */
  usedIn: { deliverableId: string; title: string; versionNo: number } | null;
  access: { delete: boolean };
}

export interface FileList {
  files: FileView[];
  limits: { maxBytes: number; extensions: string[] };
  access: { upload: boolean };
}

/** A download link: bound to the signed-in user and checked again when used (SEC-13). */
export interface DownloadLink {
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Deliverables and client decisions (FR-S06 – FR-S10)
// ---------------------------------------------------------------------------

export const DELIVERABLE_STATUSES = [
  'DRAFT',
  'READY',
  'PUBLISHED',
  'REVISION_REQUESTED',
  'APPROVED',
  'ARCHIVED',
] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  DRAFT: 'Draft',
  READY: 'Ready to publish',
  PUBLISHED: 'Waiting for client',
  REVISION_REQUESTED: 'Revision requested',
  APPROVED: 'Approved',
  ARCHIVED: 'Archived',
};

export const DELIVERABLE_DECISIONS = ['APPROVED', 'REVISION_REQUESTED', 'REJECTED'] as const;
export type DeliverableDecision = (typeof DELIVERABLE_DECISIONS)[number];
export const DELIVERABLE_DECISION_LABELS: Record<DeliverableDecision, string> = {
  APPROVED: 'Approved',
  REVISION_REQUESTED: 'Revision requested',
  REJECTED: 'Rejected',
};

export const deliverableCreateSchema = z
  .object({
    title,
    description: optionalText(2000),
    milestoneId: uuid.nullish(),
    reviewDueOn: isoDate.nullish(),
  })
  .strict();
export type DeliverableCreateInput = z.input<typeof deliverableCreateSchema>;

export const deliverableUpdateSchema = z
  .object({
    version,
    title: title.optional(),
    description: optionalText(2000).optional(),
    milestoneId: clearableUuid,
    reviewDueOn: clearableDate,
  })
  .strict();
export type DeliverableUpdateInput = z.input<typeof deliverableUpdateSchema>;

export const deliverableVersionSchema = z
  .object({ fileId: uuid, note: optionalText(2000) })
  .strict();
export type DeliverableVersionInput = z.input<typeof deliverableVersionSchema>;

/** The client's decision on the latest published version (FR-S07). */
export const PORTAL_DELIVERABLE_DECISIONS = ['APPROVE', 'REQUEST_REVISION', 'REJECT'] as const;
export const deliverableDecisionSchema = z
  .object({
    /** The version the client looked at. Anything but the latest published one is refused. */
    versionId: uuid,
    decision: z.enum(PORTAL_DELIVERABLE_DECISIONS, { message: 'Choose a decision.' }),
    reason: optionalText(2000),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.decision !== 'APPROVE' && (v.reason ?? '').length < 3) {
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: 'Tell the team what should change.',
      });
    }
  });
export type DeliverableDecisionInput = z.input<typeof deliverableDecisionSchema>;

export interface DeliverableReviewView {
  decision: DeliverableDecision;
  reason: string | null;
  by: string;
  at: string;
}

export interface DeliverableVersionView {
  id: string;
  versionNo: number;
  note: string | null;
  file: {
    id: string;
    name: string;
    extension: string;
    sizeBytes: number;
    scanStatus: FileScanStatus;
  };
  createdBy: { id: string; name: string };
  createdAt: string;
  publishedAt: string | null;
  review: DeliverableReviewView | null;
}

export interface DeliverableSummary {
  id: string;
  title: string;
  status: DeliverableStatus;
  milestone: { id: string; title: string } | null;
  reviewDueOn: string | null;
  /** Waiting for the client past the review due date. Silence never approves (FR-S10). */
  overdue: boolean;
  currentVersionNo: number;
  publishedVersionNo: number | null;
  updatedAt: string;
  version: number;
}

export interface DeliverableDetail extends DeliverableSummary {
  projectId: string;
  description: string | null;
  versions: DeliverableVersionView[];
  access: { edit: boolean; publish: boolean };
}

// ---------------------------------------------------------------------------
// Portal sharing and milestone order
// ---------------------------------------------------------------------------

export const projectShareSchema = z.object({ userId: uuid }).strict();

export interface ProjectShareView {
  user: { id: string; name: string; email: string; active: boolean };
  shared: boolean;
  sharedAt: string | null;
}

export interface ProjectShares {
  clientOrg: { id: string; name: string } | null;
  people: ProjectShareView[];
}

export const milestoneMoveSchema = z.object({ direction: z.enum(['up', 'down']) }).strict();

// ---------------------------------------------------------------------------
// Client portal (FR-X01 – FR-X04): published content only, no internal fields
// ---------------------------------------------------------------------------

/** What the client sees: "waiting for your review" or the outcome of their latest decision. */
export const PORTAL_DELIVERABLE_STATES = [
  'AWAITING_REVIEW',
  'CHANGES_REQUESTED',
  'APPROVED',
] as const;
export type PortalDeliverableState = (typeof PORTAL_DELIVERABLE_STATES)[number];
export const PORTAL_DELIVERABLE_STATE_LABELS: Record<PortalDeliverableState, string> = {
  AWAITING_REVIEW: 'Waiting for your review',
  CHANGES_REQUESTED: 'Changes requested',
  APPROVED: 'Approved',
};

export interface PortalProjectSummary {
  id: string;
  title: string;
  state: ProjectState;
  startOn: string | null;
  dueOn: string | null;
  milestones: { total: number; done: number };
  awaitingReview: number;
}

export interface PortalDeliverableSummary {
  id: string;
  title: string;
  state: PortalDeliverableState;
  versionNo: number;
  publishedAt: string;
  reviewDueOn: string | null;
  overdue: boolean;
}

export interface PortalProjectDetail extends PortalProjectSummary {
  agencyName: string;
  milestoneList: Array<{ title: string; dueOn: string | null; status: MilestoneStatus }>;
  deliverables: PortalDeliverableSummary[];
}

export interface PortalDeliverableVersion {
  id: string;
  versionNo: number;
  note: string | null;
  publishedAt: string;
  file: { id: string; name: string; extension: string; sizeBytes: number };
  review: { decision: DeliverableDecision; reason: string | null; at: string } | null;
}

export interface PortalDeliverableDetail {
  id: string;
  project: { id: string; title: string };
  title: string;
  description: string | null;
  state: PortalDeliverableState;
  reviewDueOn: string | null;
  overdue: boolean;
  /** Newest first. Only published versions. */
  versions: PortalDeliverableVersion[];
  /** The version a decision applies to, when one is open. */
  openVersionId: string | null;
}
