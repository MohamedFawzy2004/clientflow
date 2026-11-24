import { useMemo, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  Briefcase,
  Hourglass,
  KanbanSquare,
  List,
  PanelRightOpen,
  Plus,
  Search,
  ShieldAlert,
} from 'lucide-react';
import type { BoardColumn, Currency, DealStatus, DealSummary } from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { cn, formatDate } from '../../lib/format';
import { dealSignals, daysLabel, signalReason, STALL_DAYS } from '../../lib/deal-signals';
import { Avatar } from '../../components/ui/brand';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { PageHeader, Segmented } from '../../components/ui/page';
import { seqSteps } from '../../components/charts/charts';
import { DealStatusBadge, Money, Totals } from '../../components/sales/sales-ui';
import { useSession } from '../auth/session';
import { NextAction } from '../leads/LeadsListPage';
import { useBoard, useCanSeeDeals, useDeals, useMoveDeal } from './api';
import { DealDrawer } from './DealDrawer';
import { DealFormDialog } from './DealFormDialog';

type Totals = Partial<Record<Currency, string>>;

/** Per-currency sums of integer minor units. Never adds across currencies. */
function sumByCurrency(deals: DealSummary[]): Totals {
  const acc: Partial<Record<Currency, bigint>> = {};
  for (const d of deals) acc[d.currency] = (acc[d.currency] ?? 0n) + BigInt(d.amountMinor);
  return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, v.toString()])) as Totals;
}

const controlCls =
  'h-10 rounded-md border border-control bg-surface px-3 text-sm text-ink hover:border-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 md:h-9';

// ---------------------------------------------------------------------------
// Board
// ---------------------------------------------------------------------------

