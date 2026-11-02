import type { ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import { ArrowRight, Bell, Download } from 'lucide-react';
import { can, type DashboardQuery, type Reminder } from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { cn, formatDate } from '../../lib/format';
import { ErrorState, Skeleton } from '../../components/ui/feedback';
import { Input, Select } from '../../components/ui/form';
import { Totals } from '../../components/sales/sales-ui';
import { useSession } from '../auth/session';
import { useAssignableOwners } from '../deals/api';
import { toSearch, useReminders, useSalesDashboard } from './api';

const BIG = 'text-[32px] font-semibold leading-[38px] tracking-[-0.02em] tabular';
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function Kpi({
  label,
  children,
  to,
  linkLabel,
  tone,
}: {
  label: string;
  children: ReactNode;
  to?: string;
  linkLabel?: string;
  tone?: 'warning';
}) {
  return (
    <section
      aria-label={label}
      className="rounded-lg border border-border bg-surface p-5 shadow-card"
    >
      <p className="text-[13px] font-medium text-muted">{label}</p>
      <div className={cn('mt-2', tone === 'warning' ? 'text-warning' : 'text-text')}>
        {children}
      </div>
      {to && linkLabel ? (
        <Link
          to={to}
          className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary-strong hover:underline"
        >
          {linkLabel} <ArrowRight aria-hidden className="size-4" />
        </Link>
      ) : null}
    </section>
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

export function RemindersCard({ limit = 5 }: { limit?: number }) {
  const reminders = useReminders();
  const items: Reminder[] = reminders.data?.data.items.slice(0, limit) ?? [];
  const total = reminders.data?.data.total ?? 0;
  return (
    <section
      aria-label="Needs your attention"
      className="rounded-lg border border-border bg-surface shadow-card"
    >
      <div className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 className="flex items-center gap-2 text-[15px] font-semibold text-text">
          <Bell aria-hidden className="size-4 text-muted" /> Needs your attention
        </h2>
        {total > limit ? (
          <Link
            to="/app/reminders"
            className="text-sm font-medium text-primary-strong hover:underline"
          >
            All {total}
          </Link>
        ) : null}
      </div>
      {reminders.isPending ? (
        <div className="p-5">
          <Skeleton className="h-10" />
        </div>
      ) : reminders.isError ? (
        <p className="p-5 text-sm text-danger">{reminders.error.message}</p>
      ) : items.length === 0 ? (
        <p className="px-5 py-4 text-sm text-muted">Nothing overdue and nothing waiting on you.</p>
      ) : (
        <ul className="divide-y divide-border">
          {items.map((r) => (
            <li key={r.id}>
              <Link to={r.href} className="block px-5 py-3 hover:bg-surface-alt/50">
                <p className="truncate text-sm font-medium text-text">{r.title}</p>
                <p
                  className={cn(
                    'truncate text-xs',
                    r.kind === 'follow_up_overdue' ? 'font-medium text-danger' : 'text-muted',
                  )}
                >
                  {r.detail}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

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
    <div className="flex flex-col gap-6">
      <section aria-label="Filters" className="flex flex-wrap items-end gap-3">
        <div className="w-[calc(50%-6px)] sm:w-44">
          <label htmlFor="dash-from" className="text-[13px] font-medium text-text">
            From
          </label>
          <Input
            id="dash-from"
            type="date"
            className="mt-1.5"
            value={q.from ?? d?.range.from ?? ''}
            onChange={(e) => set('from', e.target.value)}
          />
        </div>
        <div className="w-[calc(50%-6px)] sm:w-44">
          <label htmlFor="dash-to" className="text-[13px] font-medium text-text">
            To
          </label>
          <Input
            id="dash-to"
            type="date"
            className="mt-1.5"
            value={q.to ?? d?.range.to ?? ''}
            onChange={(e) => set('to', e.target.value)}
          />
        </div>
        {team ? (
          <div className="w-full sm:w-56">
            <label htmlFor="dash-owner" className="text-[13px] font-medium text-text">
              Owner
            </label>
            <Select
              id="dash-owner"
              className="mt-1.5"
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
            className="inline-flex h-11 items-center gap-2 rounded-md border border-border-strong bg-surface px-4 text-sm font-medium text-text shadow-[0_1px_2px_rgba(16,36,60,0.06)] hover:bg-surface-alt md:h-10"
          >
            <Download aria-hidden className="size-4" /> Export deals (CSV)
          </a>
        ) : null}
      </section>

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
        <div aria-busy className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <p className="text-[13px] text-muted" aria-live="polite">
            {formatDate(`${d.range.from}T12:00:00Z`, timeZone)} to{' '}
            {formatDate(`${d.range.to}T12:00:00Z`, timeZone)}
            {d.owner
              ? ` · ${d.owner.id === user?.id ? 'your records' : d.owner.name}`
              : ' · whole agency'}
            . Money is totalled per currency.
          </p>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Kpi label="Open pipeline" to="/app/deals" linkLabel="Open board">
              <p className={BIG}>{d.pipeline.openDeals}</p>
              <Totals totals={d.pipeline.totals} className="mt-1 text-xs text-muted" />
            </Kpi>
            <Kpi label="Won in this period">
              <p className={BIG}>{d.won.count}</p>
              <Totals totals={d.won.totals} className="mt-1 text-xs text-muted" />
            </Kpi>
            <Kpi label="Win rate">
              <p className={BIG}>{d.winRatePercent === null ? '–' : `${d.winRatePercent}%`}</p>
              <p className="mt-1 text-xs text-muted">
                {d.won.count} won · {d.lost.count} lost in this period
              </p>
            </Kpi>
            <Kpi label="New leads" to="/app/leads" linkLabel="View leads">
              <p className={BIG}>{d.newLeads}</p>
            </Kpi>
            <Kpi
              label="Follow-ups"
              to="/app/follow-ups"
              linkLabel="Open follow-ups"
              tone={d.followUps.overdue > 0 ? 'warning' : undefined}
            >
              <p className={BIG}>{d.followUps.overdue}</p>
              <p className="mt-1 text-xs text-muted">overdue · {d.followUps.dueToday} due today</p>
            </Kpi>
            <Kpi label="Proposals waiting" to="/app/proposals" linkLabel="View proposals">
              <p className={BIG}>{d.proposals.inReview + d.proposals.awaitingClient}</p>
              <p className="mt-1 text-xs text-muted">
                {d.proposals.inReview} in review · {d.proposals.awaitingClient} with clients ·{' '}
                {d.proposals.expiringIn7Days} expiring within 7 days
              </p>
            </Kpi>
            <Kpi label="Proposals accepted">
              <p className={BIG}>{d.proposals.accepted}</p>
              <Totals totals={d.proposals.acceptedTotals} className="mt-1 text-xs text-muted" />
            </Kpi>
          </div>

          {d.byOwner && d.byOwner.length > 0 ? (
            <section
              aria-label="By owner"
              className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
            >
              <h2 className="border-b border-border px-5 py-3.5 text-[15px] font-semibold text-text">
                By owner
              </h2>
              <ul className="divide-y divide-border">
                {d.byOwner.map((r) => (
                  <li
                    key={r.owner.id}
                    className="flex flex-col gap-1 px-5 py-3 text-sm sm:flex-row sm:items-center sm:gap-4"
                  >
                    <p className="min-w-0 flex-1 truncate font-medium text-text">{r.owner.name}</p>
                    <p className="text-muted">
                      {r.openDeals} open · <Totals totals={r.openTotals} className="inline-flex" />
                    </p>
                    <p className="text-muted">
                      {r.won} won · <Totals totals={r.wonTotals} className="inline-flex" />
                    </p>
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
