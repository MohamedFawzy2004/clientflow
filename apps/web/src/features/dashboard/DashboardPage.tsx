import { useMemo, useState } from 'react';
import { Link } from 'react-router';
import {
  ArrowUpRight,
  Briefcase,
  CircleCheck,
  Circle,
  Plus,
  Receipt,
  User,
  Users,
} from 'lucide-react';
import {
  can,
  formatMoney,
  type DealSummary,
  type FollowUpItem,
  type FollowUpQueue,
} from '@clientflow/contracts';
import { useBoard, useCanSeeDeals, useFollowUps } from '../deals/api';
import { DeliveryDashboardSection } from './DeliveryDashboard';
import { RemindersCard, SalesDashboard } from './SalesDashboard';
import { useLeadSources, useWonByMonth } from './insights';
import { canSeeLeads } from '../../app/nav';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { PageHeader, Panel } from '../../components/ui/page';
import {
  BarList,
  ChartFrame,
  DayHeat,
  MonthlyColumns,
  SERIES,
  StageFlow,
  type DayCell,
} from '../../components/charts/charts';
import { cn, formatDate, relativeDay, todayIn } from '../../lib/format';
import { dealSignals, signalReason, STALL_DAYS } from '../../lib/deal-signals';
import { useSession } from '../auth/session';
import { AddLeadDialog } from '../leads/AddLeadDialog';
import { useLeads } from '../leads/api';

function greeting(timeZone: string) {
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hourCycle: 'h23', timeZone }).format(
      new Date(),
    ),
  );
  return hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
}

function longToday(timeZone: string) {
  return new Intl.DateTimeFormat('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone,
  }).format(new Date());
}

// ---------------------------------------------------------------------------
// Next conversations: overdue first, then due today (GET /api/v1/follow-ups).
// ---------------------------------------------------------------------------

function DueLabel({ iso, timeZone }: { iso: string | null; timeZone: string }) {
  if (!iso) return <span className="text-xs text-muted">No date</span>;
  const overdue = todayIn(timeZone, new Date(iso)) < todayIn(timeZone);
  return (
    <span
      className={cn(
        'whitespace-nowrap text-xs font-medium tabular',
        overdue ? 'text-danger' : 'text-ink',
      )}
    >
      {overdue ? `Overdue, ${relativeDay(iso, new Date(), timeZone)}` : 'Today'}
    </span>
  );
}

