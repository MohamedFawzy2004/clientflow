import { useState } from 'react';
import { Link } from 'react-router';
import { can, canAny, formatMoney, type Currency } from '@clientflow/contracts';
import { Segmented } from '../../components/ui/page';
import { Skeleton } from '../../components/ui/feedback';
import { cn, todayIn } from '../../lib/format';
import { useSession } from '../auth/session';
import { useFinanceReport } from '../invoices/api';
import {
  useDeliveryIntelligence,
  useFinanceIntelligence,
  useSalesIntelligence,
} from '../intelligence/api';

type Period = '1' | '3';
type Money = Record<string, bigint>;

interface Tile {
  key: string;
  label: string;
  /** One line per currency, or a single count. */
  values: string[];
  /** Comparison with the previous period of the same length, or a plain note. */
  note: string;
  tone?: 'up' | 'down' | 'risk' | 'warn';
  to: string;
  definition: string;
}

const add = (m: Money, currency: string, v: bigint) => {
  m[currency] = (m[currency] ?? 0n) + v;
};
const moneyLines = (m: Money) =>
  Object.entries(m)
    .filter(([, v]) => v !== 0n)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([c, v]) => formatMoney(v.toString(), c as Currency));

/** Change from `before` to `now` in whole percent, from integers; null when there was nothing. */
export function changePercent(now: bigint, before: bigint) {
  if (before === 0n) return null;
  return Number(((now - before) * 100n) / (before < 0n ? -before : before));
}

/** Sum the last `n` points and the `n` before them, per currency. */
export function periodSums<T>(points: T[], n: number, pick: (p: T) => Array<[string, bigint]>) {
  const now: Money = {};
  const before: Money = {};
  points.slice(-n).forEach((p) => pick(p).forEach(([c, v]) => add(now, c, v)));
  points.slice(-2 * n, -n).forEach((p) => pick(p).forEach(([c, v]) => add(before, c, v)));
  return { now, before };
}

function compareMoney(now: Money, before: Money, period: string): Pick<Tile, 'note' | 'tone'> {
  const currencies = Object.keys(now).filter((c) => now[c] !== 0n);
  if (currencies.length !== 1) {
    const prev = moneyLines(before);
    return {
      note: prev.length ? `Previous ${period}: ${prev.join(', ')}` : `Nothing the ${period} before`,
    };
  }
  const c = currencies[0]!;
  const pct = changePercent(now[c]!, before[c] ?? 0n);
  if (pct === null) return { note: `Nothing in ${c} the ${period} before` };
  return {
    note: `${pct >= 0 ? '+' : ''}${pct}% on the previous ${period}`,
    tone: pct > 0 ? 'up' : pct < 0 ? 'down' : undefined,
  };
}

/**
 * How many tiles a role gets, from its permissions alone, so the loading grid has the final
 * shape and the page below does not jump when the data arrives (layout shift).
 */
export function expectedTiles(p: {
  sales: boolean;
  delivery: boolean;
  invoices: boolean;
  financeView: boolean;
}) {
  return (
    (p.sales ? 3 : 0) +
    (p.invoices ? (p.sales ? 1 : 2) : 0) +
    (p.financeView ? 2 : 0) +
    (p.delivery ? 2 : 0)
  );
}

/** Grid columns for a strip of N tiles: no hole in the last row at any width. */
const gridClass = (count: number) =>
  cn(
    'grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border min-[420px]:grid-cols-2',
    count % 3 === 0 ? 'lg:grid-cols-3' : 'lg:grid-cols-4',
  );
const cellSpan = (count: number, i: number) =>
  count % 2 === 1 && i === count - 1 && 'min-[420px]:col-span-2 lg:col-span-1';

/**
 * The executive strip: the agency's position in one row, each tile from a permission-scoped
 * endpoint (ADR-072 and the finance report), with its rule stated and a link to the records
 * behind it. A role sees only the tiles its permissions can read.
 */
