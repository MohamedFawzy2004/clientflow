// Final signature release: permission-scoped intelligence reads (ADR-072).
// Every figure is computed on the server from stored records, inside the caller's existing read
// scopes. Money stays per currency as integer minor units in strings; nothing is converted.
import { z } from 'zod';

/** `?months=` for trend endpoints: whole months ending with the current one (agency time). */
export const trendQuerySchema = z
  .object({
    months: z.coerce
      .number()
      .int('Use a whole number of months.')
      .min(3, 'Show at least 3 months.')
      .max(24, 'Show at most 24 months.')
      .default(12),
  })
  .strict();
export type TrendQuery = z.infer<typeof trendQuerySchema>;

/** Records per kind in one relationship graph; more are reported as `truncated`. */
export const GRAPH_LIMIT = 50;

export interface GraphPerson {
  id: string;
  name: string;
}

/** GET /contacts/:id/graph: stored links around one contact, each list inside its own scope. */
export interface RelationshipGraphData {
  contact: {
    id: string;
    fullName: string;
    companyName: string | null;
    lifecycle: string;
    source: string | null;
    owner: GraphPerson;
    clientOrg: { id: string; name: string } | null;
  };
  /** Kinds the viewer's role may read. A kind that is not readable is absent, not empty. */
  readable: {
    deals: boolean;
    proposals: boolean;
    projects: boolean;
    invoices: boolean;
    deliverables: boolean;
  };
  deals: Array<{
    id: string;
    title: string;
    status: 'OPEN' | 'WON' | 'LOST';
    stage: string;
    amountMinor: string;
    currency: string;
    owner: GraphPerson;
  }>;
  proposals: Array<{
    id: string;
    reference: string;
    title: string;
    status: string;
    dealId: string;
    totalMinor: string;
    currency: string;
  }>;
  projects: Array<{
    id: string;
    title: string;
    state: string;
    dealId: string | null;
    manager: GraphPerson;
    milestones: { done: number; total: number };
  }>;
  invoices: Array<{
    id: string;
    reference: string;
    status: string;
    projectId: string;
    totalMinor: string;
    paidMinor: string;
    currency: string;
  }>;
  deliverables: Array<{ id: string; title: string; status: string; projectId: string }>;
  truncated: Record<'deals' | 'proposals' | 'projects' | 'invoices' | 'deliverables', boolean>;
}

export interface MonthKey {
  /** YYYY-MM in the agency time zone. */
  month: string;
}

/** GET /insights/sales: pipeline shape, stage age and results over time, inside the deal scope. */
export interface SalesIntelligence {
  months: number;
  stages: Array<{
    id: string;
    name: string;
    open: number;
    /** Open value per currency in this stage. */
    totals: Record<string, string>;
    /**
     * Open deals by days in their current stage. Entry time is the last `deal.stage_changed`
     * activity, or the creation date for deals that never moved.
     */
    age: { d0to7: number; d8to14: number; d15to30: number; d31plus: number };
  }>;
  monthly: Array<
    MonthKey & {
      won: number;
      lost: number;
      created: number;
      wonTotals: Record<string, string>;
      /** Deals won in the month per currency; the keys match `wonTotals`. */
      wonCounts: Record<string, number>;
    }
  >;
  sources: Array<{
    source: string | null;
    deals: number;
    won: number;
    lost: number;
    wonTotals: Record<string, string>;
  }>;
  /**
   * Contacts per lead source inside the contact read scope (unarchived, same rule as the contacts
   * list filters): `leads` counts every contact with that source, `clients` those whose lifecycle is
   * CUSTOMER. Empty for roles with no contact access. Sorted by leads, most first.
   */
  leadSources: Array<{ source: string; leads: number; clients: number }>;
}

/** GET /insights/finance: invoiced and received per month and per project, inside the invoice scope. */
export interface FinanceIntelligence {
  months: number;
  /** One series per currency. Invoiced counts issued (non-void) invoices by issue month. */
  monthly: Array<{
    currency: string;
    points: Array<MonthKey & { invoicedMinor: string; receivedMinor: string }>;
  }>;
  /** Payments minus reversals, by the month the money was recorded as received. */
  projects: Array<{
    id: string;
    title: string;
    currency: string;
    invoicedMinor: string;
    receivedMinor: string;
    outstandingMinor: string;
    invoices: number;
  }>;
  /**
   * Finance and admins only (`finance.view`); null for anyone else. One row per non-archived
   * project, in the project's own currency. Budget already includes accepted change requests;
   * cost is logged time at each person's dated rate (rates in another currency are left out and
   * lower `costCompletenessPercent`). Margin is budget minus that cost: an estimate, not profit.
   */
  profitability: Array<{
    id: string;
    title: string;
    state: string;
    currency: string;
    originalBudgetMinor: string;
    acceptedChangesMinor: string;
    budgetMinor: string;
    invoicedMinor: string;
    estimatedCostMinor: string;
    estimatedMarginMinor: string;
    costCompletenessPercent: number;
  }> | null;
}

/** GET /insights/delivery: open projects and people's load, inside the project scope. */
export interface DeliveryIntelligence {
  projects: Array<{
    id: string;
    title: string;
    state: string;
    startOn: string | null;
    dueOn: string | null;
    manager: GraphPerson;
    milestones: Array<{ id: string; title: string; dueOn: string | null; status: string }>;
    tasks: {
      total: number;
      done: number;
      blocked: number;
      overdue: number;
      open: number;
    };
    /** Estimates of tasks that have one; logged minutes the viewer may see. */
    estimateMinutes: number;
    loggedMinutes: number;
    /** Whether `loggedMinutes` covers everyone (manager view) or only the viewer. */
    loggedScope: 'all' | 'own';
  }>;
  /** Open tasks per assignee across the projects above. No capacity model: counts only. */
  people: Array<{
    id: string;
    name: string;
    open: number;
    overdue: number;
    blocked: number;
    estimateMinutes: number;
    /** Next 6 weeks, Monday first: open tasks due in each week. */
    dueByWeek: number[];
  }>;
  weekStarts: string[];
}

/** GET /projects/:id/plan: milestones, tasks and every dependency edge, for timeline and map. */
export interface ProjectPlan {
  project: { id: string; title: string; startOn: string | null; dueOn: string | null };
  milestones: Array<{
    id: string;
    title: string;
    dueOn: string | null;
    status: string;
    sequence: number;
  }>;
  tasks: Array<{
    id: string;
    title: string;
    status: string;
    priority: string;
    dueOn: string | null;
    milestoneId: string | null;
    assignee: GraphPerson | null;
    estimateMinutes: number | null;
  }>;
  dependencies: Array<{ taskId: string; dependsOnId: string }>;
}