function DealCard({
  deal,
  columns,
  timeZone,
  now,
  onMove,
  onPreview,
  moving,
}: {
  deal: DealSummary;
  columns: BoardColumn[];
  timeZone: string;
  now: Date;
  onMove: (deal: DealSummary, stageId: string) => void;
  onPreview: (id: string) => void;
  moving: boolean;
}) {
  const s = dealSignals(deal, now);
  const reason = signalReason(s);
  return (
    <li
      draggable
      onDragStart={(e) => {
        // Playwright's WebKit returns custom types such as text/deal-id empty on drop (Safari's
        // engine); text/plain reaches the drop in every engine.
        e.dataTransfer.setData('text/deal-id', deal.id);
        e.dataTransfer.setData('text/plain', deal.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className={cn(
        'group relative cursor-grab rounded-md border bg-surface p-3 shadow-[0_1px_2px_rgba(20,45,42,0.06)] transition-[border-color,box-shadow] duration-150 hover:border-border-strong hover:shadow-[0_4px_12px_-4px_rgba(20,45,42,0.16)] active:cursor-grabbing',
        s.stalled ? 'border-danger/40' : 'border-border',
      )}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link
            to={`/app/deals/${deal.id}`}
            className="block break-words text-sm font-medium leading-5 text-ink hover:text-primary-strong"
          >
            {deal.title}
          </Link>
          <p className="mt-0.5 truncate text-xs text-muted">
            {deal.contact.companyName ?? deal.contact.fullName}
          </p>
        </div>
        <button
          type="button"
          aria-label={`Quick view ${deal.title}`}
          onClick={() => onPreview(deal.id)}
          className="press -mr-1 -mt-1 grid size-8 shrink-0 place-items-center rounded-md text-subtle hover:bg-surface-alt hover:text-ink"
        >
          <PanelRightOpen aria-hidden className="size-4" />
        </button>
      </div>
      <p className="figure mt-2 text-[15px] leading-5">
        <Money minor={deal.amountMinor} currency={deal.currency} />
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {reason && s.stalled ? <Badge tone="danger">{reason}</Badge> : null}
        <NextAction iso={deal.nextStepAt} timeZone={timeZone} />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        <Avatar name={deal.owner.name} size="sm" />
        <span className="min-w-0 flex-1 truncate text-xs text-muted">{deal.owner.name}</span>
        <span
          className="inline-flex shrink-0 items-center gap-1 text-xs text-muted tabular"
          title={`Created ${formatDate(deal.createdAt, timeZone)}`}
        >
          <Hourglass aria-hidden className="size-3.5 text-subtle" />
          <span className="sr-only">Open for {daysLabel(s.ageDays)}</span>
          <span aria-hidden>{s.ageDays === 0 ? 'today' : `${s.ageDays}d`}</span>
        </span>
      </div>
      <label className="sr-only" htmlFor={`move-${deal.id}`}>
        Move {deal.title} to stage
      </label>
      <select
        id={`move-${deal.id}`}
        value={deal.stage.id}
        disabled={moving}
        onChange={(e) => onMove(deal, e.target.value)}
        className="mt-2 h-9 w-full min-w-0 rounded-sm border border-border-strong bg-surface-alt/60 px-2 text-xs text-ink hover:border-control focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
      >
        {columns.map((c) => (
          <option key={c.id} value={c.id}>
            {c.id === deal.stage.id ? `In ${c.name}` : `Move to ${c.name}`}
          </option>
        ))}
      </select>
    </li>
  );
}

interface BoardFilters {
  q: string;
  owner: string;
  currency: string;
  attention: boolean;
}

function FilterBar({
  filters,
  owners,
  currencies,
  onChange,
  showOwner,
}: {
  filters: BoardFilters;
  owners: Array<{ id: string; name: string }>;
  currencies: Currency[];
  onChange: (patch: Partial<BoardFilters>) => void;
  showOwner: boolean;
}) {
  return (
    <div
      role="search"
      aria-label="Filter the board"
      className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
    >
      <div className="relative min-w-0 sm:w-64">
        <label htmlFor="board-search" className="sr-only">
          Search the board
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
        />
        <input
          id="board-search"
          type="search"
          value={filters.q}
          maxLength={100}
          onChange={(e) => onChange({ q: e.target.value })}
          placeholder="Deal, lead or company"
          className={cn(controlCls, 'w-full pl-9 placeholder:text-muted')}
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:flex">
        {showOwner ? (
          <>
            <label htmlFor="board-owner" className="sr-only">
              Owner
            </label>
            <select
              id="board-owner"
              value={filters.owner}
              onChange={(e) => onChange({ owner: e.target.value })}
              className={controlCls}
            >
              <option value="">Every owner</option>
              {owners.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </select>
          </>
        ) : null}
        {currencies.length > 1 ? (
          <>
            <label htmlFor="board-currency" className="sr-only">
              Currency
            </label>
            <select
              id="board-currency"
              value={filters.currency}
              onChange={(e) => onChange({ currency: e.target.value })}
              className={controlCls}
            >
              <option value="">All currencies</option>
              {currencies.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </>
        ) : null}
      </div>
      <button
        type="button"
        aria-pressed={filters.attention}
        onClick={() => onChange({ attention: !filters.attention })}
        className={cn(
          'press inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium md:h-9',
          filters.attention
            ? 'border-attention bg-warning-soft text-warning'
            : 'border-control bg-surface text-ink hover:border-ink',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'size-2 rounded-full',
            filters.attention ? 'bg-attention' : 'border border-attention',
          )}
        />
        Needs attention only
      </button>
    </div>
  );
}

function Board({
  timeZone,
  onNew,
  showOwner,
}: {
  timeZone: string;
  onNew: () => void;
  showOwner: boolean;
}) {
  const board = useBoard();
  const move = useMoveDeal();
  const [params, setParams] = useSearchParams();
  const [over, setOver] = useState<string | null>(null);
  const [now] = useState(() => new Date());
  const filters: BoardFilters = {
    q: params.get('q') ?? '',
    owner: params.get('owner') ?? '',
    currency: params.get('currency') ?? '',
    attention: params.get('attention') === '1',
  };
  const preview = params.get('deal');
  const patch = (p: Partial<BoardFilters> & { deal?: string | null }) =>
    setParams(
      (prev) => {
        const n = new URLSearchParams(prev);
        for (const [k, v] of Object.entries(p)) {
          const value = typeof v === 'boolean' ? (v ? '1' : '') : (v ?? '');
          if (value) n.set(k, value);
          else n.delete(k);
        }
        return n;
      },
      { replace: true },
    );

  const columns = useMemo(() => board.data?.data.columns ?? [], [board.data]);
  const all = useMemo(() => columns.flatMap((c) => c.deals), [columns]);
  const owners = useMemo(() => {
    const m = new Map<string, string>();
    for (const d of all) m.set(d.owner.id, d.owner.name);
    return [...m].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name));
  }, [all]);
  const currencies = useMemo(() => [...new Set(all.map((d) => d.currency))].sort(), [all]);

  if (board.isPending) {
    return (
      <div className="flex gap-4 overflow-hidden" aria-hidden>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-80 w-[280px] shrink-0 rounded-lg" />
        ))}
      </div>
    );
  }
  if (board.isError) {
    const err = board.error instanceof ApiError ? board.error : null;
    return (
      <ErrorState
        message={board.error.message}
        requestId={err?.requestId}
        onRetry={() => board.refetch()}
        retrying={board.isFetching}
      />
    );
  }

  const onMove = (deal: DealSummary, stageId: string) => {
    if (stageId === deal.stage.id) return;
    const target = columns.find((c) => c.id === stageId);
    move.mutate(
      { id: deal.id, stageId, version: deal.version },
      {
        onSuccess: () =>
          toast.success(`Moved to ${target?.name ?? 'stage'}`, { description: deal.title }),
        onError: (err) =>
          toast.error(
            err instanceof ApiError && err.code === 'CONFLICT_STALE_VERSION'
              ? 'This deal changed elsewhere. The board is refreshed: try again.'
              : err.message,
          ),
      },
    );
  };

  if (all.length === 0 && columns.every((c) => c.count === 0)) {
    return (
      <div className="rounded-lg border border-border bg-surface">
        <EmptyState
          icon={<Briefcase aria-hidden className="size-5" />}
          title="No open deals"
          description="Create a deal from a lead to start tracking it through your pipeline."
          action={
            <Button onClick={onNew}>
              <Plus aria-hidden className="size-4" />
              New deal
            </Button>
          }
        />
      </div>
    );
  }

  const needle = filters.q.trim().toLowerCase();
  const filtering = !!(needle || filters.owner || filters.currency || filters.attention);
  const keep = (d: DealSummary) =>
    (!needle ||
      `${d.title} ${d.contact.fullName} ${d.contact.companyName ?? ''}`
        .toLowerCase()
        .includes(needle)) &&
    (!filters.owner || d.owner.id === filters.owner) &&
    (!filters.currency || d.currency === filters.currency) &&
    (!filters.attention || dealSignals(d, now).atRisk);
  const shown = filtering ? all.filter(keep) : all;
  const attentionCount = all.filter((d) => dealSignals(d, now).atRisk).length;
  const capped = columns.some((c) => c.count > c.deals.length);
  const colors = seqSteps(columns.length);
  const totalCount = columns.reduce((s, c) => s + c.count, 0);

  return (
    <section aria-label="Pipeline board" className="flex flex-col gap-4">
      <FilterBar
        filters={filters}
        owners={owners}
        currencies={currencies}
        onChange={patch}
        showOwner={showOwner && owners.length > 1}
      />
      <div
        aria-live="polite"
        className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-y border-border py-2.5 text-[13px] text-muted"
      >
        <span>
          <strong className="font-semibold text-ink tabular">
            {filtering ? shown.length : totalCount}
          </strong>{' '}
          {filtering ? `of ${totalCount} open deals shown` : 'open deals'}
        </span>
        <Totals
          totals={filtering ? sumByCurrency(shown) : sumByCurrency(all)}
          className="font-medium text-ink"
        />
        <span>
          <strong className="font-semibold text-warning tabular">{attentionCount}</strong> need
          attention
        </span>
        {filtering ? (
          <button
            type="button"
            onClick={() => patch({ q: '', owner: '', currency: '', attention: false })}
            className="font-medium text-primary-strong hover:underline"
          >
            Clear filters
          </button>
        ) : null}
      </div>
      <p className="-mt-2 text-xs text-muted">
        Drag cards between columns, or use each card’s stage menu. Needs attention means no next
        step or a next step in the past. Stalled adds no change for {STALL_DAYS}+ days.
        {capped ? ' The board loads up to 100 deals per stage: use the list for the rest.' : ''}
      </p>
      <div className="-mx-4 md:mx-0">
        <div
          role="region"
          aria-label="Pipeline stages, scroll sideways"
          // Keyboard users must be able to scroll this region (WCAG 2.1.1, axe scrollable-region-focusable).
          // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
          tabIndex={0}
          className="relative flex snap-x scroll-px-4 gap-3 overflow-x-auto px-4 pb-4 md:scroll-px-0 md:px-0"
        >
          {columns.map((col, i) => {
            const deals = filtering ? col.deals.filter(keep) : col.deals;
            return (
              <section
                key={col.id}
                aria-label={`${col.name}: ${col.count} deals`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setOver(col.id);
                }}
                onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
                onDrop={(e) => {
                  e.preventDefault();
                  setOver(null);
                  const id =
                    e.dataTransfer.getData('text/deal-id') || e.dataTransfer.getData('text/plain');
                  const deal = all.find((x) => x.id === id);
                  if (deal) onMove(deal, col.id);
                }}
                className={cn(
                  'flex w-[min(288px,84vw)] shrink-0 snap-start flex-col overflow-hidden rounded-lg border bg-surface-alt/70 transition-colors duration-150 xl:w-auto xl:min-w-[196px] xl:flex-1 xl:shrink',
                  over === col.id ? 'border-primary bg-primary-soft/50' : 'border-border',
                )}
              >
                <header className="border-b border-border bg-surface px-3 pb-2.5 pt-0">
                  <span
                    aria-hidden
                    className="-mx-3 mb-2.5 block h-[3px]"
                    style={{ background: colors[i] }}
                  />
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="truncate text-sm font-semibold text-ink">{col.name}</h2>
                    <span className="text-xs font-medium text-muted tabular">
                      {filtering ? `${deals.length} of ${col.count}` : col.count}
                    </span>
                  </div>
                  <Totals
                    totals={filtering ? sumByCurrency(deals) : col.totals}
                    className="mt-0.5 text-xs text-muted"
                  />
                </header>
                {deals.length === 0 ? (
                  <p className="m-3 rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-xs text-muted">
                    {filtering && col.deals.length > 0
                      ? 'No deals match the filters'
                      : 'No deals in this stage'}
                  </p>
                ) : (
                  <ul className="flex flex-col gap-2 p-2.5">
                    {deals.map((d) => (
                      <DealCard
                        key={d.id}
                        deal={d}
                        columns={columns}
                        timeZone={timeZone}
                        now={now}
                        onMove={onMove}
                        onPreview={(id) => patch({ deal: id })}
                        moving={move.isPending}
                      />
                    ))}
                    {col.count > col.deals.length ? (
                      <li className="text-center text-xs text-muted">
                        +{col.count - col.deals.length} more. Use the list view to see all.
                      </li>
                    ) : null}
                  </ul>
                )}
              </section>
            );
          })}
        </div>
      </div>
      <DealDrawer
        dealId={preview}
        columns={columns}
        timeZone={timeZone}
        onClose={() => patch({ deal: null })}
        onMove={onMove}
        moving={move.isPending}
      />
    </section>
  );
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const STATUS_TABS: Array<{ value: DealStatus | 'ALL'; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
  { value: 'ALL', label: 'All' },
];