export function ExecutiveStrip() {
  const { data: user } = useSession();
  const [period, setPeriod] = useState<Period>('1');
  const role = user?.role;
  const sales = !!role && can(role, 'dashboard.sales');
  const delivery = !!role && can(role, 'delivery.work');
  const invoices = !!role && canAny(role, ['invoices.read.all', 'invoices.read.project']);
  const financeView = !!role && can(role, 'finance.view');
  const s = useSalesIntelligence(12);
  const d = useDeliveryIntelligence();
  const f = useFinanceIntelligence(12);
  const r = useFinanceReport({}, financeView);
  if (!user || (!sales && !delivery && !invoices)) return null;

  const n = Number(period);
  const label = n === 1 ? 'month' : '3 months';
  const span = n === 1 ? 'This month' : 'Last 3 months';
  const today = todayIn(user.agency.timezone);
  const tiles: Tile[] = [];
  const expected = expectedTiles({ sales, delivery, invoices, financeView });
  const pending =
    (sales && !s.data) ||
    (delivery && !d.data) ||
    (invoices && !f.data) ||
    (financeView && !r.data);

  if (sales && s.data) {
    const open: Money = {};
    let openCount = 0;
    for (const st of s.data.stages) {
      openCount += st.open;
      for (const [c, v] of Object.entries(st.totals)) add(open, c, BigInt(v));
    }
    tiles.push({
      key: 'pipeline',
      label: 'Open pipeline',
      values: moneyLines(open).length ? moneyLines(open) : ['No open value'],
      note: `${openCount} open deal${openCount === 1 ? '' : 's'}`,
      to: '/app/deals',
      definition: 'Value of open deals, per currency. Not revenue until won and invoiced.',
    });
    const won = periodSums(s.data.monthly, n, (m) =>
      Object.entries(m.wonTotals).map(([c, v]) => [c, BigInt(v)]),
    );
    const wonCount = s.data.monthly.slice(-n).reduce((a, m) => a + m.won, 0);
    const lostCount = s.data.monthly.slice(-n).reduce((a, m) => a + m.lost, 0);
    tiles.push({
      key: 'won',
      label: `Won, ${span.toLowerCase()}`,
      values: moneyLines(won.now).length ? moneyLines(won.now) : ['Nothing won'],
      ...compareMoney(won.now, won.before, label),
      to: '/app/deals?view=insights',
      definition: 'Deals closed won in the period, by the month they closed.',
    });
    tiles.push({
      key: 'winrate',
      label: 'Win rate',
      values: [
        wonCount + lostCount === 0
          ? '—'
          : `${Math.round((wonCount * 100) / (wonCount + lostCount))}%`,
      ],
      note: `${wonCount} won, ${lostCount} lost, ${span.toLowerCase()}`,
      to: '/app/deals?view=insights',
      definition: 'Won divided by won plus lost, closed in the period. Open deals do not count.',
    });
  }

  if (invoices && f.data) {
    // Received and invoiced come one series per currency, so each series sums on its own.
    const received: Money = {};
    const receivedBefore: Money = {};
    const invoiced: Money = {};
    for (const series of f.data.monthly) {
      const a = periodSums(series.points, n, (p) => [[series.currency, BigInt(p.receivedMinor)]]);
      const b = periodSums(series.points, n, (p) => [[series.currency, BigInt(p.invoicedMinor)]]);
      Object.assign(received, a.now);
      Object.assign(receivedBefore, a.before);
      Object.assign(invoiced, b.now);
    }
    tiles.push({
      key: 'received',
      label: `Received, ${span.toLowerCase()}`,
      values: moneyLines(received).length ? moneyLines(received) : ['Nothing received'],
      ...compareMoney(received, receivedBefore, label),
      to: '/app/reports/finance',
      definition: 'Payments minus reversals, by the date the money arrived. Cash, not invoiced.',
    });
    if (!sales) {
      tiles.push({
        key: 'invoiced',
        label: `Invoiced, ${span.toLowerCase()}`,
        values: moneyLines(invoiced).length ? moneyLines(invoiced) : ['Nothing invoiced'],
        note: 'Issued invoices, including VAT',
        to: '/app/invoices',
        definition: 'Issued, non-void invoices by issue date, on projects you can read.',
      });
    }
  }

  if (financeView && r.data) {
    const outstanding: Money = {};
    const overdue: Money = {};
    let overdueCount = 0;
    for (const t of r.data.data.totals) {
      add(outstanding, t.currency, BigInt(t.outstandingMinor));
      add(overdue, t.currency, BigInt(t.overdue.balanceMinor));
      overdueCount += t.overdue.count;
    }
    tiles.push({
      key: 'outstanding',
      label: 'Outstanding',
      values: moneyLines(outstanding).length ? moneyLines(outstanding) : ['Nothing owed'],
      note: overdueCount
        ? `${moneyLines(overdue).join(', ')} overdue on ${overdueCount} invoice${overdueCount === 1 ? '' : 's'}`
        : 'Nothing overdue',
      tone: overdueCount ? 'risk' : undefined,
      to: '/app/reports/finance',
      definition: 'Issued invoices minus payments received, per currency, all dates.',
    });
  }

  if (financeView && f.data?.profitability) {
    const margin: Money = {};
    const budget: Money = {};
    let live = 0;
    let uncosted = 0;
    for (const p of f.data.profitability) {
      if (p.state === 'COMPLETED') continue;
      live += 1;
      if (p.costCompletenessPercent < 100) uncosted += 1;
      add(margin, p.currency, BigInt(p.estimatedMarginMinor));
      add(budget, p.currency, BigInt(p.budgetMinor));
    }
    const pct = Object.keys(margin)
      .filter((c) => budget[c])
      .sort()
      .map((c) => `${Number((margin[c]! * 1000n) / budget[c]!) / 10}% of the ${c} budget`);
    tiles.push({
      key: 'margin',
      label: 'Estimated margin',
      values: moneyLines(margin).length ? moneyLines(margin) : ['No budgets yet'],
      note: `${pct.join(', ') || 'No budget'}, ${live} open project${live === 1 ? '' : 's'}${
        uncosted ? `; ${uncosted} with time not yet costed` : ''
      }`,
      tone: uncosted ? 'warn' : undefined,
      to: '/app/reports/finance',
      definition:
        'Budget minus logged time at dated cost rates, open projects only. An estimate, not profit.',
    });
  }

  if (delivery && d.data) {
    const projects = d.data.projects;
    const active = projects.filter((p) => p.state === 'ACTIVE').length;
    const late = projects.filter((p) => p.dueOn && p.dueOn < today).length;
    const pastDue = projects.reduce((a, p) => a + p.tasks.overdue, 0);
    const blocked = projects.reduce((a, p) => a + p.tasks.blocked, 0);
    tiles.push({
      key: 'projects',
      label: 'Active projects',
      values: [String(active)],
      note: `${projects.length} open in all, ${late} past the due date`,
      tone: late ? 'risk' : undefined,
      to: '/app/delivery',
      definition: 'Projects in the Active state. Open adds planned and on-hold projects.',
    });
    tiles.push({
      key: 'risks',
      label: 'Delivery risks',
      values: [String(pastDue + blocked)],
      note: `${pastDue} past-due task${pastDue === 1 ? '' : 's'}, ${blocked} blocked`,
      tone: pastDue + blocked ? 'risk' : undefined,
      to: '/app/delivery',
      definition:
        'Open tasks past their due date plus tasks marked blocked, on projects you work on.',
    });
  }

  return (
    <section aria-labelledby="exec-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="exec-title" className="text-[15px] font-[620] text-ink">
            Position
          </h2>
          <p className="text-[13px] text-muted">
            Each figure links to the records behind it. Money is never added across currencies.
          </p>
        </div>
        <Segmented
          label="Compare period"
          value={period}
          onChange={setPeriod}
          options={[
            { value: '1', label: 'Month' },
            { value: '3', label: '3 months' },
          ]}
        />
      </div>
      {pending ? (
        // Same grid and line heights as a loaded tile: label, figure, note, two-line rule.
        <div aria-hidden className={gridClass(expected)}>
          {Array.from({ length: expected }, (_, i) => (
            <div
              key={i}
              className={cn('flex flex-col bg-surface px-4 py-3.5', cellSpan(expected, i))}
            >
              <span className="flex h-4 items-center">
                <Skeleton className="h-3 w-24" />
              </span>
              <span className="flex mt-1 h-7 items-center">
                <Skeleton className="h-5 w-32" />
              </span>
              <span className="flex mt-1 h-4 items-center">
                <Skeleton className="h-3 w-28" />
              </span>
              <span className="flex mt-2 h-4 items-center">
                <Skeleton className="h-3 w-full" />
              </span>
              <span className="flex h-4 items-center">
                <Skeleton className="h-3 w-2/3" />
              </span>
            </div>
          ))}
        </div>
      ) : (
        <dl className={gridClass(tiles.length)}>
          {tiles.map((t, i) => (
            <div
              key={t.key}
              className={cn(
                'group relative flex min-w-0 flex-col bg-surface px-4 py-3.5',
                cellSpan(tiles.length, i),
              )}
            >
              <dt className="flex items-center justify-between gap-2 text-xs text-muted">
                <Link
                  to={t.to}
                  className="after:absolute after:inset-0 hover:text-primary-strong focus-visible:outline-none group-focus-within:text-primary-strong"
                >
                  {t.label}
                </Link>
              </dt>
              <dd className="mt-1 flex flex-col">
                {t.values.map((v, i) => (
                  <span
                    key={v}
                    className={cn(
                      'figure truncate text-ink',
                      i === 0 ? 'text-[22px] leading-7' : 'text-[15px] leading-5 text-text',
                    )}
                  >
                    {v}
                  </span>
                ))}
              </dd>
              <dd
                className={cn(
                  'mt-1 text-xs',
                  t.tone === 'up'
                    ? 'text-success'
                    : t.tone === 'down' || t.tone === 'risk'
                      ? 'text-danger'
                      : t.tone === 'warn'
                        ? 'text-warning'
                        : 'text-muted',
                )}
              >
                {t.note}
              </dd>
              <dd className="mt-2 text-xs leading-4 text-muted">{t.definition}</dd>
              <span
                aria-hidden
                className="pointer-events-none absolute inset-0 ring-2 ring-inset ring-primary opacity-0 group-focus-within:opacity-100"
              />
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}
