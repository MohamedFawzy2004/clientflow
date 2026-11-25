import {
  CONTACT_SOURCE_LABELS,
  type ContactSource,
  type Currency,
  type SalesIntelligence,
} from '@clientflow/contracts';
import type { MonthPoint } from '../../components/charts/charts';
import { useSalesIntelligence } from '../intelligence/api';

/**
 * Dashboard series derived from GET /insights/sales, the same scoped read the executive strip
 * already makes (one cached query, no extra request). The server applies the deal scope to the
 * monthly won figures and the contact scope to the lead sources, so a salesperson only counts
 * their own. Sources and limits are listed in docs/design/redesign/02_DATA_SOURCES.md.
 */

/** The strip and these panels share one query key: keep the window identical. */
const SALES_WINDOW = 12;

export interface WonByMonth {
  byCurrency: Array<{ currency: Currency; points: MonthPoint[] }>;
  months: number;
}

/** "2026-11" → short and long labels. Month keys are already in the agency time zone. */
function labelsFor(key: string) {
  const [y, m] = key.split('-').map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1, 15));
  return {
    key,
    label: new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(d),
    longLabel: new Intl.DateTimeFormat('en-GB', {
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC',
    }).format(d),
  };
}

/**
 * Closed-won value and count per month for the last `months` months, one series per currency.
 * Currencies are never summed together; a currency appears when it won anything in the window.
 */
export function wonByMonth(monthly: SalesIntelligence['monthly'], months: number): WonByMonth {
  const frame = monthly.slice(-months);
  const currencies = [...new Set(frame.flatMap((m) => Object.keys(m.wonTotals)))].sort();
  return {
    months,
    byCurrency: currencies.map((currency) => ({
      currency: currency as Currency,
      points: frame.map((m) => ({
        ...labelsFor(m.month),
        minor: BigInt(m.wonTotals[currency] ?? '0'),
        count: m.wonCounts[currency] ?? 0,
      })),
    })),
  };
}

export function useWonByMonth(months = 6) {
  const q = useSalesIntelligence(SALES_WINDOW);
  return {
    isPending: q.isPending,
    error: q.error,
    refetch: q.refetch,
    data: q.data ? wonByMonth(q.data.monthly, months) : undefined,
  };
}

export interface LeadSourceRow {
  source: ContactSource;
  label: string;
  leads: number;
  clients: number;
}

export function leadSourceRows(rows: SalesIntelligence['leadSources']): LeadSourceRow[] {
  return rows.map((r) => ({
    source: r.source as ContactSource,
    label: CONTACT_SOURCE_LABELS[r.source as ContactSource] ?? r.source,
    leads: r.leads,
    clients: r.clients,
  }));
}

/** Leads per source and how many of them became clients (archived contacts excluded). */
export function useLeadSources() {
  const q = useSalesIntelligence(SALES_WINDOW);
  return {
    isPending: q.isPending,
    error: q.error,
    refetch: q.refetch,
    rows: q.data ? leadSourceRows(q.data.leadSources) : [],
  };
}
