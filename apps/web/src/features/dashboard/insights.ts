import { useQueries, useQuery } from '@tanstack/react-query';
import {
  canAny,
  CONTACT_SOURCES,
  type ApiSuccess,
  type ContactSource,
  type ContactSummary,
  type Currency,
  type DealSummary,
  type PageMeta,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { useSession } from '../auth/session';
import type { MonthPoint } from '../../components/charts/charts';

/**
 * Derived dashboard series. Each one is computed in the browser from existing list endpoints,
 * which apply the same role scoping as the list pages (a salesperson only counts their own).
 * No new API contract; sources and limits are listed in docs/design/redesign/02_DATA_SOURCES.md.
 */

const MAX_PAGES = 5; // 5 × 100 won deals; beyond that the chart says it is incomplete.

export interface WonByMonth {
  byCurrency: Array<{ currency: Currency; points: MonthPoint[] }>;
  /** True when more won deals exist than were fetched: the oldest months may be undercounted. */
  truncated: boolean;
  months: number;
}

function monthKey(iso: string, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date(iso));
  const y = parts.find((p) => p.type === 'year')!.value;
  const m = parts.find((p) => p.type === 'month')!.value;
  return `${y}-${m}`;
}

export function lastMonths(n: number, timeZone: string, now = new Date()) {
  const current = monthKey(now.toISOString(), timeZone);
  const [y, m] = current.split('-').map(Number) as [number, number];
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 15));
    return {
      key: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`,
      label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(d),
      longLabel: new Intl.DateTimeFormat('en-GB', {
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC',
      }).format(d),
    };
  });
}

/** Closed-won value per calendar month (agency timezone), per currency, for the last N months. */
export function bucketWon(
  deals: Array<Pick<DealSummary, 'closedAt' | 'amountMinor' | 'currency'>>,
  months: number,
  timeZone: string,
  now = new Date(),
) {
  const frame = lastMonths(months, timeZone, now);
  const keys = new Set(frame.map((f) => f.key));
  const per = new Map<Currency, Map<string, { minor: bigint; count: number }>>();
  for (const d of deals) {
    if (!d.closedAt) continue;
    const k = monthKey(d.closedAt, timeZone);
    if (!keys.has(k)) continue;
    const m = per.get(d.currency) ?? new Map();
    const cell = m.get(k) ?? { minor: 0n, count: 0 };
    cell.minor += BigInt(d.amountMinor);
    cell.count += 1;
    m.set(k, cell);
    per.set(d.currency, m);
  }
  return [...per.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([currency, m]) => ({
      currency,
      points: frame.map((f) => ({
        ...f,
        minor: m.get(f.key)?.minor ?? 0n,
        count: m.get(f.key)?.count ?? 0,
      })),
    }));
}

export function useWonByMonth(months = 6) {
  const { data: user } = useSession();
  const allowed = user ? canAny(user.role, ['deals.read.all', 'deals.read.own']) : false;
  return useQuery({
    queryKey: ['u', user?.id ?? 'anon', 'deals', 'won-by-month', months],
    enabled: allowed,
    staleTime: 60_000,
    queryFn: async ({ signal }): Promise<WonByMonth> => {
      const rows: DealSummary[] = [];
      let total = 0;
      for (let page = 1; page <= MAX_PAGES; page++) {
        const res = await api.get<ApiSuccess<DealSummary[], PageMeta>>(
          `/api/v1/deals?status=WON&limit=100&page=${page}`,
          { signal },
        );
        rows.push(...res.data);
        total = res.meta.total;
        if (rows.length >= total || res.data.length === 0) break;
      }
      const tz = user!.agency.timezone;
      return { byCurrency: bucketWon(rows, months, tz), truncated: rows.length < total, months };
    },
  });
}

export const SOURCE_LABELS: Record<ContactSource, string> = {
  REFERRAL: 'Referral',
  WEBSITE: 'Website',
  SOCIAL: 'Social',
  EVENT: 'Event',
  OUTBOUND: 'Outbound',
  PARTNER: 'Partner',
  OTHER: 'Other',
};

/**
 * Leads per source and how many of them became clients, from the contact list totals
 * (`meta.total` with `limit=1`). Archived contacts are excluded, as on the Leads page.
 */
export function useLeadSources(enabled: boolean) {
  const { data: user } = useSession();
  const results = useQueries({
    queries: CONTACT_SOURCES.flatMap((source) =>
      (['all', 'CUSTOMER'] as const).map((lifecycle) => ({
        queryKey: ['u', user?.id ?? 'anon', 'contacts', 'source-count', source, lifecycle],
        enabled,
        staleTime: 60_000,
        queryFn: ({ signal }: { signal: AbortSignal }) =>
          api.get<ApiSuccess<ContactSummary[], PageMeta>>(
            `/api/v1/contacts?limit=1&source=${source}${lifecycle === 'CUSTOMER' ? '&lifecycle=CUSTOMER' : ''}`,
            { signal },
          ),
      })),
    ),
  });
  const pending = results.some((r) => r.isPending);
  const error = results.find((r) => r.isError)?.error ?? null;
  const rows = CONTACT_SOURCES.map((source, i) => ({
    source,
    label: SOURCE_LABELS[source],
    leads: results[i * 2]?.data?.meta.total ?? 0,
    clients: results[i * 2 + 1]?.data?.meta.total ?? 0,
  }))
    .filter((r) => r.leads > 0)
    .sort((a, b) => b.leads - a.leads);
  return {
    pending,
    error,
    rows,
    refetch: () => results.forEach((r) => void r.refetch()),
  };
}
