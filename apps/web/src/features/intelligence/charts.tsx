/**
 * Intelligence charts (final signature release). Same rules as components/charts: one stated
 * question per chart, a real table or list behind every mark, text in ink tokens, money per
 * currency only, no chart library.
 */
import { useState, type ReactNode } from 'react';
import { formatMoney, type Currency } from '@clientflow/contracts';
import { cn } from '../../lib/format';
import { SEQ, SERIES } from '../../components/charts/charts';

// ---------------------------------------------------------------------------
// HeatTable: counts in a grid, shaded by size. The numbers are always printed.
// ---------------------------------------------------------------------------

export function HeatTable({
  caption,
  rowHeader,
  columns,
  rows,
}: {
  caption: string;
  rowHeader: string;
  columns: string[];
  rows: Array<{ id: string; label: ReactNode; values: number[] }>;
}) {
  const max = Math.max(1, ...rows.flatMap((r) => r.values));
  const shade = (v: number) => {
    if (v === 0) return { background: 'transparent', color: 'var(--color-muted)' };
    const i = Math.min(SEQ.length - 1, Math.ceil((v / max) * (SEQ.length - 1)));
    return { background: SEQ[i], color: i >= 3 ? '#FFFFFF' : 'var(--color-ink)' };
  };
  return (
    <div className="overflow-x-auto">
      <table className="w-full border-separate border-spacing-0.5 text-[13px]">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className="px-2 py-1.5 text-left text-xs font-medium text-muted">
              {rowHeader}
            </th>
            {columns.map((c) => (
              <th
                key={c}
                scope="col"
                className="px-2 py-1.5 text-center text-xs font-medium text-muted"
              >
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.id}>
              <th
                scope="row"
                className="max-w-40 truncate px-2 py-1.5 text-left font-medium text-ink"
              >
                {r.label}
              </th>
              {r.values.map((v, i) => (
                <td
                  key={columns[i]}
                  className="h-9 min-w-12 rounded-[4px] text-center tabular font-medium"
                  style={shade(v)}
                >
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PairedColumns: two measures per month for one currency (e.g. invoiced vs received).
// ---------------------------------------------------------------------------

export interface PairPoint {
  key: string;
  label: string;
  longLabel: string;
  a: bigint;
  b: bigint;
}

export function PairedColumns({
  currency,
  points,
  aLabel,
  bLabel,
}: {
  currency: Currency;
  points: PairPoint[];
  aLabel: string;
  bLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = points.reduce((m, p) => (p.a > m ? p.a : p.b > m ? p.b : m), 0n);
  const H = 132;
  const h = (v: bigint) =>
    max <= 0n || v <= 0n ? 0 : (Number((v * 1000n) / max) / 1000) * (H - 4);
  const money = (v: bigint) => formatMoney(v.toString(), currency);
  const active = hover === null ? null : points[hover];
  return (
    <div className="min-w-0">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{currency}</p>
        <ul className="flex flex-wrap gap-3 text-xs text-muted" aria-hidden>
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: SERIES[0] }} />
            {aLabel}
          </li>
          <li className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-[2px]" style={{ background: SERIES[1] }} />
            {bLabel}
          </li>
        </ul>
      </div>
      <p className="mb-1 min-h-5 text-xs text-muted" aria-hidden>
        {active
          ? `${active.longLabel}: ${aLabel.toLowerCase()} ${money(active.a)}, ${bLabel.toLowerCase()} ${money(active.b)}`
          : `Highest month ${money(max)}`}
      </p>
      <div
        aria-hidden
        className="grid items-end gap-1 border-b border-border-strong"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`, height: H }}
        onMouseLeave={() => setHover(null)}
      >
        {points.map((p, i) => (
          <div
            key={p.key}
            className={cn(
              'flex h-full items-end justify-center gap-[2px] rounded-t-[3px]',
              hover === i && 'bg-surface-alt',
            )}
            onMouseEnter={() => setHover(i)}
          >
            <span
              className="w-[38%] max-w-3 rounded-t-[3px]"
              style={{ height: h(p.a), background: SERIES[0] }}
            />
            <span
              className="w-[38%] max-w-3 rounded-t-[3px]"
              style={{ height: h(p.b), background: SERIES[1] }}
            />
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="mt-1 grid gap-1 text-center text-[11px] text-muted"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((p, i) => (
          <span key={p.key} className={cn(i % 2 === 1 && points.length > 8 && 'max-sm:invisible')}>
            {p.label}
          </span>
        ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>
            {aLabel} and {bLabel.toLowerCase()} per month in {currency}
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">{aLabel}</th>
              <th scope="col">{bLabel}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.key}>
                <th scope="row">{p.longLabel}</th>
                <td>{money(p.a)}</td>
                <td>{money(p.b)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month labels
// ---------------------------------------------------------------------------

export function monthLabels(key: string) {
  const d = new Date(`${key}-01T00:00:00Z`);
  return {
    label: d.toLocaleString('en-GB', { month: 'short', timeZone: 'UTC' }),
    longLabel: d.toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
  };
}

/** "EGP 12,000 · USD 400" style list without combining currencies. */
export function MoneyList({
  totals,
  empty = '—',
}: {
  totals: Record<string, string>;
  empty?: string;
}) {
  const entries = Object.entries(totals).filter(([, v]) => v !== '0');
  if (entries.length === 0) return <span className="text-muted">{empty}</span>;
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5">
      {entries.map(([c, v]) => (
        <span key={c} className="tabular whitespace-nowrap">
          {formatMoney(v, c as Currency)}
        </span>
      ))}
    </span>
  );
}

// ---------------------------------------------------------------------------
// StageFunnel: open deals per stage, in pipeline order. Count and value sit above the bar,
// never on it, so long amounts cannot collide with the mark.
// ---------------------------------------------------------------------------

export function StageFunnel({
  stages,
}: {
  stages: Array<{ id: string; name: string; open: number; totals: Record<string, string> }>;
}) {
  const max = Math.max(1, ...stages.map((s) => s.open));
  return (
    <ol className="flex flex-col gap-3.5" aria-label="Open deals per stage, in pipeline order">
      {stages.map((s) => (
        <li key={s.id} className="min-w-0">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
            <span className="font-medium text-ink">{s.name}</span>
            <span className="text-muted">
              <span className="tabular font-semibold text-ink">{s.open}</span>{' '}
              {s.open === 1 ? 'deal' : 'deals'}
              {s.open > 0 ? (
                <>
                  {', '}
                  <MoneyList totals={s.totals} empty="" />
                </>
              ) : null}
            </span>
          </div>
          <div aria-hidden className="mt-1.5 h-2.5 rounded-full bg-surface-alt">
            <div
              className="h-full rounded-full"
              style={{
                width: `${(s.open / max) * 100}%`,
                minWidth: s.open > 0 ? 8 : 0,
                background: SERIES[0],
              }}
            />
          </div>
        </li>
      ))}
    </ol>
  );
}

// ---------------------------------------------------------------------------
// MonthBars: one measure per month for one currency, in HTML so text never scales.
// ---------------------------------------------------------------------------

export function MonthBars({
  currency,
  points,
  measure,
}: {
  currency: Currency;
  points: Array<{ key: string; label: string; longLabel: string; minor: bigint }>;
  measure: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const max = points.reduce((m, p) => (p.minor > m ? p.minor : m), 0n);
  const H = 112;
  const h = (v: bigint) =>
    max <= 0n || v <= 0n ? 0 : (Number((v * 1000n) / max) / 1000) * (H - 4);
  const money = (v: bigint) => formatMoney(v.toString(), currency);
  const active = hover === null ? null : points[hover];
  return (
    <div className="min-w-0">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2 text-xs">
        <span className="font-semibold text-ink">{currency}</span>
        <span aria-hidden className="text-muted tabular">
          {active ? `${active.longLabel}: ${money(active.minor)}` : `Highest month ${money(max)}`}
        </span>
      </div>
      <div
        aria-hidden
        className="grid items-end gap-1 border-b border-border-strong"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))`, height: H }}
        onMouseLeave={() => setHover(null)}
      >
        {points.map((p, i) => (
          <div
            key={p.key}
            className="flex h-full items-end justify-center"
            onMouseEnter={() => setHover(i)}
          >
            <span
              className="w-3/5 max-w-6 rounded-t-[3px]"
              style={{
                height: Math.max(h(p.minor), 1.5),
                background: p.minor > 0n ? SERIES[0] : 'var(--color-border-strong)',
                opacity: hover === null || hover === i ? 1 : 0.4,
              }}
            />
          </div>
        ))}
      </div>
      <div
        aria-hidden
        className="mt-1 grid gap-1 text-center text-[11px] text-muted"
        style={{ gridTemplateColumns: `repeat(${points.length}, minmax(0, 1fr))` }}
      >
        {points.map((p, i) => (
          <span key={p.key} className={cn(i % 2 === 1 && points.length > 8 && 'max-sm:invisible')}>
            {p.label}
          </span>
        ))}
      </div>
      <div className="sr-only">
        <table>
          <caption>
            {measure} per month in {currency}
          </caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">{measure}</th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.key}>
                <th scope="row">{p.longLabel}</th>
                <td>{money(p.minor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
