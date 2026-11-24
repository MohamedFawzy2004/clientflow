import { useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import {
  Archive,
  ArrowLeft,
  ArrowUpRight,
  Building,
  CalendarClock,
  Check,
  Mail,
  Network,
  Phone,
  Plus,
  SearchX,
  ShieldAlert,
  StickyNote,
  UserRound,
} from 'lucide-react';
import {
  can,
  canAny,
  CONTACT_SOURCE_LABELS,
  type ContactWithDeals,
  type DealSummary,
} from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { cn, formatDate, formatDateTime, relativeDay } from '../../lib/format';
import { dealSignals, daysLabel, signalReason } from '../../lib/deal-signals';
import { Button } from '../../components/ui/button';
import { ConfirmDialog } from '../../components/ui/confirm-dialog';
import { Badge, Banner, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { PageHeader, Panel, Segmented } from '../../components/ui/page';
import { ProposalStatusBadge } from '../../components/proposals/proposal-ui';
import { ProjectStateBadge } from '../../components/projects/project-ui';
import { InvoiceStatusBadge } from '../../components/finance/finance-ui';
import {
  DealStatusBadge,
  Money,
  ReassignDialog,
  Timeline,
  Totals,
} from '../../components/sales/sales-ui';
import { useSession } from '../auth/session';
import { useAssignableOwners } from '../deals/api';
import { DealFormDialog } from '../deals/DealFormDialog';
import { useLead, useLeadAction } from './api';
import {
  activityGroup,
  dealTotals,
  INTERACTION_LABELS,
  totalsOf,
  useLinkedRecords,
  type ActivityFilter,
} from './client360';
import { ClientPortalCard } from './ClientPortalCard';
import { EditLeadDialog } from './EditLeadDialog';
import { NextAction } from './LeadsListPage';
import { TimelineComposer } from './TimelineComposer';

type Open = 'edit' | 'convert' | 'archive' | 'reassign' | 'deal' | null;

function DetailRow({
  icon,
  label,
  children,
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
}) {
  return (
    // A <dl> may only hold <div> groups of <dt>/<dd>, so the icon lives inside the <dt>.
    <div className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 py-3">
      <dt className="contents">
        <span aria-hidden className="row-span-2 mt-0.5 text-subtle">
          {icon}
        </span>
        <span className="text-xs text-muted">{label}</span>
      </dt>
      <dd className="col-start-2 mt-0.5 break-words text-sm text-ink">{children}</dd>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      to="/app/leads"
      className="inline-flex h-10 items-center gap-1.5 rounded-md text-sm font-medium text-muted hover:text-ink"
    >
      <ArrowLeft aria-hidden className="size-4" />
      Back to leads
    </Link>
  );
}

function stale(err: unknown) {
  if (err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION') {
    return 'Someone else changed this lead. The page is refreshed: check it and try again.';
  }
  if (err instanceof ApiError) return Object.values(err.fieldErrors)[0]?.[0] ?? err.message;
  return err instanceof Error ? err.message : null;
}

// ---------------------------------------------------------------------------
// Relationship summary: a ledger of four facts, all from this contact's records.
// ---------------------------------------------------------------------------

function SummaryCell({ label, children }: { label: string; children: ReactNode }) {
  return (
    <section aria-label={label} className="min-w-0 p-4 md:p-5">
      <h2 className="text-[13px] text-muted">{label}</h2>
      <div className="mt-1">{children}</div>
    </section>
  );
}

function RelationshipSummary({ lead, timeZone }: { lead: ContactWithDeals; timeZone: string }) {
  const open = lead.deals.filter((d) => d.status === 'OPEN');
  const won = lead.deals.filter((d) => d.status === 'WON');
  const lastTalk = lead.activities.find((a) => a.eventType.startsWith('activity.'));
  const now = new Date();
  return (
    <div className="mt-6 grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-2 xl:grid-cols-4 max-sm:[&>section+section]:border-t sm:[&>section:nth-child(n+3)]:border-t sm:[&>section:nth-child(even)]:border-l xl:[&>section+section]:border-l xl:[&>section:nth-child(n+3)]:border-t-0 [&>section]:border-border">
      <SummaryCell label="Open pipeline">
        <p className="figure text-2xl leading-8">{open.length}</p>
        <Totals totals={dealTotals(open)} className="text-xs text-muted" />
      </SummaryCell>
      <SummaryCell label="Won with this client">
        <p className="figure text-2xl leading-8">{won.length}</p>
        <Totals totals={dealTotals(won)} className="text-xs text-muted" />
      </SummaryCell>
      <SummaryCell label="Last conversation">
        {lastTalk ? (
          <>
            <p className="text-[15px] font-medium text-ink">
              {INTERACTION_LABELS[lastTalk.eventType] ?? 'Logged'},{' '}
              {relativeDay(lastTalk.occurredAt, now, timeZone)}
            </p>
            <p className="text-xs text-muted tabular">
              {formatDate(lastTalk.occurredAt, timeZone)}
              {lastTalk.actor ? `, by ${lastTalk.actor.name}` : ''}
            </p>
          </>
        ) : (
          <p className="text-[15px] text-muted">No call, email, meeting or note logged</p>
        )}
      </SummaryCell>
      <SummaryCell label="Next step">
        <div className="text-[15px]">
          <NextAction iso={lead.nextActionAt} timeZone={timeZone} />
        </div>
      </SummaryCell>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Journey: an ordered sequence, so numbered steps are honest here.
// ---------------------------------------------------------------------------

interface Step {
  label: string;
  at: string | null;
  done: boolean;
  /** False when the viewer's role cannot see the records behind this step. */
  known: boolean;
}

function Journey({ steps, timeZone }: { steps: Step[]; timeZone: string }) {
  return (
    <nav aria-label="Relationship journey" className="mt-6">
      <ol className="grid grid-cols-2 gap-x-3 gap-y-4 sm:grid-cols-3 lg:grid-cols-6">
        {steps.map((s, i) => (
          <li key={s.label} className="relative min-w-0">
            <div className="flex items-center gap-2">
              <span
                aria-hidden
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-semibold tabular',
                  s.done
                    ? 'bg-primary text-white'
                    : 'border border-dashed border-control bg-surface text-muted',
                )}
              >
                {s.done ? <Check className="size-3.5" /> : i + 1}
              </span>
              <span
                aria-hidden
                className={cn(
                  'hidden h-px flex-1 lg:block',
                  i === steps.length - 1 ? 'invisible' : s.done ? 'bg-primary' : 'bg-border-strong',
                )}
              />
            </div>
            <p className={cn('mt-1.5 text-[13px] font-medium', s.done ? 'text-ink' : 'text-muted')}>
              {s.label}
              <span className="sr-only">
                {s.done ? ', done' : s.known ? ', not yet' : ', not visible to your role'}
              </span>
            </p>
            <p className="text-xs text-muted tabular">
              {s.done && s.at
                ? formatDate(s.at, timeZone)
                : s.known
                  ? s.done
                    ? 'Done'
                    : 'Not yet'
                  : 'Not visible to you'}
            </p>
          </li>
        ))}
      </ol>
    </nav>
  );
}

// ---------------------------------------------------------------------------
// Linked records
// ---------------------------------------------------------------------------

function DealRow({ deal, now, timeZone }: { deal: DealSummary; now: Date; timeZone: string }) {
  const s = dealSignals(deal, now);
  const reason = deal.status === 'OPEN' ? signalReason(s) : null;
  return (
    <li>
      <Link
        to={`/app/deals/${deal.id}`}
        className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-alt/50"
      >
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium text-ink">{deal.title}</span>
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
            {deal.status === 'OPEN' ? (
              <span>
                {deal.stage.name}, open {daysLabel(s.ageDays)}
              </span>
            ) : (
              <>
                <DealStatusBadge status={deal.status} />
                {deal.closedAt ? <span>{formatDate(deal.closedAt, timeZone)}</span> : null}
              </>
            )}
            {reason ? (
              <span className={cn('font-medium', s.stalled ? 'text-danger' : 'text-warning')}>
                {reason}
              </span>
            ) : null}
          </span>
        </span>
        <Money
          minor={deal.amountMinor}
          currency={deal.currency}
          className="shrink-0 text-sm font-semibold text-ink"
        />
      </Link>
    </li>
  );
}

function LoadingRows() {
  return (
    <div className="flex flex-col gap-2 px-5 pb-4 pt-2" aria-hidden>
      <Skeleton className="h-10" />
      <Skeleton className="h-10" />
    </div>
  );
}

function LinkedList<T>({
  q,
  rows,
  empty,
  render,
}: {
  q: {
    isPending: boolean;
    isError: boolean;
    isFetching: boolean;
    refetch: () => unknown;
    fetchStatus: string;
  };
  rows: T[];
  empty: string;
  render: (row: T) => ReactNode;
}) {
  if (q.isPending && q.fetchStatus !== 'idle') return <LoadingRows />;
  if (q.isError)
    return (
      <p className="px-5 pb-4 pt-2 text-sm text-muted">
        Could not load this list.{' '}
        <button
          type="button"
          onClick={() => q.refetch()}
          className="font-medium text-primary-strong hover:underline"
        >
          Try again
        </button>
      </p>
    );
  if (rows.length === 0) return <p className="px-5 pb-4 pt-2 text-sm text-muted">{empty}</p>;
  return <ul className="mt-2 divide-y divide-border border-t border-border">{rows.map(render)}</ul>;
}

const ACTIVITY_FILTERS: Array<{ value: ActivityFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'conversations', label: 'Conversations' },
  { value: 'deals', label: 'Deals' },
  { value: 'record', label: 'Record' },
];

function LeadView({ lead, timeZone }: { lead: ContactWithDeals; timeZone: string }) {
  const { data: user } = useSession();
  const action = useLeadAction(lead.id);
  const owners = useAssignableOwners();
  const linked = useLinkedRecords(lead);
  const [open, setOpen] = useState<Open>(null);
  const [filter, setFilter] = useState<ActivityFilter>('all');
  const [now] = useState(() => new Date());
  if (!user) return null;

  const archived = Boolean(lead.archivedAt);
  const canWrite = can(user.role, 'contacts.write');
  const canManage = can(user.role, 'sales.reassign');
  const canDeals = canAny(user.role, ['deals.read.all', 'deals.read.own']);
  const close = (o: boolean) => {
    if (!o) {
      setOpen(null);
      action.reset();
    }
  };
  const run = (a: Parameters<typeof action.mutate>[0], success: string) =>
    action.mutate(a, {
      onSuccess: () => {
        toast.success(success);
        setOpen(null);
      },
    });

  const byDate = (iso: string | null | undefined) => (iso ? Date.parse(iso) : Infinity);
  const firstDeal = [...lead.deals].sort((a, b) => byDate(a.createdAt) - byDate(b.createdAt))[0];
  const firstWon = lead.deals
    .filter((d) => d.status === 'WON')
    .sort((a, b) => byDate(a.closedAt) - byDate(b.closedAt))[0];
  const firstProposal = [...linked.proposals.rows]
    .filter((p) => p.status !== 'DRAFT')
    .sort((a, b) => byDate(a.updatedAt) - byDate(b.updatedAt))[0];
  const firstProject = [...linked.projects.rows].sort(
    (a, b) => byDate(a.startOn ?? a.updatedAt) - byDate(b.startOn ?? b.updatedAt),
  )[0];
  const firstInvoice = linked.invoices.rows
    .filter((i) => i.issuedOn)
    .sort((a, b) => byDate(a.issuedOn) - byDate(b.issuedOn))[0];
  const steps: Step[] = [
    { label: 'Added', at: lead.createdAt, done: true, known: true },
    { label: 'First deal', at: firstDeal?.createdAt ?? null, done: !!firstDeal, known: canDeals },
    {
      label: 'Proposal shared',
      at: null,
      done: !!firstProposal,
      known: linked.access.proposals,
    },
    {
      label: 'Became a client',
      at: lead.convertedAt ?? firstWon?.closedAt ?? null,
      done: lead.lifecycle === 'CUSTOMER',
      known: true,
    },
    {
      label: 'Project start',
      at: firstProject?.startOn ? `${firstProject.startOn}T12:00:00Z` : null,
      done: !!firstProject,
      known: linked.access.projects,
    },
    {
      label: 'Invoiced',
      at: firstInvoice?.issuedOn ? `${firstInvoice.issuedOn}T12:00:00Z` : null,
      done: !!firstInvoice,
      known: linked.access.invoices,
    },
  ];

  const activities =
    filter === 'all'
      ? lead.activities
      : lead.activities.filter((a) => activityGroup(a.eventType) === filter);

  return (
    <>
      <PageHeader
        crumbs={[{ label: 'Leads', to: '/app/leads' }]}
        title={lead.fullName}
        meta={
          <>
            {lead.lifecycle === 'CUSTOMER' ? (
              <Badge tone="success">Customer</Badge>
            ) : (
              <Badge tone="info">Lead</Badge>
            )}
            {archived ? (
              <Badge tone="neutral" icon={<Archive aria-hidden className="size-3.5" />}>
                Archived
              </Badge>
            ) : null}
            <span className="text-muted">
              {lead.companyName ? `${lead.companyName}, owned` : 'Owned'} by {lead.owner.name}
            </span>
          </>
        }
        actions={
          <>
            <Link
              to={`/app/relationships?focus=${lead.id}`}
              className="press inline-flex h-10 items-center gap-1.5 rounded-md px-3 text-sm font-medium text-primary-strong hover:bg-primary-soft"
            >
              <Network aria-hidden className="size-4" />
              Relationship map
            </Link>
            {canWrite ? (
              archived ? (
                <Button
                  variant="secondary"
                  loading={action.isPending}
                  loadingLabel="Restoring…"
                  onClick={() => run({ kind: 'restore', version: lead.version }, 'Lead restored')}
                >
                  Restore
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onClick={() => setOpen('edit')}>
                    Edit
                  </Button>
                  {lead.lifecycle === 'LEAD' ? (
                    <Button variant="secondary" onClick={() => setOpen('convert')}>
                      Convert to customer
                    </Button>
                  ) : null}
                  {canManage ? (
                    <Button variant="secondary" onClick={() => setOpen('reassign')}>
                      Reassign
                    </Button>
                  ) : null}
                  <Button variant="ghost" onClick={() => setOpen('archive')}>
                    Archive
                  </Button>
                </>
              )
            ) : null}
          </>
        }
      />

      {archived ? (
        <Banner tone="info" title="This lead is archived" className="mt-5">
          It is hidden from lists and follow-ups and cannot be changed. Restore it to work on it
          again.
        </Banner>
      ) : null}
      {action.error && open === null ? (
        <Banner tone="danger" title="That did not work" className="mt-5">
          {stale(action.error)}
        </Banner>
      ) : null}

      <RelationshipSummary lead={lead} timeZone={timeZone} />
      <Journey steps={steps} timeZone={timeZone} />

      <div className="mt-6 grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-7">
          {canDeals ? (
            <Panel
              bodyClassName="p-0"
              id="lead-deals"
              title="Deals"
              description={
                lead.deals.length > 0 ? (
                  <>
                    {lead.deals.length} in total.{' '}
                    <Totals totals={dealTotals(lead.deals)} className="inline" />
                  </>
                ) : undefined
              }
              action={
                canWrite && !archived ? (
                  <Button size="sm" variant="secondary" onClick={() => setOpen('deal')}>
                    <Plus aria-hidden className="size-4" /> New deal
                  </Button>
                ) : undefined
              }
            >
              {lead.deals.length === 0 ? (
                <p className="px-5 pb-4 pt-2 text-sm text-muted">No deals yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-border border-t border-border">
                  {lead.deals.map((d) => (
                    <DealRow key={d.id} deal={d} now={now} timeZone={timeZone} />
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}

          {linked.access.proposals ? (
            <Panel
              bodyClassName="p-0"
              id="lead-proposals"
              title="Proposals"
              description="Every version sent to or drafted for this contact."
            >
              <LinkedList
                q={linked.proposals.q}
                rows={linked.proposals.rows}
                empty="No proposals for this contact yet."
                render={(p) => (
                  <li key={p.id}>
                    <Link
                      to={`/app/proposals/${p.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-alt/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">
                          {p.reference}, {p.title}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <ProposalStatusBadge status={p.displayStatus} />
                          <span>Version {p.currentVersionNo}</span>
                        </span>
                      </span>
                      <Money
                        minor={p.totalMinor}
                        currency={p.currency}
                        className="shrink-0 text-sm font-semibold text-ink"
                      />
                    </Link>
                  </li>
                )}
              />
            </Panel>
          ) : null}

          {linked.access.projects && lead.deals.length > 0 ? (
            <Panel
              bodyClassName="p-0"
              id="lead-delivery"
              title="Delivery and billing"
              description="Projects handed off from this contact’s deals, and their invoices."
            >
              <LinkedList
                q={linked.projects.q}
                rows={linked.projects.rows}
                empty="No project has been started from these deals."
                render={(p) => (
                  <li key={p.id}>
                    <Link
                      to={`/app/projects/${p.id}`}
                      className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-alt/50"
                    >
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium text-ink">
                          {p.title}
                        </span>
                        <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                          <ProjectStateBadge state={p.state} />
                          <span className="tabular">
                            {p.milestones.done}/{p.milestones.total} milestones
                          </span>
                          {p.dueOn ? (
                            <span>due {formatDate(`${p.dueOn}T12:00:00Z`, timeZone)}</span>
                          ) : null}
                        </span>
                      </span>
                      <span className="shrink-0 text-xs text-muted">{p.manager.name}</span>
                    </Link>
                  </li>
                )}
              />
              {linked.access.invoices && linked.projects.rows.length > 0 ? (
                <div className="border-t border-border">
                  <div className="flex flex-wrap items-baseline justify-between gap-2 px-5 pt-4">
                    <h3 className="text-[13px] font-semibold text-ink">Invoices</h3>
                    {linked.invoices.rows.length > 0 ? (
                      <span className="text-xs text-muted">
                        Balance due{' '}
                        <Totals
                          className="inline font-medium text-ink"
                          totals={totalsOf(
                            linked.invoices.rows.filter(
                              (i) => i.status !== 'VOID' && i.status !== 'DRAFT',
                            ),
                            (i) => [i.currency, i.balanceMinor],
                          )}
                        />
                      </span>
                    ) : null}
                  </div>
                  <LinkedList
                    q={linked.invoices.q}
                    rows={linked.invoices.rows}
                    empty="No invoices for these projects yet."
                    render={(i) => (
                      <li key={i.id}>
                        <Link
                          to={`/app/invoices/${i.id}`}
                          className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-surface-alt/50"
                        >
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-medium text-ink">
                              {i.number === null ? 'Draft invoice' : i.reference}
                            </span>
                            <span className="flex flex-wrap items-center gap-2 text-xs text-muted">
                              <InvoiceStatusBadge status={i.displayStatus} />
                              <span>due {formatDate(`${i.dueOn}T12:00:00Z`, timeZone)}</span>
                            </span>
                          </span>
                          <Money
                            minor={i.totalMinor}
                            currency={i.currency}
                            className="shrink-0 text-sm font-semibold text-ink"
                          />
                        </Link>
                      </li>
                    )}
                  />
                </div>
              ) : null}
            </Panel>
          ) : null}

          <Panel
            bodyClassName="p-0"
            id="lead-activity"
            title="Activity"
            action={
              <Segmented
                label="Show activity"
                value={filter}
                options={ACTIVITY_FILTERS}
                onChange={setFilter}
              />
            }
          >
            {canWrite ? (
              <div className="mt-2 border-y border-border px-5">
                <TimelineComposer
                  leadId={lead.id}
                  timeZone={timeZone}
                  disabled={archived ? 'Restore this lead to log activity.' : undefined}
                />
              </div>
            ) : null}
            <div className="px-5">
              <Timeline
                entries={activities}
                timeZone={timeZone}
                empty={filter === 'all' ? undefined : 'Nothing of this kind recorded yet.'}
              />
            </div>
          </Panel>
        </div>

        <div className="flex min-w-0 flex-col gap-5 xl:col-span-5">
          <Panel bodyClassName="p-0" id="lead-details" title="Contact details">
            <dl className="divide-y divide-border px-5">
              <DetailRow icon={<Mail className="size-4" />} label="Email">
                {lead.email ? (
                  <a
                    className="text-primary-strong underline-offset-2 hover:underline"
                    href={`mailto:${lead.email}`}
                  >
                    {lead.email}
                  </a>
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </DetailRow>
              <DetailRow icon={<Phone className="size-4" />} label="Phone">
                {lead.phone ? (
                  <a
                    className="text-primary-strong underline-offset-2 hover:underline tabular"
                    href={`tel:${lead.phone.replace(/[^\d+]/g, '')}`}
                  >
                    {lead.phone}
                  </a>
                ) : (
                  <span className="text-muted">Not provided</span>
                )}
              </DetailRow>
              <DetailRow icon={<Building className="size-4" />} label="Company">
                {lead.companyName ?? <span className="text-muted">Not provided</span>}
                {lead.clientOrg ? (
                  <span className="block text-xs text-muted">
                    Client organization: {lead.clientOrg.name}
                  </span>
                ) : null}
              </DetailRow>
              <DetailRow icon={<UserRound className="size-4" />} label="Source">
                {lead.source ? (
                  CONTACT_SOURCE_LABELS[lead.source]
                ) : (
                  <span className="text-muted">Not specified</span>
                )}
              </DetailRow>
              <DetailRow icon={<CalendarClock className="size-4" />} label="Added">
                <span className="tabular">{formatDateTime(lead.createdAt, timeZone)}</span>
              </DetailRow>
              {lead.convertedAt ? (
                <DetailRow icon={<CalendarClock className="size-4" />} label="Became a customer">
                  <span className="tabular">{formatDateTime(lead.convertedAt, timeZone)}</span>
                </DetailRow>
              ) : null}
            </dl>
          </Panel>
          <Panel bodyClassName="p-0" id="lead-notes" title="Notes">
            {lead.notes ? (
              // Rendered as text, never as HTML, so stored markup cannot run (T-SEC-03).
              <p className="whitespace-pre-wrap break-words px-5 pb-4 pt-2 text-sm leading-[22px] text-ink">
                {lead.notes}
              </p>
            ) : (
              <p className="flex items-center gap-2 px-5 pb-4 pt-2 text-sm text-muted">
                <StickyNote aria-hidden className="size-4" />
                No notes yet.
              </p>
            )}
          </Panel>
          <ClientPortalCard lead={lead} />
          <Link
            to={`/app/relationships?focus=${lead.id}`}
            className="group flex items-center justify-between gap-3 rounded-lg border border-border bg-mint-soft px-5 py-4 hover:border-mint"
          >
            <span>
              <span className="block text-sm font-medium text-ink">See the relationship map</span>
              <span className="block text-xs text-muted">
                People, deals, proposals, projects and invoices around {lead.fullName}.
              </span>
            </span>
            <ArrowUpRight aria-hidden className="size-4 shrink-0 text-primary-strong" />
          </Link>
        </div>
      </div>

      {open === 'edit' ? (
        <EditLeadDialog
          lead={lead}
          timeZone={timeZone}
          open
          onOpenChange={(o) => !o && setOpen(null)}
        />
      ) : null}
      {open === 'deal' ? (
        <DealFormDialog open onOpenChange={(o) => !o && setOpen(null)} contact={lead} />
      ) : null}
      <ConfirmDialog
        open={open === 'convert'}
        onOpenChange={close}
        title={`Convert ${lead.fullName} to a customer?`}
        description="The record keeps its history and deals. Winning a deal does this automatically."
        confirmLabel="Convert"
        pendingLabel="Converting…"
        tone="primary"
        pending={action.isPending}
        error={open === 'convert' ? stale(action.error) : null}
        onConfirm={() => run({ kind: 'convert', version: lead.version }, 'Now a customer')}
      />
      <ConfirmDialog
        open={open === 'archive'}
        onOpenChange={close}
        title={`Archive ${lead.fullName}?`}
        description="Archived leads leave lists and follow-ups. Nothing is deleted, and you can restore it any time."
        confirmLabel="Archive"
        pendingLabel="Archiving…"
        pending={action.isPending}
        error={open === 'archive' ? stale(action.error) : null}
        onConfirm={() => run({ kind: 'archive', version: lead.version }, 'Lead archived')}
      />
      {open === 'reassign' ? (
        <ReassignDialog
          open
          onOpenChange={close}
          what="lead"
          currentOwnerId={lead.owner.id}
          owners={owners.data?.data ?? [lead.owner]}
          pending={action.isPending}
          error={stale(action.error)}
          onConfirm={(ownerId) =>
            run({ kind: 'reassign', ownerId, version: lead.version }, 'Lead reassigned')
          }
        />
      ) : null}
    </>
  );
}

export function LeadDetailPage() {
  const { id = '' } = useParams();
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const query = useLead(id);
  const error = query.error instanceof ApiError ? query.error : null;

  if (query.isPending) {
    return (
      <div aria-busy className="flex flex-col gap-6">
        <Skeleton className="h-4 w-40" />
        <div className="flex flex-col gap-2">
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-40" />
        </div>
        <Skeleton className="h-24 rounded-lg" />
        <div className="grid gap-5 xl:grid-cols-12">
          <Skeleton className="h-72 rounded-lg xl:col-span-7" />
          <Skeleton className="h-72 rounded-lg xl:col-span-5" />
        </div>
      </div>
    );
  }
  if (error?.status === 404) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={<SearchX aria-hidden className="size-5" />}
          title="Lead not found"
          description="This lead does not exist, was archived, or is not assigned to you."
        />
      </>
    );
  }
  if (error?.status === 403) {
    return (
      <>
        <BackLink />
        <EmptyState
          icon={<ShieldAlert aria-hidden className="size-5" />}
          title="You do not have access to leads"
          description="Ask your agency owner or admin if you need access."
        />
      </>
    );
  }
  if (query.isError) {
    return (
      <>
        <BackLink />
        <ErrorState
          message={query.error.message}
          requestId={error?.requestId}
          onRetry={() => query.refetch()}
          retrying={query.isFetching}
        />
      </>
    );
  }
  return <LeadView lead={query.data.data} timeZone={timeZone} />;
}
