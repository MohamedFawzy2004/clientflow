import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import { Briefcase, KanbanSquare, List, Plus, Search, ShieldAlert } from 'lucide-react';
import type { BoardColumn, DealStatus, DealSummary } from '@clientflow/contracts';
import { toast } from 'sonner';
import { ApiError } from '../../lib/api';
import { cn, formatDate } from '../../lib/format';
import { Avatar } from '../../components/ui/brand';
import { Button } from '../../components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { DealStatusBadge, Money, Totals } from '../../components/sales/sales-ui';
import { useSession } from '../auth/session';
import { NextAction } from '../leads/LeadsListPage';
import { useBoard, useCanSeeDeals, useDeals, useMoveDeal } from './api';
import { DealFormDialog } from './DealFormDialog';

function DealCard({
  deal,
  columns,
  timeZone,
  onMove,
  moving,
}: {
  deal: DealSummary;
  columns: BoardColumn[];
  timeZone: string;
  onMove: (deal: DealSummary, stageId: string) => void;
  moving: boolean;
}) {
  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('text/deal-id', deal.id);
        e.dataTransfer.effectAllowed = 'move';
      }}
      className="cursor-grab rounded-md border border-border bg-surface p-3 shadow-[0_1px_2px_rgba(16,36,60,0.06)] active:cursor-grabbing"
    >
      <Link
        to={`/app/deals/${deal.id}`}
        className="block break-words text-sm font-medium text-text hover:text-primary-strong"
      >
        {deal.title}
      </Link>
      <p className="mt-0.5 truncate text-xs text-muted">
        {deal.contact.companyName ?? deal.contact.fullName}
      </p>
      <p className="mt-2 text-sm font-semibold text-text">
        <Money minor={deal.amountMinor} currency={deal.currency} />
      </p>
      <div className="mt-2 text-xs">
        <NextAction iso={deal.nextStepAt} timeZone={timeZone} />
      </div>
      <div className="mt-3 flex items-center gap-2 border-t border-border pt-2.5">
        <Avatar name={deal.owner.name} size="sm" />
        <label className="sr-only" htmlFor={`move-${deal.id}`}>
          Move {deal.title} to stage
        </label>
        <select
          id={`move-${deal.id}`}
          value={deal.stage.id}
          disabled={moving}
          onChange={(e) => onMove(deal, e.target.value)}
          className="h-9 min-w-0 flex-1 rounded-sm border border-border bg-surface px-2 text-xs text-text focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15"
        >
          {columns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.id === deal.stage.id ? `In ${c.name}` : `Move to ${c.name}`}
            </option>
          ))}
        </select>
      </div>
    </li>
  );
}

