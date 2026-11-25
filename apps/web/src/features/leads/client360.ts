import { useQuery } from '@tanstack/react-query';
import {
  canAny,
  type ApiSuccess,
  type ContactWithDeals,
  type Currency,
  type DealSummary,
  type InvoiceSummary,
  type ProjectSummary,
  type ProposalSummary,
  type Role,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';

/**
 * Client 360: the records linked to one contact, read from the existing list endpoints and joined
 * in the browser. Every link is a persisted foreign key:
 *   proposals → `proposal.contact.id`                       (GET /api/v1/proposals, cap 200)
 *   projects  → `project.fromDeal.id` ∈ this contact's deals (GET /api/v1/projects, cap 200)
 *   invoices  → `invoice.project.id` ∈ those projects        (GET /api/v1/invoices, cap 500)
 * Each list is scoped by the API to what the viewer may read, so the 360 never shows more than
 * the dedicated pages would. The caps are listed in docs/design/redesign/02_DATA_SOURCES.md.
 */

export interface LinkedAccess {
  proposals: boolean;
  projects: boolean;
  invoices: boolean;
}

export function linkedAccess(role: Role): LinkedAccess {
  return {
    proposals: canAny(role, ['proposals.read.all', 'proposals.read.own']),
    projects: canAny(role, ['projects.read.all', 'projects.read.member', 'projects.read.linked']),
    invoices: canAny(role, ['invoices.read.all', 'invoices.read.project']),
  };
}

function list<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

export function useLinkedRecords(lead: ContactWithDeals) {
  const { data: user } = useSession();
  const access = user
    ? linkedAccess(user.role)
    : { proposals: false, projects: false, invoices: false };
  const key = ['u', user?.id ?? 'anon', 'c360'] as const;
  const proposals = useQuery({
    queryKey: [...key, 'proposals'],
    enabled: access.proposals,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ProposalSummary[]>>('/api/v1/proposals', { signal }),
  });
  const projects = useQuery({
    queryKey: [...key, 'projects'],
    enabled: access.projects && lead.deals.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) => api.get<ApiSuccess<ProjectSummary[]>>('/api/v1/projects', { signal }),
  });
  const invoices = useQuery({
    queryKey: [...key, 'invoices'],
    enabled: access.invoices && lead.deals.length > 0,
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<{ invoices: InvoiceSummary[] }>>('/api/v1/invoices', { signal }),
  });

  const dealIds = new Set(lead.deals.map((d) => d.id));
  const leadProposals = list<ProposalSummary>(proposals.data?.data).filter(
    (p) => p.contact?.id === lead.id,
  );
  const leadProjects = list<ProjectSummary>(projects.data?.data).filter(
    (p) => p.fromDeal && dealIds.has(p.fromDeal.id),
  );
  const projectIds = new Set(leadProjects.map((p) => p.id));
  const invoiceData = invoices.data?.data as { invoices?: unknown } | undefined;
  const leadInvoices = list<InvoiceSummary>(invoiceData?.invoices).filter(
    (i) => i.project && projectIds.has(i.project.id),
  );
  return {
    access,
    proposals: { q: proposals, rows: leadProposals },
    projects: { q: projects, rows: leadProjects },
    invoices: { q: invoices, rows: leadInvoices },
  };
}

export type Totals = Partial<Record<Currency, string>>;

export function totalsOf<T>(rows: T[], pick: (r: T) => [Currency, string]): Totals {
  const acc: Partial<Record<Currency, bigint>> = {};
  for (const r of rows) {
    const [c, minor] = pick(r);
    acc[c] = (acc[c] ?? 0n) + BigInt(minor);
  }
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.toString()])) as Totals;
}

export const dealTotals = (deals: DealSummary[]) =>
  totalsOf(deals, (d) => [d.currency, d.amountMinor]);

/** Activity kinds logged from the composer (`activity.<kind>`), in plain words. */
export const INTERACTION_LABELS: Record<string, string> = {
  'activity.call': 'Call',
  'activity.email': 'Email',
  'activity.meeting': 'Meeting',
  'activity.note': 'Note',
};

export type ActivityFilter = 'all' | 'conversations' | 'deals' | 'record';

export function activityGroup(eventType: string): Exclude<ActivityFilter, 'all'> {
  if (eventType.startsWith('activity.')) return 'conversations';
  if (eventType.startsWith('deal.') || eventType.startsWith('proposal.')) return 'deals';
  return 'record';
}
