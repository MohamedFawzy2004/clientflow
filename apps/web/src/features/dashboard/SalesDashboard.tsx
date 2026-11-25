import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowUpRight, Download } from 'lucide-react';
import { can, type Currency, type DashboardQuery, type Reminder } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { cn, formatDate } from '../../lib/format';
import { ErrorState, Skeleton } from '../../components/ui/feedback';
import { Input, Select } from '../../components/ui/form';
import { Panel } from '../../components/ui/page';
import { Money, Totals } from '../../components/sales/sales-ui';
import { SplitMeter } from '../../components/charts/charts';
import { useSession } from '../auth/session';
import { useAssignableOwners } from '../deals/api';
import { toSearch, useReminders, useSalesDashboard } from './api';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/** One cell of the revenue ledger: a labelled region with a figure and its explanation. */
function Cell({
  label,
  children,
  to,
  linkLabel,
  className,
}: {
  label: string;
  children: ReactNode;
  to?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <section aria-label={label} className={cn('flex min-w-0 flex-col p-5', className)}>
      <h3 className="text-[13px] text-muted">{label}</h3>
      <div className="mt-2 flex-1">{children}</div>
      {to && linkLabel ? (
        <Link
          to={to}
          className="mt-3 inline-flex items-center gap-1 self-start text-[13px] font-medium text-primary-strong hover:underline"
        >
          {linkLabel}
          <ArrowUpRight aria-hidden className="size-3.5" />
        </Link>
      ) : null}
    </section>
  );
}

/** Money as the headline figure: each currency on its own line, never added together. */
function BigTotals({ totals }: { totals: Partial<Record<Currency, string>> }) {
  const entries = Object.entries(totals) as Array<[Currency, string]>;
  if (entries.length === 0) return <p className="figure text-[28px] leading-9">–</p>;
  return (
    <div className="flex flex-col">
      {entries.map(([c, v], i) => (
        <Money
          key={c}
          minor={v}
          currency={c}
          className={cn(
            'figure block',
            i === 0 ? 'text-[28px] leading-9' : 'text-lg leading-7 text-text',
          )}
        />
      ))}
    </div>
  );
}

/** Date range and owner live in the URL, so a filtered view can be shared or reloaded. */
function useFilters() {
  const [params, setParams] = useSearchParams();
  const pick = (k: string) => {
    const v = params.get(k);
    return v && (k !== 'ownerId' ? DATE.test(v) : true) ? v : undefined;
  };
  const q: DashboardQuery = {
    ...(pick('from') ? { from: pick('from') } : {}),
    ...(pick('to') ? { to: pick('to') } : {}),
    ...(pick('ownerId') ? { ownerId: pick('ownerId') } : {}),
  };
  const set = (k: keyof DashboardQuery, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };
  return { q, set };
}