function Board({ timeZone, onNew }: { timeZone: string; onNew: () => void }) {
  const board = useBoard();
  const move = useMoveDeal();
  const [over, setOver] = useState<string | null>(null);

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
  const { columns } = board.data.data;
  const all = columns.flatMap((c) => c.deals);

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
      <div className="rounded-lg border border-border bg-surface shadow-card">
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

  return (
    <section aria-label="Pipeline board" className="-mx-4 md:mx-0">
      <p className="mb-2 px-4 text-xs text-muted md:px-0">
        Drag cards between columns, or use each card’s stage menu. Scroll sideways to see every
        stage.
      </p>
      <div
        role="region"
        aria-label="Pipeline stages, scroll sideways"
        // Keyboard users must be able to scroll this region (WCAG 2.1.1, axe scrollable-region-focusable).
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex
        tabIndex={0}
        className="relative flex snap-x scroll-px-4 gap-4 overflow-x-auto px-4 pb-4 md:scroll-px-0 md:px-0"
      >
        {columns.map((col) => (
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
              const deal = all.find((d) => d.id === e.dataTransfer.getData('text/deal-id'));
              if (deal) onMove(deal, col.id);
            }}
            className={cn(
              'flex w-[min(280px,82vw)] shrink-0 snap-start flex-col rounded-lg border bg-surface-alt/60 transition-colors xl:w-auto xl:min-w-[200px] xl:flex-1 xl:shrink',
              over === col.id ? 'border-primary bg-primary-soft/40' : 'border-border',
            )}
          >
            <header className="border-b border-border px-3 py-2.5">
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-semibold text-text">{col.name}</h2>
                <span className="rounded-full bg-surface px-2 text-xs font-medium text-muted ring-1 ring-border tabular">
                  {col.count}
                </span>
              </div>
              <Totals totals={col.totals} className="mt-0.5 text-xs text-muted" />
            </header>
            {col.deals.length === 0 ? (
              <p className="m-3 rounded-md border border-dashed border-border-strong px-3 py-6 text-center text-xs text-muted">
                No deals in this stage
              </p>
            ) : (
              <ul className="flex flex-col gap-2 p-3">
                {col.deals.map((d) => (
                  <DealCard
                    key={d.id}
                    deal={d}
                    columns={columns}
                    timeZone={timeZone}
                    onMove={onMove}
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
        ))}
      </div>
    </section>
  );
}

const STATUS_TABS: Array<{ value: DealStatus | ''; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'WON', label: 'Won' },
  { value: 'LOST', label: 'Lost' },
  { value: '', label: 'All' },
];

function DealList({ timeZone }: { timeZone: string }) {
  const [params, setParams] = useSearchParams();
  const status = (params.get('status') ?? 'OPEN') as DealStatus | '';
  const page = Math.max(1, Number(params.get('page')) || 1);
  const [q, setQ] = useState(params.get('q') ?? '');
  const deals = useDeals({
    page,
    limit: 25,
    ...(status ? { status } : {}),
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

  let body: React.ReactNode;
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
            <tr className="border-b border-border bg-surface-alt/60 text-xs font-semibold text-muted">
              <th scope="col" className="w-[30%] px-5 py-3 font-semibold">
                Deal
              </th>
              <th scope="col" className="w-[15%] px-3 py-3 font-semibold">
                Stage
              </th>
              <th scope="col" className="w-[16%] px-3 py-3 text-right font-semibold">
                Value
              </th>
              <th scope="col" className="w-[15%] px-3 py-3 font-semibold">
                Owner
              </th>
              <th scope="col" className="w-[24%] px-5 py-3 font-semibold">
                Next step
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr
                key={d.id}
                className="border-b border-border last:border-0 hover:bg-surface-alt/50"
              >
                <td className="px-5 py-3">
                  <Link
                    to={`/app/deals/${d.id}`}
                    className="block truncate font-medium text-text hover:text-primary-strong"
                  >
                    {d.title}
                  </Link>
                  <p className="truncate text-[13px] text-muted">{d.contact.fullName}</p>
                </td>
                <td className="px-3 py-3">
                  {d.status === 'OPEN' ? (
                    <span className="truncate text-text">{d.stage.name}</span>
                  ) : (
                    <DealStatusBadge status={d.status} />
                  )}
                </td>
                <td className="px-3 py-3 text-right font-medium">
                  <Money minor={d.amountMinor} currency={d.currency} />
                </td>
                <td className="truncate px-3 py-3 text-text">{d.owner.name}</td>
                <td className="px-5 py-3 text-[13px]">
                  {d.status === 'OPEN' ? (
                    <NextAction iso={d.nextStepAt} timeZone={timeZone} />
                  ) : (
                    <span className="text-muted">
                      Closed {d.closedAt ? formatDate(d.closedAt, timeZone) : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="md:hidden" aria-label="Deals">
          {rows.map((d) => (
            <li key={d.id} className="border-b border-border last:border-0">
              <Link to={`/app/deals/${d.id}`} className="flex flex-col gap-1 px-4 py-3.5">
                <span className="flex items-start justify-between gap-2">
                  <span className="min-w-0 break-words font-medium text-text">{d.title}</span>
                  <Money
                    minor={d.amountMinor}
                    currency={d.currency}
                    className="text-sm font-semibold"
                  />
                </span>
                <span className="text-[13px] text-muted">
                  {[
                    d.contact.fullName,
                    d.status === 'OPEN' ? d.stage.name : d.status === 'WON' ? 'Won' : 'Lost',
                  ].join(' · ')}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </>
    );

  return (
    <section
      aria-label="Deal list"
      className="overflow-hidden rounded-lg border border-border bg-surface shadow-card"
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
            className="h-11 w-full rounded-md border border-border-strong bg-surface pl-9 pr-3 text-[15px] placeholder:text-muted focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 md:h-10 md:text-sm"
          />
        </form>
        <div
          role="group"
          aria-label="Filter by status"
          className="flex gap-1 rounded-md bg-surface-alt p-1"
        >
          {STATUS_TABS.map((t) => (
            <button
              key={t.label}
              type="button"
              aria-pressed={status === t.value}
              onClick={() => setParam('status', t.value === 'OPEN' ? null : t.value || '')}
              className={cn(
                'h-9 shrink-0 rounded-sm px-3.5 text-[13px] font-medium md:h-8',
                status === t.value
                  ? 'bg-surface text-text shadow-[0_1px_2px_rgba(16,36,60,0.1)]'
                  : 'text-muted hover:text-text',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Deals
          </h1>
          <p className="mt-1 text-sm text-muted">
            {user.role === 'SALES'
              ? 'Your opportunities by stage.'
              : 'Every open opportunity in your agency.'}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="View" className="flex gap-1 rounded-md bg-surface-alt p-1">
            {(['board', 'list'] as const).map((v) => (
              <button
                key={v}
                type="button"
                aria-pressed={view === v}
                onClick={() => setParams(v === 'board' ? {} : { view: 'list' })}
                className={cn(
                  'inline-flex h-9 items-center gap-1.5 rounded-sm px-3 text-[13px] font-medium md:h-8',
                  view === v
                    ? 'bg-surface text-text shadow-[0_1px_2px_rgba(16,36,60,0.1)]'
                    : 'text-muted hover:text-text',
                )}
              >
                {v === 'board' ? (
                  <KanbanSquare aria-hidden className="size-4" />
                ) : (
                  <List aria-hidden className="size-4" />
                )}
                {v === 'board' ? 'Board' : 'List'}
              </button>
            ))}
          </div>
          <Button onClick={() => setNewOpen(true)}>
            <Plus aria-hidden className="size-4" />
            New deal
          </Button>
        </div>
      </div>
      <div className="mt-6">
        {view === 'board' ? (
          <Board timeZone={timeZone} onNew={() => setNewOpen(true)} />
        ) : (
          <DealList timeZone={timeZone} />
        )}
      </div>
      <DealFormDialog open={newOpen} onOpenChange={setNewOpen} />
    </>
  );
}
