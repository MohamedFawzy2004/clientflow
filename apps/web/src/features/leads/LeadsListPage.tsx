import { useEffect, useId, useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import {
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  SearchX,
  ShieldAlert,
  Users,
  X,
} from 'lucide-react';
import {
  CONTACT_SOURCE_LABELS,
  type ContactLifecycle,
  type ContactSummary,
} from '@clientflow/contracts';
import { ApiError } from '../../lib/api';
import { cn, formatDate, isPast, relativeDay } from '../../lib/format';
import { Avatar } from '../../components/ui/brand';
import { Button } from '../../components/ui/button';
import { Badge, EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { useSession } from '../auth/session';
import { AddLeadDialog } from './AddLeadDialog';
import { useLeads } from './api';

const PAGE_SIZE = 25;
const LIFECYCLE_FILTERS: Array<{ value: ContactLifecycle | ''; label: string }> = [
  { value: '', label: 'All' },
  { value: 'LEAD', label: 'Leads' },
  { value: 'CUSTOMER', label: 'Customers' },
];

export function NextAction({ iso, timeZone }: { iso: string | null; timeZone: string }) {
  if (!iso) return <span className="text-muted">No next step</span>;
  const overdue = isPast(iso);
  return overdue ? (
    <Badge tone="warning" icon={<CalendarClock aria-hidden className="size-3.5" />}>
      Overdue · {relativeDay(iso, new Date(), timeZone)}
    </Badge>
  ) : (
    <span className="inline-flex items-center gap-1.5 text-text">
      <CalendarClock aria-hidden className="size-3.5 text-muted" />
      <span className="tabular">{formatDate(iso, timeZone)}</span>
      <span className="text-muted">· {relativeDay(iso, new Date(), timeZone)}</span>
    </span>
  );
}

function LifecycleBadge({ lifecycle }: { lifecycle: ContactLifecycle }) {
  return lifecycle === 'CUSTOMER' ? (
    <Badge tone="success">Customer</Badge>
  ) : (
    <Badge tone="info">Lead</Badge>
  );
}

function useDebounced<T>(value: T, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

function LeadRowSkeleton() {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-4 last:border-0 md:px-5">
      <Skeleton className="size-9 rounded-full" />
      <div className="flex flex-1 flex-col gap-2">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-28" />
      </div>
      <Skeleton className="hidden h-3.5 w-24 md:block" />
      <Skeleton className="hidden h-6 w-20 rounded-full lg:block" />
    </li>
  );
}

function LeadTable({ rows, timeZone }: { rows: ContactSummary[]; timeZone: string }) {
  return (
    <table className="w-full table-fixed border-collapse text-left">
      <caption className="sr-only">Leads</caption>
      <thead>
        <tr className="border-b border-border bg-surface-alt/60 text-xs font-semibold leading-4 text-muted">
          <th scope="col" className="w-[26%] px-5 py-3 font-semibold">
            Name
          </th>
          <th scope="col" className="w-[18%] px-3 py-3 font-semibold">
            Company
          </th>
          <th scope="col" className="hidden w-[11%] px-3 py-3 font-semibold xl:table-cell">
            Source
          </th>
          <th scope="col" className="w-[14%] px-3 py-3 font-semibold">
            Owner
          </th>
          <th scope="col" className="w-[19%] px-3 py-3 font-semibold">
            Next action
          </th>
          <th
            scope="col"
            className="hidden w-[12%] whitespace-nowrap px-5 py-3 text-right font-semibold lg:table-cell"
          >
            Added
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr
            key={c.id}
            className="group border-b border-border transition-colors last:border-0 hover:bg-surface-alt/50"
          >
            <td className="px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <Avatar name={c.fullName} />
                <div className="min-w-0">
                  <Link
                    to={`/app/leads/${c.id}`}
                    className="block truncate font-medium text-text after:absolute after:inset-0 group-hover:text-primary-strong"
                  >
                    {c.fullName}
                  </Link>
                  <p className="truncate text-[13px] text-muted">
                    {c.email ?? c.phone ?? 'No contact details'}
                  </p>
                </div>
              </div>
            </td>
            <td className="truncate px-3 py-3 text-text">
              {c.companyName ?? <span className="text-muted">—</span>}
            </td>
            <td className="hidden truncate px-3 py-3 text-muted xl:table-cell">
              {c.source ? CONTACT_SOURCE_LABELS[c.source] : '—'}
            </td>
            <td className="truncate px-3 py-3 text-text">{c.owner.name}</td>
            <td className="px-3 py-3">
              <NextAction iso={c.nextActionAt} timeZone={timeZone} />
            </td>
            <td className="hidden whitespace-nowrap px-5 py-3 text-right text-muted tabular lg:table-cell">
              {formatDate(c.createdAt, timeZone)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function LeadCards({ rows, timeZone }: { rows: ContactSummary[]; timeZone: string }) {
  return (
    <ul aria-label="Leads">
      {rows.map((c) => (
        <li key={c.id} className="border-b border-border last:border-0">
          <Link to={`/app/leads/${c.id}`} className="flex gap-3 px-4 py-4 active:bg-surface-alt">
            <Avatar name={c.fullName} />
            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <p className="min-w-0 break-words font-medium leading-5 text-text">{c.fullName}</p>
                <LifecycleBadge lifecycle={c.lifecycle} />
              </div>
              <p className="mt-0.5 truncate text-[13px] text-muted">
                {[c.companyName, c.owner.name].filter(Boolean).join(' · ')}
              </p>
              <div className="mt-2 text-[13px]">
                <NextAction iso={c.nextActionAt} timeZone={timeZone} />
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function LeadsListPage() {
  const { data: user } = useSession();
  const timeZone = user?.agency.timezone ?? 'Africa/Cairo';
  const [params, setParams] = useSearchParams();
  const [addOpen, setAddOpen] = useState(false);
  const searchId = useId();

  const page = Math.max(1, Number(params.get('page')) || 1);
  const lifecycle = (params.get('lifecycle') as ContactLifecycle | null) ?? undefined;
  const [searchInput, setSearchInput] = useState(params.get('q') ?? '');
  const q = useDebounced(searchInput.trim(), 300);

  // Filters live in the URL, so back navigation and shared links keep the same view.
  useEffect(() => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        if (q) next.set('q', q);
        else next.delete('q');
        if ((prev.get('q') ?? '') !== q) next.delete('page');
        return next;
      },
      { replace: true },
    );
  }, [q, setParams]);

  const setFilter = (key: 'lifecycle' | 'page', value: string | null) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'page') next.delete('page');
      return next;
    });

  const query = useLeads({ page, limit: PAGE_SIZE, q: q || undefined, lifecycle });
  const rows = query.data?.data ?? [];
  const meta = query.data?.meta;
  const total = meta?.total ?? 0;
  const hasFilters = Boolean(q || lifecycle);
  const firstShown = total === 0 ? 0 : (page - 1) * PAGE_SIZE + 1;
  const lastShown = Math.min(page * PAGE_SIZE, total);
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const error = query.error instanceof ApiError ? query.error : null;

  const resetFilters = () => {
    setSearchInput('');
    setParams({}, { replace: true });
  };

  let body: React.ReactNode;
  if (query.isPending) {
    body = (
      <ul aria-hidden>
        {Array.from({ length: 6 }, (_, i) => (
          <LeadRowSkeleton key={i} />
        ))}
      </ul>
    );
  } else if (error?.status === 403) {
    body = (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="Leads are not part of your role"
        description="Ask your agency owner or admin if you need access to sales records."
      />
    );
  } else if (query.isError) {
    body = (
      <ErrorState
        title="We could not load leads"
        message={query.error.message}
        requestId={error?.requestId}
        onRetry={() => query.refetch()}
        retrying={query.isFetching}
      />
    );
  } else if (rows.length === 0 && hasFilters) {
    body = (
      <EmptyState
        icon={<SearchX aria-hidden className="size-5" />}
        title="No leads match these filters"
        description={
          q
            ? `Nothing found for “${q}”. Try a shorter search or clear the filters.`
            : 'Try a different filter.'
        }
        action={
          <Button variant="secondary" onClick={resetFilters}>
            Clear filters
          </Button>
        }
      />
    );
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={<Users aria-hidden className="size-5" />}
        title="No leads yet"
        description="Add your first lead to start tracking follow-ups. Leads you add are assigned to you."
        action={
          <Button onClick={() => setAddOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Add lead
          </Button>
        }
      />
    );
  } else {
    body = (
      <div
        className={cn('transition-opacity', query.isPlaceholderData && 'opacity-60')}
        aria-busy={query.isFetching}
      >
        <div className="hidden md:block [&_tr]:relative">
          <LeadTable rows={rows} timeZone={timeZone} />
        </div>
        <div className="md:hidden">
          <LeadCards rows={rows} timeZone={timeZone} />
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-[26px] font-semibold leading-8 tracking-[-0.02em] text-text md:text-[32px] md:leading-[38px]">
            Leads
          </h1>
          <p className="mt-1 text-sm text-muted">
            {user?.role === 'SALES' ? 'Leads assigned to you.' : 'Every lead in your agency.'}
          </p>
        </div>
        <div className="hidden sm:block">
          <Button onClick={() => setAddOpen(true)}>
            <Plus aria-hidden className="size-4" />
            Add lead
          </Button>
        </div>
      </div>

      <section
        aria-label="Leads list"
        className="mt-6 overflow-hidden rounded-lg border border-border bg-surface shadow-card"
      >
        <div className="flex flex-col gap-3 border-b border-border p-3 md:flex-row md:items-center md:justify-between md:px-4">
          <div className="relative w-full md:max-w-sm">
            <label htmlFor={searchId} className="sr-only">
              Search leads
            </label>
            <Search
              aria-hidden
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            />
            <input
              id={searchId}
              type="search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              maxLength={100}
              placeholder="Search name, email, company or phone"
              className="h-11 w-full rounded-md border border-border-strong bg-surface pl-9 pr-9 text-[15px] placeholder:text-muted focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 md:h-10 md:text-sm"
            />
            {searchInput ? (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-sm text-muted hover:text-text"
              >
                <X aria-hidden className="size-4" />
              </button>
            ) : null}
          </div>
          <div
            role="group"
            aria-label="Filter by lifecycle"
            className="flex max-w-full gap-1 overflow-x-auto rounded-md bg-surface-alt p-1"
          >
            {LIFECYCLE_FILTERS.map((f) => {
              const active = (lifecycle ?? '') === f.value;
              return (
                <button
                  key={f.label}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setFilter('lifecycle', f.value || null)}
                  className={cn(
                    'h-9 shrink-0 rounded-sm px-3.5 text-[13px] font-medium transition-colors md:h-8',
                    active
                      ? 'bg-surface text-text shadow-[0_1px_2px_rgba(16,36,60,0.1)]'
                      : 'text-muted hover:text-text',
                  )}
                >
                  {f.label}
                </button>
              );
            })}
          </div>
        </div>

        {body}

        {meta && total > 0 ? (
          <nav
            aria-label="Pagination"
            className="flex items-center justify-between gap-3 border-t border-border px-4 py-3 text-[13px] text-muted"
          >
            <p aria-live="polite" className="tabular">
              {firstShown}–{lastShown} of {total.toLocaleString()}
            </p>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setFilter('page', String(page - 1))}
                aria-label="Previous page"
              >
                <ChevronLeft aria-hidden className="size-4" />
                <span className="hidden sm:inline">Previous</span>
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages}
                onClick={() => setFilter('page', String(page + 1))}
                aria-label="Next page"
              >
                <span className="hidden sm:inline">Next</span>
                <ChevronRight aria-hidden className="size-4" />
              </Button>
            </div>
          </nav>
        ) : null}
      </section>

      {/* One-hand mobile CTA (spec §7.4.17). */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-surface/95 p-3 backdrop-blur sm:hidden">
        <Button size="lg" className="w-full" onClick={() => setAddOpen(true)}>
          <Plus aria-hidden className="size-4" />
          Add lead
        </Button>
      </div>

      <AddLeadDialog open={addOpen} onOpenChange={setAddOpen} />
    </>
  );
}