function SignalCell({ deal, now }: { deal: DealSummary; now: Date }) {
  if (deal.status !== 'OPEN') return null;
  const s = dealSignals(deal, now);
  const reason = signalReason(s);
  return reason ? (
    <Badge tone={s.stalled ? 'danger' : 'warning'}>{reason}</Badge>
  ) : (
    <span className="text-muted">On track</span>
  );
}

function DealList({ timeZone }: { timeZone: string }) {
  const [params, setParams] = useSearchParams();
  const raw = params.get('status');
  const status: DealStatus | 'ALL' = raw === '' ? 'ALL' : ((raw ?? 'OPEN') as DealStatus);
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const [now] = useState(() => new Date());
  const deals = useDeals({
    page,
    limit: 25,
    ...(status !== 'ALL' ? { status } : {}),
    ...(params.get('q') ? { q: params.get('q')! } : {}),
  });
  const rows = deals.data?.data ?? [];
  const total = deals.data?.meta.total ?? 0;
  const setParam = (k: string, v: string | null) =>
    setParams((prev) => {
      const n = new URLSearchParams(prev);
      if (v === null) n.delete(k);
      else n.set(k, v);
      if (k !== 'page') n.delete('page');
      return n;
    });

  let body: ReactNode;
  if (deals.isPending)
    body = (
      <div className="p-4" aria-hidden>
        <Skeleton className="h-40" />
      </div>
    );
  else if (deals.isError)
    body = (
      <ErrorState
        message={deals.error.message}
        onRetry={() => deals.refetch()}
        retrying={deals.isFetching}
      />
    );
  else if (rows.length === 0)
    body = (
      <EmptyState
        icon={<Briefcase aria-hidden className="size-5" />}
        title="No deals here"
        description="Try another status or search."
      />
    );
  else
    body = (
      <>
        <table className="hidden w-full table-fixed border-collapse text-left md:table">
          <caption className="sr-only">Deals</caption>
          <thead>
            <tr className="border-b border-border bg-surface-alt text-xs text-muted">
              <th scope="col" className="w-[25%] px-5 py-2.5 font-medium">
                Deal
              </th>
              <th scope="col" className="w-[12%] px-3 py-2.5 font-medium">
                Stage
              </th>
              <th scope="col" className="w-[14%] px-3 py-2.5 text-right font-medium">
                Value
              </th>
              <th scope="col" className="w-[12%] px-3 py-2.5 font-medium">
                Owner
              </th>
              <th scope="col" className="w-[23%] px-3 py-2.5 font-medium">
                Next step
              </th>
              <th scope="col" className="w-[14%] px-5 py-2.5 font-medium">
                <span className="sr-only">Signal and </span>Age
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const s = dealSignals(d, now);
              return (
                <tr
                  key={d.id}
                  className="border-b border-border last:border-0 hover:bg-surface-alt/50"
                >
                  <td className="px-5 py-3">
                    <Link
                      to={`/app/deals/${d.id}`}
                      className="block truncate font-medium text-ink hover:text-primary-strong"
                    >
                      {d.title}
                    </Link>
                    <p className="truncate text-[13px] text-muted">
                      {d.contact.companyName
                        ? `${d.contact.fullName}, ${d.contact.companyName}`
                        : d.contact.fullName}
                    </p>
                  </td>
                  <td className="px-3 py-3">
                    {d.status === 'OPEN' ? (
                      <span className="truncate text-ink">{d.stage.name}</span>
                    ) : (
                      <DealStatusBadge status={d.status} />
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-medium text-ink">
                    <Money minor={d.amountMinor} currency={d.currency} />
                  </td>
                  <td className="truncate px-3 py-3 text-ink">{d.owner.name}</td>
                  <td className="px-3 py-3 text-[13px]">
                    {d.status === 'OPEN' ? (
                      <NextAction iso={d.nextStepAt} timeZone={timeZone} />
                    ) : (
                      <span className="text-muted">
                        Closed {d.closedAt ? formatDate(d.closedAt, timeZone) : ''}
                      </span>
                    )}
                  </td>
                  <td className="px-5 py-3 text-[13px]">
                    <div className="flex flex-col items-start gap-1">
                      {s.stalled ? <SignalCell deal={d} now={now} /> : null}
                      <span className="text-muted tabular">
                        {d.status === 'OPEN' ? `Open ${daysLabel(s.ageDays)}` : ''}
                      </span>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <ul className="md:hidden" aria-label="Deals">
          {rows.map((d) => {
            const s = dealSignals(d, now);
            const reason = d.status === 'OPEN' ? signalReason(s) : null;
            return (
              <li key={d.id} className="border-b border-border last:border-0">
                <Link to={`/app/deals/${d.id}`} className="flex flex-col gap-1 px-4 py-3.5">
                  <span className="flex items-start justify-between gap-2">
                    <span className="min-w-0 break-words font-medium text-ink">{d.title}</span>
                    <Money
                      minor={d.amountMinor}
                      currency={d.currency}
                      className="shrink-0 text-sm font-semibold text-ink"
                    />
                  </span>
                  <span className="text-[13px] text-muted">
                    {[
                      d.contact.fullName,
                      d.status === 'OPEN' ? d.stage.name : d.status === 'WON' ? 'Won' : 'Lost',
                      d.status === 'OPEN' ? `open ${daysLabel(s.ageDays)}` : null,
                    ]
                      .filter(Boolean)
                      .join(', ')}
                  </span>
                  {reason ? (
                    <span
                      className={cn(
                        'text-xs font-medium',
                        s.stalled ? 'text-danger' : 'text-warning',
                      )}
                    >
                      {reason}
                    </span>
                  ) : null}
                </Link>
              </li>
            );
          })}
        </ul>
      </>
    );

  return (
    <section
      aria-label="Deal list"
      className="overflow-hidden rounded-lg border border-border bg-surface"
    >
      <div className="flex flex-col gap-3 border-b border-border p-3 md:flex-row md:items-center md:justify-between md:px-4">
        <form
          role="search"
          className="relative w-full md:max-w-sm"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', q.trim() || null);
          }}
        >
          <label htmlFor="deal-search" className="sr-only">
            Search deals
          </label>
          <Search
            aria-hidden
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
          />
          <input
            id="deal-search"
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onBlur={() => setParam('q', q.trim() || null)}
            maxLength={100}
            placeholder="Search deal, lead or company"
            className={cn(
              controlCls,
              'h-11 w-full pl-9 text-[15px] placeholder:text-muted md:h-10 md:text-sm',
            )}
          />
        </form>
        <Segmented
          label="Filter by status"
          value={status}
          options={STATUS_TABS}
          onChange={(v) => setParam('status', v === 'OPEN' ? null : v === 'ALL' ? '' : v)}
        />
      </div>
      {body}
      {total > 25 ? (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between border-t border-border px-4 py-3 text-[13px] text-muted"
        >
          <span className="tabular">
            Page {page} of {Math.ceil(total / 25)}
          </span>
          <span className="flex gap-2">
            <Button
              size="sm"
              variant="secondary"
              disabled={page <= 1}
              onClick={() => setParam('page', String(page - 1))}
            >
              Previous
            </Button>
            <Button
              size="sm"
              variant="secondary"
              disabled={page * 25 >= total}
              onClick={() => setParam('page', String(page + 1))}
            >
              Next
            </Button>
          </span>
        </nav>
      ) : null}
    </section>
  );
}

export function DealsPage() {
  const { data: user } = useSession();
  const canSee = useCanSeeDeals();
  const [params, setParams] = useSearchParams();
  const [newOpen, setNewOpen] = useState(false);
  const view = params.get('view') === 'list' ? 'list' : 'board';
  if (!user) return null;
  const timeZone = user.agency.timezone;

  if (!canSee) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Deals are not part of your role"
        description="Ask your agency owner or admin if you need access to the sales pipeline."
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Deals"
        description={
          user.role === 'SALES'
            ? 'Your opportunities by stage. Values stay in their own currency.'
            : 'Every open opportunity in the agency. Values stay in their own currency.'
        }
        actions={
          <>
            <Segmented
              label="View"
              value={view}
              onChange={(v) => setParams(v === 'board' ? {} : { view: 'list' })}
              options={[
                {
                  value: 'board',
                  label: 'Board',
                  icon: <KanbanSquare aria-hidden className="size-4" />,
                },
                { value: 'list', label: 'List', icon: <List aria-hidden className="size-4" /> },
              ]}
            />
            <Button onClick={() => setNewOpen(true)}>
              <Plus aria-hidden className="size-4" />
              New deal
            </Button>
          </>
        }
      />
      <div className="mt-6">
        {view === 'board' ? (
          <Board
            timeZone={timeZone}
            onNew={() => setNewOpen(true)}
            showOwner={user.role !== 'SALES'}
          />
        ) : (
          <DealList timeZone={timeZone} />
        )}
      </div>
      <DealFormDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}