/** Items waiting on the viewer (FR-A01): proposals to review, changes requested, expiring. */
export function RemindersCard({ limit = 5 }: { limit?: number }) {
  const reminders = useReminders();
  const items: Reminder[] = reminders.data?.data.items.slice(0, limit) ?? [];
  const total = reminders.data?.data.total ?? 0;
  return (
    <Panel
      title="Waiting on you"
      description="Approvals and proposals that need your decision."
      action={
        total > limit ? (
          <Link
            to="/app/reminders"
            className="text-[13px] font-medium text-primary-strong hover:underline"
          >
            All {total}
          </Link>
        ) : null
      }
      bodyClassName="px-0 pb-2 pt-1"
    >
      <div aria-label="Needs your attention" role="region">
        {reminders.isPending ? (
          <div className="px-5 py-3">
            <Skeleton className="h-10" />
          </div>
        ) : reminders.isError ? (
          <p className="px-5 py-3 text-sm text-danger">{reminders.error.message}</p>
        ) : items.length === 0 ? (
          <p className="px-5 py-3 text-sm text-muted">Nothing is waiting on you.</p>
        ) : (
          <ul>
            {items.map((r) => (
              <li key={`${r.kind}-${r.id}`}>
                <Link to={r.href} className="flex gap-3 px-5 py-2.5 hover:bg-surface-alt/70">
                  <span
                    aria-hidden
                    className={cn(
                      'mt-1.5 size-2 shrink-0 rounded-full',
                      r.kind === 'follow_up_overdue'
                        ? 'bg-danger'
                        : r.kind.startsWith('proposal')
                          ? 'bg-violet'
                          : 'bg-attention',
                    )}
                  />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-medium text-ink">{r.title}</span>
                    <span
                      className={cn(
                        'block truncate text-xs',
                        r.kind === 'follow_up_overdue' ? 'font-medium text-danger' : 'text-muted',
                      )}
                    >
                      {r.detail}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Panel>
  );
}

/**
 * Results for the chosen period (FR-F08): one ledger with different forms per measure, then the
 * team table for managers. Every figure is from GET /api/v1/dashboard/sales.
 */
export function SalesDashboard() {
  const { data: user } = useSession();
  const { q, set } = useFilters();
  const query = useSalesDashboard(q);
  const team = user ? can(user.role, 'dashboard.team') : false;
  const canExport = user ? can(user.role, 'reports.export') : false;
  const owners = useAssignableOwners();
  const error = query.error instanceof ApiError ? query.error : null;
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const d = query.data?.data;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-4">
        <div className="min-w-0">
          <h2 className="text-xl font-[640] tracking-[-0.02em] text-ink">Results</h2>
          {d ? (
            <p className="mt-0.5 text-[13px] text-muted" aria-live="polite">
              {formatDate(`${d.range.from}T12:00:00Z`, timeZone)} to{' '}
              {formatDate(`${d.range.to}T12:00:00Z`, timeZone)}
              {d.owner
                ? `, ${d.owner.id === user?.id ? 'your records' : d.owner.name}`
                : ', whole agency'}
              . Money is totalled per currency.
            </p>
          ) : null}
        </div>
        <section aria-label="Filters" className="flex flex-wrap items-end gap-3">
          <div className="w-[calc(50%-6px)] sm:w-40">
            <label htmlFor="dash-from" className="text-[13px] font-medium text-text">
              From
            </label>
            <Input
              id="dash-from"
              type="date"
              className="mt-1.5 md:h-10"
              value={q.from ?? d?.range.from ?? ''}
              onChange={(e) => set('from', e.target.value)}
            />
          </div>
          <div className="w-[calc(50%-6px)] sm:w-40">
            <label htmlFor="dash-to" className="text-[13px] font-medium text-text">
              To
            </label>
            <Input
              id="dash-to"
              type="date"
              className="mt-1.5 md:h-10"
              value={q.to ?? d?.range.to ?? ''}
              onChange={(e) => set('to', e.target.value)}
            />
          </div>
          {team ? (
            <div className="w-full sm:w-48">
              <label htmlFor="dash-owner" className="text-[13px] font-medium text-text">
                Owner
              </label>
              <Select
                id="dash-owner"
                className="mt-1.5 md:h-10"
                value={q.ownerId ?? ''}
                onChange={(e) => set('ownerId', e.target.value)}
              >
                <option value="">Everyone</option>
                {(owners.data?.data ?? []).map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name}
                  </option>
                ))}
              </Select>
            </div>
          ) : null}
          {canExport ? (
            <a
              href={`/api/v1/exports/deals.csv${toSearch(q) ? `?${toSearch(q)}` : ''}`}
              download
              className="press inline-flex h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-3.5 text-sm font-medium text-ink hover:bg-surface-alt md:h-10"
            >
              <Download aria-hidden className="size-4" /> Export deals (CSV)
            </a>
          ) : null}
        </section>
      </div>

      {error ? (
        <div className="rounded-lg border border-border bg-surface">
          <ErrorState
            title="We could not load your numbers"
            message={
              error.status === 422
                ? (Object.values(error.fieldErrors)[0]?.[0] ?? error.message)
                : error.message
            }
            requestId={error.requestId}
            onRetry={() => query.refetch()}
            retrying={query.isFetching}
          />
        </div>
      ) : !d ? (
        <Skeleton className="h-48 rounded-lg" />
      ) : (
        <>
          <div className="grid grid-cols-1 overflow-hidden rounded-lg border border-border bg-surface sm:grid-cols-2 xl:grid-cols-4 [&>section]:border-border max-sm:[&>section+section]:border-t sm:[&>section:nth-child(n+3)]:border-t xl:[&>section:nth-child(n+3)]:border-t-0 sm:[&>section:nth-child(even)]:border-l xl:[&>section+section]:border-l">
            <Cell label="Won in this period">
              <BigTotals totals={d.won.totals} />
              <p className="mt-1 text-xs text-muted">
                {d.won.count} {d.won.count === 1 ? 'deal' : 'deals'} closed won
              </p>
            </Cell>
            <Cell label="Open pipeline" to="/app/deals" linkLabel="Open board">
              <p className="figure text-[28px] leading-9">{d.pipeline.openDeals}</p>
              <Totals
                totals={d.pipeline.totals}
                className="mt-1 flex-col text-xs text-muted [&>span]:block"
              />
            </Cell>
            <Cell label="Win rate">
              <p className="figure text-[28px] leading-9">
                {d.winRatePercent === null ? '–' : `${d.winRatePercent}%`}
              </p>
              <div className="mt-2">
                <SplitMeter
                  left={d.won.count}
                  right={d.lost.count}
                  leftLabel="won"
                  rightLabel="lost"
                />
              </div>
              <p className="sr-only">
                {d.won.count} won · {d.lost.count} lost in this period
              </p>
            </Cell>
            <Cell label="Proposals" to="/app/proposals" linkLabel="View proposals">
              <dl className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[13px]">
                <dt className="text-muted">In internal review</dt>
                <dd className="text-right font-medium text-ink tabular">{d.proposals.inReview}</dd>
                <dt className="text-muted">With clients</dt>
                <dd className="text-right font-medium text-ink tabular">
                  {d.proposals.awaitingClient}
                </dd>
                <dt className={d.proposals.expiringIn7Days ? 'text-warning' : 'text-muted'}>
                  Expiring within 7 days
                </dt>
                <dd
                  className={cn(
                    'text-right font-medium tabular',
                    d.proposals.expiringIn7Days ? 'text-warning' : 'text-ink',
                  )}
                >
                  {d.proposals.expiringIn7Days}
                </dd>
                <dt className="text-muted">Accepted in period</dt>
                <dd className="text-right font-medium text-ink tabular">{d.proposals.accepted}</dd>
              </dl>
              {Object.keys(d.proposals.acceptedTotals).length ? (
                <Totals totals={d.proposals.acceptedTotals} className="mt-1.5 text-xs text-muted" />
              ) : null}
            </Cell>
          </div>
          <p className="-mt-2 text-[13px] text-muted">
            <span className="font-medium text-ink tabular">{d.newLeads}</span> new{' '}
            {d.newLeads === 1 ? 'lead' : 'leads'} added in this period.{' '}
            <Link to="/app/leads" className="font-medium text-primary-strong hover:underline">
              View leads
            </Link>
          </p>

          {d.byOwner && d.byOwner.length > 0 ? <TeamTable rows={d.byOwner} /> : null}
        </>
      )}
    </div>
  );
}

type OwnerRows = NonNullable<
  NonNullable<ReturnType<typeof useSalesDashboard>['data']>['data']['byOwner']
>;

/** Team performance (managers): counts drawn as bars because counts compare across people. */
function TeamTable({ rows }: { rows: OwnerRows }) {
  const max = Math.max(1, ...rows.map((r) => r.openDeals + r.won));
  return (
    <Panel
      title="Team performance"
      description="Open and won deals per owner for this period. Values stay in their own currency."
      bodyClassName="px-0 pb-1 pt-2"
    >
      <section aria-label="By owner">
        <table className="w-full border-collapse text-sm">
          <caption className="sr-only">Deals by owner</caption>
          <thead className="hidden text-left text-xs text-muted sm:table-header-group">
            <tr className="border-b border-border">
              <th scope="col" className="px-5 py-2 font-medium">
                Owner
              </th>
              <th scope="col" className="w-[30%] px-3 py-2 font-medium">
                Deals
              </th>
              <th scope="col" className="px-3 py-2 text-right font-medium">
                Open value
              </th>
              <th scope="col" className="px-5 py-2 text-right font-medium">
                Won value
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr
                key={r.owner.id}
                className="border-b border-border last:border-0 max-sm:grid max-sm:grid-cols-2 max-sm:gap-1 max-sm:px-5 max-sm:py-3"
              >
                <th
                  scope="row"
                  className="px-5 py-3 text-left font-medium text-ink max-sm:col-span-2 max-sm:p-0"
                >
                  {r.owner.name}
                </th>
                <td className="px-3 py-3 max-sm:col-span-2 max-sm:p-0">
                  <div className="flex items-center gap-2">
                    <div aria-hidden className="flex h-2 flex-1 gap-[2px]">
                      <span
                        className="chart-mark rounded-l-[2px] bg-seq-3"
                        style={{ width: `${(r.openDeals / max) * 100}%` }}
                      />
                      <span
                        className="chart-mark rounded-r-[2px] bg-ink"
                        style={{ width: `${(r.won / max) * 100}%` }}
                      />
                    </div>
                    <span className="w-28 shrink-0 text-xs text-muted tabular">
                      {r.openDeals} open · {r.won} won
                    </span>
                  </div>
                </td>
                <td className="px-3 py-3 text-right text-text sm:align-top max-sm:p-0 max-sm:text-left">
                  <span className="sr-only sm:hidden">Open: </span>
                  <Totals totals={r.openTotals} className="justify-end max-sm:justify-start" />
                </td>
                <td className="px-5 py-3 text-right text-text sm:align-top max-sm:p-0">
                  <span className="sr-only sm:hidden">Won: </span>
                  <Totals totals={r.wonTotals} className="justify-end" />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="flex gap-4 px-5 py-2 text-xs text-muted">
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px] bg-seq-3" /> Open deals
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="size-2 rounded-[2px] bg-ink" /> Won in period
          </span>
        </p>
      </section>
    </Panel>
  );
}