function NextConversations({ timeZone }: { timeZone: string }) {
  const q = useFollowUps();
  const LIMIT = 7;
  if (q.isPending) return <Skeleton className="h-80 rounded-lg" />;
  if (q.isError)
    return (
      <Panel title="Next conversations">
        <ErrorState
          className="py-8"
          message={q.error.message}
          onRetry={() => q.refetch()}
          retrying={q.isFetching}
        />
      </Panel>
    );
  const { overdue, today, counts } = q.data.data;
  const rows: FollowUpItem[] = [...overdue, ...today];
  const shown = rows.slice(0, LIMIT);
  const remaining = counts.overdue + counts.today - shown.length;
  return (
    <Panel
      title="Next conversations"
      description="Overdue first, then today. Each row is a lead's next action or a deal's next step."
      action={
        <Link
          to="/app/follow-ups"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-strong hover:underline"
        >
          All follow-ups <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      }
      bodyClassName="px-0 pb-0 pt-2"
      className="flex flex-col"
    >
      <dl className="mx-5 mb-2 grid grid-cols-4 gap-px overflow-hidden rounded-md border border-border bg-border text-center">
        {(
          [
            ['Overdue', counts.overdue, counts.overdue > 0 ? 'text-danger' : 'text-ink'],
            ['Today', counts.today, 'text-ink'],
            ['Upcoming', counts.upcoming, 'text-ink'],
            [
              'No next step',
              counts.noNextStep,
              counts.noNextStep > 0 ? 'text-warning' : 'text-ink',
            ],
          ] as const
        ).map(([label, n, tone]) => (
          <div key={label} className="flex flex-col-reverse bg-surface px-2 py-2">
            <dt className="truncate text-[11px] text-muted sm:text-xs">{label}</dt>
            <dd className={cn('figure text-xl leading-7', tone)}>{n}</dd>
          </div>
        ))}
      </dl>
      {shown.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted">
          Nothing overdue and nothing due today.{' '}
          {counts.upcoming > 0 ? `${counts.upcoming} coming up later.` : null}
        </p>
      ) : (
        <ul>
          {shown.map((item) => {
            const Icon = item.type === 'deal' ? Briefcase : User;
            return (
              <li key={`${item.type}-${item.id}`} className="border-t border-border">
                <Link
                  to={item.type === 'deal' ? `/app/deals/${item.id}` : `/app/leads/${item.id}`}
                  className="flex items-center gap-3 px-5 py-3 hover:bg-surface-alt/70"
                >
                  <span
                    aria-hidden
                    className={cn(
                      'grid size-8 shrink-0 place-items-center rounded-full',
                      item.type === 'deal'
                        ? 'bg-surface-alt text-ink'
                        : 'bg-primary-soft text-primary-strong',
                    )}
                  >
                    <Icon className="size-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-ink">
                      {item.title}
                    </span>
                    <span className="block truncate text-xs text-muted">
                      {item.type === 'deal'
                        ? 'Deal'
                        : item.lifecycle === 'CUSTOMER'
                          ? 'Client'
                          : 'Lead'}
                      {item.subtitle ? `: ${item.subtitle}` : ''}, {item.owner.name}
                    </span>
                  </span>
                  <DueLabel iso={item.dueAt} timeZone={timeZone} />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
      {remaining > 0 ? (
        <Link
          to="/app/follow-ups"
          className="block border-t border-border px-5 py-3 text-[13px] font-medium text-primary-strong hover:bg-surface-alt/70"
        >
          {remaining} more due now
        </Link>
      ) : null}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Follow-up load for the next 14 days (today + upcoming buckets).
// ---------------------------------------------------------------------------

function useDayLoad(queue: FollowUpQueue | undefined, timeZone: string, days = 14) {
  return useMemo(() => {
    if (!queue) return null;
    const start = todayIn(timeZone);
    const cells: DayCell[] = [];
    const base = Date.parse(`${start}T12:00:00Z`);
    for (let i = 0; i < days; i++) {
      const d = new Date(base + i * 86_400_000);
      const iso = d.toISOString().slice(0, 10);
      cells.push({
        date: iso,
        weekday: new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' }).format(d),
        day: String(d.getUTCDate()),
        count: 0,
        isToday: i === 0,
      });
    }
    const end = cells.at(-1)!.date;
    const items = [...queue.today, ...queue.upcoming];
    for (const it of items) {
      if (!it.dueAt) continue;
      const day = todayIn(timeZone, new Date(it.dueAt));
      const cell = cells.find((c) => c.date === day);
      if (cell) cell.count += 1;
    }
    // The API returns up to 50 per type in each bucket, soonest first. The window is complete
    // when every upcoming item came back, or when the last one returned falls after the window.
    const lastUpcoming = queue.upcoming.at(-1)?.dueAt;
    const complete =
      queue.upcoming.length >= queue.counts.upcoming ||
      (lastUpcoming ? todayIn(timeZone, new Date(lastUpcoming)) > end : true);
    return { cells, complete };
  }, [queue, timeZone, days]);
}

function FollowUpLoad({ timeZone }: { timeZone: string }) {
  const q = useFollowUps();
  const load = useDayLoad(q.data?.data, timeZone);
  return (
    <Panel title="Follow-up load" description="Scheduled next steps per day, next 14 days.">
      {q.isPending ? (
        <Skeleton className="h-16" />
      ) : q.isError || !load ? (
        <p className="text-sm text-danger">{q.error?.message ?? 'Could not load follow-ups.'}</p>
      ) : (
        <ChartFrame
          question="Which days are follow-ups piling up on?"
          note={
            load.complete
              ? 'Darker means more follow-ups that day. Overdue items are not included.'
              : 'Some later follow-ups were not returned by the list, so the last days may be undercounted.'
          }
        >
          <DayHeat days={load.cells} caption="Follow-ups due per day for the next 14 days" />
        </ChartFrame>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Pipeline: stage ribbon + deals that need attention (GET /api/v1/deals/board).
// ---------------------------------------------------------------------------

function PipelinePanel({ timeZone }: { timeZone: string }) {
  const board = useBoard();
  const [stage, setStage] = useState<string | null>(null);
  if (board.isPending) return <Skeleton className="h-72 rounded-lg" />;
  if (board.isError)
    return (
      <Panel title="Pipeline">
        <ErrorState
          className="py-8"
          message={board.error.message}
          onRetry={() => board.refetch()}
          retrying={board.isFetching}
        />
      </Panel>
    );
  const now = new Date();
  const { columns } = board.data.data;
  const flagged = columns.flatMap((c) =>
    c.deals.map((d) => ({ deal: d, s: dealSignals(d, now) })).filter((x) => x.s.atRisk),
  );
  const rank = (x: { s: ReturnType<typeof dealSignals> }) =>
    x.s.stalled ? 0 : x.s.nextStepOverdue ? 1 : 2;
  const list = flagged
    .filter((x) => !stage || x.deal.stage.id === stage)
    .sort((a, b) => rank(a) - rank(b) || b.s.idleDays - a.s.idleDays)
    .slice(0, 6);
  const openCount = columns.reduce((s, c) => s + c.count, 0);
  const capped = columns.some((c) => c.count > c.deals.length);

  return (
    <Panel
      title="Pipeline"
      description="Open deals by stage right now. Select a stage to filter the attention list."
      action={
        <Link
          to="/app/deals"
          className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-strong hover:underline"
        >
          Open board <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      }
    >
      {openCount === 0 ? (
        <p className="py-6 text-sm text-muted">No open deals. Create one from a lead to start.</p>
      ) : (
        <ChartFrame question="Where is open work sitting in the pipeline right now?">
          <StageFlow
            stages={columns.map((c) => ({
              id: c.id,
              name: c.name,
              count: c.count,
              totals: c.totals,
              flagged: flagged.filter((x) => x.deal.stage.id === c.id).length,
            }))}
            selected={stage}
            onSelect={setStage}
          />
        </ChartFrame>
      )}
      <div className="mt-5 border-t border-border pt-4">
        <h3 className="text-sm font-[620] text-ink">
          Needs attention
          <span className="ml-2 font-normal text-muted tabular">
            {flagged.length} of {openCount}
            {stage ? ` (filtered by ${columns.find((c) => c.id === stage)?.name})` : ''}
          </span>
        </h3>
        <p className="mt-0.5 text-xs text-muted">
          Rule: no next step, next step overdue, or stalled (no change for {STALL_DAYS}+ days and
          nothing scheduled ahead).
          {capped ? ' The board returns up to 100 deals per stage.' : ''}
        </p>
        {list.length === 0 ? (
          <p className="py-4 text-sm text-muted">Every open deal has a next step on time.</p>
        ) : (
          <ul className="mt-2 grid grid-cols-1 gap-x-6 md:grid-cols-2">
            {list.map(({ deal, s }) => (
              <AttentionRow
                key={deal.id}
                deal={deal}
                reason={signalReason(s)!}
                stalled={s.stalled}
                timeZone={timeZone}
              />
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

function AttentionRow({
  deal,
  reason,
  stalled,
  timeZone,
}: {
  deal: DealSummary;
  reason: string;
  stalled: boolean;
  timeZone: string;
}) {
  return (
    <li className="border-b border-border last:border-0 md:[&:nth-last-child(2):nth-child(odd)]:border-0">
      <Link
        to={`/app/deals/${deal.id}`}
        className="flex items-start gap-3 py-3 hover:bg-surface-alt/40"
      >
        <span
          aria-hidden
          className={cn(
            'mt-1.5 size-2 shrink-0 rounded-full',
            stalled ? 'bg-danger' : 'bg-attention',
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-ink">{deal.title}</span>
          <span className="block truncate text-xs text-muted">
            {deal.stage.name}, {deal.owner.name}
            {deal.nextStepAt ? `, next step ${formatDate(deal.nextStepAt, timeZone)}` : ''}
          </span>
          <span
            className={cn('block text-xs font-medium', stalled ? 'text-danger' : 'text-warning')}
          >
            {reason}
          </span>
        </span>
        <span className="shrink-0 text-sm font-medium text-ink tabular">
          {formatMoney(deal.amountMinor, deal.currency)}
        </span>
      </Link>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Won by month (deals list, status=WON) and lead sources (contact list totals).
// ---------------------------------------------------------------------------

function WonByMonthPanel() {
  const q = useWonByMonth(6);
  return (
    <Panel
      title="Won value by month"
      description="Closed-won deals by the month they closed, last 6 months, one chart per currency."
    >
      {q.isPending ? (
        <Skeleton className="h-40" />
      ) : q.isError ? (
        <ErrorState className="py-6" message={q.error.message} onRetry={() => q.refetch()} />
      ) : q.data.byCurrency.length === 0 ? (
        <p className="py-6 text-sm text-muted">No deals were won in the last 6 months.</p>
      ) : (
        <ChartFrame
          question="How much did we win each month?"
          note={
            q.data.truncated
              ? 'Based on the latest 500 won deals: older months may be undercounted.'
              : 'Hover a month for its value and deal count.'
          }
        >
          <div className="grid gap-6 sm:grid-cols-2">
            {q.data.byCurrency.map((c, i) => (
              <MonthlyColumns
                key={c.currency}
                currency={c.currency}
                points={c.points}
                color={SERIES[i % SERIES.length]}
              />
            ))}
          </div>
        </ChartFrame>
      )}
    </Panel>
  );
}

function LeadSourcesPanel() {
  const q = useLeadSources(true);
  return (
    <Panel
      title="Lead sources"
      description="Leads per recorded source, and how many became clients."
    >
      {q.pending ? (
        <Skeleton className="h-40" />
      ) : q.error ? (
        <ErrorState className="py-6" message={q.error.message} onRetry={q.refetch} />
      ) : (
        <ChartFrame
          question="Which sources bring leads that become clients?"
          note="Archived contacts and contacts with no source are not counted."
        >
          <BarList
            caption="Leads and clients per source"
            valueHeader="Leads"
            partHeader="Became clients"
            color="#64BBA1"
            partColor="#0B7A6A"
            rows={q.rows.map((r) => ({
              id: r.source,
              label: r.label,
              value: r.leads,
              part: r.clients,
              partLabel: 'became clients',
            }))}
            empty="No lead has a source recorded yet."
          />
          <p className="mt-3 flex gap-4 text-xs text-muted">
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-[2px] bg-mint" /> Leads
            </span>
            <span className="flex items-center gap-1.5">
              <span aria-hidden className="size-2 rounded-[2px] bg-seq-4" /> Became clients
            </span>
          </p>
        </ChartFrame>
      )}
    </Panel>
  );
}

// ---------------------------------------------------------------------------
// Empty workspace: what to do first.
// ---------------------------------------------------------------------------

function GettingStarted({ canInvite }: { canInvite: boolean }) {
  const [addOpen, setAddOpen] = useState(false);
  const steps: Array<{ done: boolean; label: string; note?: string; to?: string }> = [
    { done: false, label: 'Add your first lead' },
    ...(canInvite
      ? [
          {
            done: false,
            label: 'Invite your team',
            note: 'Give each person their own sign-in',
            to: '/app/team',
          },
        ]
      : []),
    { done: false, label: 'Create a deal from a lead', note: 'Track it through your pipeline' },
  ];
  return (
    <Panel title="Getting started" description="Your workspace is empty. Three steps fill it.">
      <ol className="flex flex-col gap-3">
        {steps.map((s) => (
          <li key={s.label} className="flex items-start gap-2.5 text-sm">
            {s.done ? (
              <CircleCheck aria-hidden className="mt-0.5 size-4 text-success" />
            ) : (
              <Circle aria-hidden className="mt-0.5 size-4 text-subtle" />
            )}
            <span>
              {s.to ? (
                <Link to={s.to} className="font-medium text-primary-strong hover:underline">
                  {s.label}
                </Link>
              ) : (
                <span className="font-medium text-ink">{s.label}</span>
              )}
              {s.note ? <span className="block text-xs text-muted">{s.note}</span> : null}
            </span>
          </li>
        ))}
      </ol>
      <Button className="mt-5" onClick={() => setAddOpen(true)}>
        <Plus aria-hidden className="size-4" />
        Add your first lead
      </Button>
      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} />
    </Panel>
  );
}

function SalesCommandCenter({ timeZone, canInvite }: { timeZone: string; canInvite: boolean }) {
  const leads = useLeads({ page: 1, limit: 1 });
  const canDeals = useCanSeeDeals();
  if (leads.isPending) {
    return (
      <div className="grid grid-cols-1 gap-5 xl:grid-cols-12">
        <Skeleton className="h-80 rounded-lg xl:col-span-7" />
        <Skeleton className="h-80 rounded-lg xl:col-span-5" />
      </div>
    );
  }
  if (leads.isSuccess && leads.data.meta.total === 0) {
    return (
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        <GettingStarted canInvite={canInvite} />
        <RemindersCard />
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <div className="xl:col-span-7">
          <NextConversations timeZone={timeZone} />
        </div>
        <div className="flex flex-col gap-5 xl:col-span-5">
          <RemindersCard />
          <FollowUpLoad timeZone={timeZone} />
        </div>
      </div>
      {canDeals ? <PipelinePanel timeZone={timeZone} /> : null}
      <div className="mt-3">
        <SalesDashboard />
      </div>
      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        {canDeals ? (
          <div className="xl:col-span-7">
            <WonByMonthPanel />
          </div>
        ) : null}
        <div className={canDeals ? 'xl:col-span-5' : 'xl:col-span-12'}>
          <LeadSourcesPanel />
        </div>
      </div>
    </div>
  );
}

export function DashboardPage() {
  const { data: user } = useSession();
  if (!user) return null;
  const firstName = user.name.split(' ')[0];
  const timeZone = user.agency.timezone;
  const sales = canSeeLeads(user.role) && can(user.role, 'dashboard.sales');
  const delivery = can(user.role, 'dashboard.delivery');

  return (
    <>
      <PageHeader
        title={`${greeting(timeZone)}, ${firstName}`}
        documentTitle="Dashboard"
        description={`${longToday(timeZone)}. ${
          sales
            ? 'Who to talk to next, where the pipeline stands and what closed.'
            : delivery
              ? 'What is moving in delivery and what is waiting on clients.'
              : `Your work at ${user.agency.name}.`
        }`}
      />
      <div className="mt-7 flex flex-col gap-10">
        {sales ? (
          <SalesCommandCenter timeZone={timeZone} canInvite={can(user.role, 'team.invite')} />
        ) : null}
        {delivery ? <DeliveryDashboardSection /> : null}
        {!sales && !delivery ? <FinanceHome /> : null}
      </div>
    </>
  );
}

/** Finance has no sales or delivery dashboard; point to the screens that are theirs. */
function FinanceHome() {
  const { data: user } = useSession();
  const finance = user ? can(user.role, 'finance.view') : false;
  if (!finance) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={<Users aria-hidden className="size-5" />}
          title="Nothing to show for your role yet"
          description="Your role has no dashboard. Nothing is hidden from you by mistake."
        />
      </div>
    );
  }
  return (
    <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
      {[
        {
          to: '/app/invoices',
          title: 'Invoices',
          body: 'Drafts, issued invoices and payments, with totals per currency.',
        },
        {
          to: '/app/reports/finance',
          title: 'Finance report',
          body: 'What is owed and how old it is, plus project margins from logged time.',
        },
      ].map((c) => (
        <Link
          key={c.to}
          to={c.to}
          className="press group flex items-start gap-4 rounded-lg border border-border bg-surface p-5 hover:border-border-strong"
        >
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-primary-soft text-primary-strong">
            <Receipt aria-hidden className="size-5" />
          </span>
          <span>
            <span className="flex items-center gap-1 text-[15px] font-[620] text-ink">
              {c.title}
              <ArrowUpRight aria-hidden className="size-4 text-subtle group-hover:text-ink" />
            </span>
            <span className="mt-0.5 block text-sm text-muted">{c.body}</span>
          </span>
        </Link>
      ))}
    </div>
  );
}
