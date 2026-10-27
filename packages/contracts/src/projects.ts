// M6 contracts: won-deal handoff, projects, members, milestones and the handoff checklist.
import { z } from 'zod';
import type { TimelineEntry } from './crm.js';
import { CURRENCIES, parseMoneyToMinor, type Currency } from './money.js';
import type { ScopeHistory } from './changes.js';
import type { ProposalItemView } from './proposals.js';

const uuid = z.uuid({ message: 'Choose an item from the list.' });
const version = z.number().int().positive();
const isoDate = z.iso.date({ message: 'Enter a valid date.' });
const clearableDate = z
  .union([z.literal(''), z.null(), isoDate])
  .optional()
  .transform((v) => (v === '' ? null : v));
const title = z.string().trim().min(1, 'Give it a name.').max(200, 'Keep it under 200 characters.');

function datesInOrder(v: { startOn?: string | null; dueOn?: string | null }, ctx: z.RefinementCtx) {
  if (v.startOn && v.dueOn && v.startOn > v.dueOn) {
    ctx.addIssue({
      code: 'custom',
      path: ['dueOn'],
      message: 'The due date is before the start date.',
    });
  }
}

// ---------------------------------------------------------------------------
// States (FR-P03)
// ---------------------------------------------------------------------------

export const PROJECT_STATES = ['PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED'] as const;
export type ProjectState = (typeof PROJECT_STATES)[number];

export const PROJECT_STATE_LABELS: Record<ProjectState, string> = {
  PLANNED: 'Planned',
  ACTIVE: 'Active',
  ON_HOLD: 'On hold',
  COMPLETED: 'Completed',
  ARCHIVED: 'Archived',
};

/** Allowed moves. ARCHIVED is final: archived projects stay in history, read-only (FR-P11). */
export const PROJECT_TRANSITIONS: Record<ProjectState, readonly ProjectState[]> = {
  PLANNED: ['ACTIVE', 'ON_HOLD', 'ARCHIVED'],
  ACTIVE: ['ON_HOLD', 'COMPLETED'],
  ON_HOLD: ['ACTIVE', 'ARCHIVED'],
  COMPLETED: ['ACTIVE', 'ARCHIVED'],
  ARCHIVED: [],
};

export const MILESTONE_STATUSES = ['PLANNED', 'IN_PROGRESS', 'DONE'] as const;
export type MilestoneStatus = (typeof MILESTONE_STATUSES)[number];
export const MILESTONE_STATUS_LABELS: Record<MilestoneStatus, string> = {
  PLANNED: 'Planned',
  IN_PROGRESS: 'In progress',
  DONE: 'Done',
};

/** The handoff checklist every project starts with (spec J3). Never store credentials here. */
export const DEFAULT_HANDOFF_CHECKLIST = [
  'Kick-off meeting scheduled with the client',
  'Client contacts and decision maker confirmed',
  'Scope, exclusions and assumptions reviewed with the team',
  'Milestone dates confirmed',
  'Access requested through a secure channel (never in ClientFlow notes)',
] as const;

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

/** POST /deals/:id/convert-to-project. The Idempotency-Key header is required (spec §11.6). */
export const convertDealSchema = z
  .object({
    managerId: uuid,
    title: title.optional(),
    startOn: isoDate.optional(),
    dueOn: isoDate.optional(),
  })
  .strict()
  .superRefine(datesInOrder);
export type ConvertDealInput = z.input<typeof convertDealSchema>;

export const idempotencyKeySchema = z.uuid({
  message: 'Send an Idempotency-Key header with a UUID, so a retry cannot create a second project.',
});

/** Manual project without a deal (FR-P01: Owner, Admin and PM only). */
export const projectCreateSchema = z
  .object({
    title,
    managerId: uuid,
    startOn: isoDate.optional(),
    dueOn: isoDate.optional(),
    budget: z.string().trim().max(24).optional(),
    currency: z.enum(CURRENCIES, { message: 'Choose a currency.' }),
  })
  .strict()
  .superRefine((v, ctx) => {
    datesInOrder(v, ctx);
    if (v.budget && parseMoneyToMinor(v.budget, v.currency) === null) {
      ctx.addIssue({
        code: 'custom',
        path: ['budget'],
        message: 'Use a positive amount with at most 2 decimals.',
      });
    }
  });
export type ProjectCreateInput = z.input<typeof projectCreateSchema>;

export const projectUpdateSchema = z
  .object({
    version,
    title: title.optional(),
    managerId: uuid.optional(),
    /** Only for projects without a deal; a handed-off project keeps the proposal's client. */
    clientOrgId: z.union([z.null(), uuid]).optional(),
    startOn: clearableDate,
    dueOn: clearableDate,
  })
  .strict()
  .superRefine(datesInOrder);
export type ProjectUpdateInput = z.input<typeof projectUpdateSchema>;

export const projectStateSchema = z
  .object({ version, state: z.enum(PROJECT_STATES, { message: 'Choose a state.' }) })
  .strict();

export const projectMemberSchema = z.object({ userId: uuid }).strict();

export const milestoneCreateSchema = z.object({ title, dueOn: isoDate.optional() }).strict();
export const milestoneUpdateSchema = z
  .object({
    version,
    title: title.optional(),
    dueOn: clearableDate,
    status: z.enum(MILESTONE_STATUSES).optional(),
  })
  .strict();
export type MilestoneUpdateInput = z.input<typeof milestoneUpdateSchema>;

export const checklistToggleSchema = z.object({ done: z.boolean() }).strict();

export const projectListQuerySchema = z
  .object({ state: z.enum(PROJECT_STATES).optional() })
  .strict();

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

export interface ProjectSummary {
  id: string;
  title: string;
  state: ProjectState;
  manager: { id: string; name: string };
  client: string | null;
  startOn: string | null;
  dueOn: string | null;
  budgetMinor: string;
  currency: Currency;
  fromDeal: { id: string; title: string } | null;
  milestones: { total: number; done: number };
  updatedAt: string;
  version: number;
}

/** The accepted proposal version the project was handed off from (FR-Q10). Read-only. */
export interface ProjectBaseline {
  proposalId: string;
  reference: string;
  versionNo: number;
  title: string;
  acceptedAt: string | null;
  acceptedBy: string | null;
  currency: Currency;
  summary: string | null;
  inclusions: string | null;
  exclusions: string | null;
  assumptions: string | null;
  milestones: string | null;
  paymentTerms: string | null;
  items: ProposalItemView[];
  subtotalMinor: string;
  discountMinor: string;
  taxMinor: string;
  totalMinor: string;
}

export interface ProjectMilestoneView {
  id: string;
  title: string;
  dueOn: string | null;
  status: MilestoneStatus;
  sequence: number;
  version: number;
}

export interface ChecklistItemView {
  id: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  doneBy: { id: string; name: string } | null;
}

export interface ProjectDetail extends ProjectSummary {
  contact: { id: string; fullName: string } | null;
  members: Array<{ id: string; name: string; role: string }>;
  baseline: ProjectBaseline | null;
  milestoneList: ProjectMilestoneView[];
  checklist: ChecklistItemView[];
  activities: TimelineEntry[];
  /** Accepted changes on top of the baseline, with the budget before and now (US-12). */
  scopeHistory: ScopeHistory;
  /** The customer company whose portal users can be given access (FR-X01). */
  clientOrg: { id: string; name: string } | null;
  /**
   * What the viewer may do here (the API checks again on every request). `work`: tasks, own
   * time, files and deliverables (project manager, members, Owner, Admin).
   */
  access: { manage: boolean; work: boolean };
}

/** A won deal with an accepted proposal that has no project yet. */
export interface HandoffCandidate {
  dealId: string;
  title: string;
  contact: string;
  owner: string;
  amountMinor: string;
  currency: Currency;
  wonAt: string | null;
  proposal: { id: string; reference: string; versionNo: number };
}

export interface ConvertResult {
  project: ProjectDetail;
  /** True when this request returned an earlier result for the same Idempotency-Key. */
  replayed: boolean;
}

export interface DeliveryDashboard {
  projects: Record<ProjectState, number>;
  milestones: { overdue: number; dueIn7Days: number };
  handoffWaiting: number | null;
  /** Deliverables waiting for a client decision, and how many are past their review date. */
  deliverables: { awaitingClient: number; overdue: number };
  /** The viewer's own open tasks, soonest due first. */
  myTasks: Array<{
    id: string;
    title: string;
    projectId: string;
    projectTitle: string;
    status: string;
    dueOn: string | null;
    overdue: boolean;
  }>;
  upcoming: Array<{
    projectId: string;
    projectTitle: string;
    milestone: string;
    dueOn: string;
    overdue: boolean;
  }>;
}
