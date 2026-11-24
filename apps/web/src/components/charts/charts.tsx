/**
 * ClientFlow chart kit (docs/design/redesign/02_DATA_SOURCES.md lists the query behind every use).
 *
 * Rules carried from the dataviz method:
 * - Every chart answers one stated business question (the `question` prop renders as its caption).
 * - Money is never summed across currencies: multi-currency data becomes one row or one small
 *   multiple per currency.
 * - Identity never relies on colour alone: every mark has a text label or a table equivalent.
 * - Thin marks, 2 px gaps, recessive axes, text in ink tokens (never the series colour).
 * - Hand-built SVG/HTML: no chart library, so nothing extra to load (design-system doc §Charts).
 */
import { useId, useState, type ReactNode } from 'react';
import { formatMoney, type Currency } from '@clientflow/contracts';
import { cn } from '../../lib/format';

export const SERIES = ['#0B8A78', '#7464C7', '#B07A12', '#B04A6E'] as const;
export const SEQ = ['#A5D6B5', '#6DBB9F', '#2F9B86', '#0B7A6A', '#145A50', '#142D2A'] as const;

/** Picks n ordered steps from the mint→forest ramp (for ordered categories such as stages). */
export function seqSteps(n: number): string[] {
  if (n <= 1) return [SEQ[3]];
  return Array.from(
    { length: n },
    (_, i) => SEQ[Math.round((i * (SEQ.length - 1)) / (n - 1))] ?? SEQ[3],
  );
}

export function ChartFrame({
  question,
  note,
  children,
  className,
  actions,
}: {
  question: string;
  note?: ReactNode;
  children: ReactNode;
  className?: string;
  actions?: ReactNode;
}) {
  return (
    <figure className={cn('m-0 min-w-0', className)}>
      <figcaption className="sr-only">{question}</figcaption>
      {children}
      {note || actions ? (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-muted">
          {note ? <p className="min-w-0">{note}</p> : <span />}
          {actions}
        </div>
      ) : null}
    </figure>
  );
}

// ---------------------------------------------------------------------------
// StageFlow: ordered pipeline stages as one proportional ribbon.
// Question: "Where is open work sitting in the pipeline right now?"
// ---------------------------------------------------------------------------

export interface StageDatum {
  id: string;
  name: string;
  count: number;
  totals: Partial<Record<Currency, string>>;
  /** Optional sub-count shown under the stage, e.g. deals needing attention. */
  flagged?: number;
}

export function StageFlow({
  stages,
  flaggedLabel = 'need attention',
  onSelect,
  selected,
}: {
  stages: StageDatum[];
  flaggedLabel?: string;
  onSelect?: (id: string | null) => void;
  selected?: string | null;
}) {
  const total = stages.reduce((s, x) => s + x.count, 0);
  const colors = seqSteps(stages.length);
  // Empty stages keep a neutral sliver (not the stage colour) so the order stays readable without implying value.
  const weight = (c: number) => (total === 0 ? 1 : Math.max(c, total * 0.04));
  const sum = stages.reduce((s, x) => s + weight(x.count), 0);
  return (
    <div className="min-w-0">
      <div
        aria-hidden
        className="flex h-3 w-full origin-left gap-[2px] overflow-hidden rounded-sm [animation:cf-grow-x_700ms_var(--ease-out)_both]"
      >
        {stages.map((s, i) => (
          <span
            key={s.id}
            className={cn(
              'chart-mark h-full first:rounded-l-sm last:rounded-r-sm transition-opacity',
              selected && selected !== s.id && 'opacity-30',
            )}
            style={{
              width: `${(weight(s.count) / sum) * 100}%`,
              background: s.count === 0 ? 'var(--color-border-strong)' : colors[i],
            }}
          />
        ))}
      </div>
      <ol
        className="mt-3 grid gap-x-4 gap-y-3"
        style={{ gridTemplateColumns: `repeat(auto-fit, minmax(min(132px, 100%), 1fr))` }}
      >
        {stages.map((s, i) => {
          const entries = Object.entries(s.totals) as Array<[Currency, string]>;
          const body = (
            <>
              <span className="flex items-center gap-1.5 text-xs text-muted">
                <span
                  aria-hidden
                  className="size-2 shrink-0 rounded-[2px]"
                  style={{ background: colors[i] }}
                />
                <span className="truncate">{s.name}</span>
              </span>
              <span className="figure mt-0.5 block text-[26px] leading-8">{s.count}</span>
              <span className="block text-xs leading-[18px] text-muted tabular">
                {entries.length === 0
                  ? 'No value'
                  : entries.map(([c, v]) => (
                      <span key={c} className="block truncate">
                        {formatMoney(v, c)}
                      </span>
                    ))}
              </span>
              {s.flagged ? (
                <span className="mt-1 block text-xs font-medium text-warning">
                  {s.flagged} {flaggedLabel}
                </span>
              ) : null}
            </>
          );
          return (
            <li key={s.id} className="min-w-0">
              {onSelect ? (
                <button
                  type="button"
                  aria-pressed={selected === s.id}
                  onClick={() => onSelect(selected === s.id ? null : s.id)}
                  className={cn(
                    'press -m-1.5 block w-[calc(100%+12px)] rounded-md p-1.5 text-left hover:bg-surface-alt',
                    selected === s.id && 'bg-primary-soft hover:bg-primary-soft',
                  )}
                >
                  {body}
                </button>
              ) : (
                body
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

// ---------------------------------------------------------------------------
// BarList: ranked horizontal bars inside a real table (screen readers read the table).
// ---------------------------------------------------------------------------

export interface BarRow {
  id: string;
  label: ReactNode;
  value: number;
  /** Shown instead of the raw number. */
  display?: ReactNode;
  /** Optional overlay share of `value` (e.g. customers among leads), drawn darker. */
  part?: number;
  partLabel?: string;
  href?: string;
}

export function BarList({
  rows,
  caption,
  valueHeader,
  partHeader,
  color = SERIES[0],
  partColor = '#142D2A',
  empty = 'Nothing to show yet.',
}: {
  rows: BarRow[];
  caption: string;
  valueHeader: string;
  partHeader?: string;
  color?: string;
  partColor?: string;
  empty?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  if (rows.length === 0) return <p className="py-6 text-sm text-muted">{empty}</p>;
  return (
    <table className="w-full table-fixed border-collapse text-sm">
      <caption className="sr-only">{caption}</caption>
      <thead className="sr-only">
        <tr>
          <th scope="col">Item</th>
          <th scope="col">{valueHeader}</th>
          {partHeader ? <th scope="col">{partHeader}</th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.id} className="group">
            <th scope="row" className="w-[38%] py-1.5 pr-3 text-left align-middle font-normal">
              <span className="block truncate text-text">{r.label}</span>
            </th>
            <td className="py-1.5 align-middle">
              <div className="flex items-center gap-3">
                <div className="relative h-2.5 min-w-0 flex-1 rounded-r-[3px] bg-surface-alt">
                  <span
                    aria-hidden
                    className="chart-mark absolute inset-y-0 left-0 rounded-r-[3px]"
                    style={{ width: `${(r.value / max) * 100}%`, background: color }}
                  />
                  {r.part ? (
                    <span
                      aria-hidden
                      className="chart-mark absolute inset-y-0 left-0 rounded-r-[3px]"
                      style={{ width: `${(r.part / max) * 100}%`, background: partColor }}
                    />
                  ) : null}
                </div>
                <span className="w-16 shrink-0 text-right font-medium text-ink tabular">
                  {r.display ?? r.value}
                </span>
              </div>
            </td>
            {partHeader ? (
              <td className="w-20 py-1.5 pl-2 text-right align-middle text-xs text-muted tabular">
                {r.part ?? 0}
                <span className="sr-only"> {r.partLabel ?? partHeader}</span>
              </td>
            ) : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// SplitMeter: two counts of one whole (won vs lost), labelled at both ends.
// ---------------------------------------------------------------------------

export function SplitMeter({
  left,
  right,
  leftLabel,
  rightLabel,
}: {
  left: number;
  right: number;
  leftLabel: string;
  rightLabel: string;
}) {
  const total = left + right;
  return (
    <div>
      <div aria-hidden className="flex h-2 gap-[2px] overflow-hidden rounded-sm bg-surface-alt">
        {total > 0 ? (
          <>
            <span className="chart-mark bg-primary" style={{ width: `${(left / total) * 100}%` }} />
            <span
              className="chart-mark bg-border-strong"
              style={{ width: `${(right / total) * 100}%` }}
            />
          </>
        ) : null}
      </div>
      <p className="mt-1.5 flex justify-between text-xs text-muted tabular">
        <span>
          {left} {leftLabel}
        </span>
        <span>
          {right} {rightLabel}
        </span>
      </p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// MonthlyColumns: one small multiple per currency, one column per month.
// Question: "How much did we win each month?" (closed-won value by close month)
// ---------------------------------------------------------------------------

export interface MonthPoint {
  key: string; // YYYY-MM
  label: string; // "Nov"
  longLabel: string; // "November 2026"
  minor: bigint;
  count: number;
}

export function MonthlyColumns({
  currency,
  points,
  color = SERIES[0],
}: {
  currency: Currency;
  points: MonthPoint[];
  color?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const tableId = useId();
  const max = points.reduce((m, p) => (p.minor > m ? p.minor : m), 0n);
  const W = 320;
  const H = 120;
  const gap = 8;
  const bw = (W - gap * (points.length - 1)) / points.length;
  const h = (v: bigint) => (max === 0n ? 0 : Number((v * 1000n) / max) / 1000) * (H - 4);
  const active = hover === null ? null : points[hover];
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-xs font-medium text-muted">{currency}</p>
        <p className="text-xs text-muted tabular" aria-live="polite">
          {active
            ? `${active.longLabel}: ${formatMoney(active.minor.toString(), currency)} from ${active.count} ${active.count === 1 ? 'deal' : 'deals'}`
            : `Peak month ${formatMoney(max.toString(), currency)}`}
        </p>
      </div>
      <svg
        viewBox={`0 0 ${W} ${H + 20}`}
        className="mt-2 h-auto w-full overflow-visible"
        role="img"
        aria-label={`Won value per month in ${currency}. Exact figures in the table below.`}
        aria-describedby={tableId}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="0" x2={W} y1={H} y2={H} stroke="#D6CFC3" strokeWidth="1" />
        {points.map((p, i) => {
          const x = i * (bw + gap);
          const bh = h(p.minor);
          return (
            <g key={p.key} onMouseEnter={() => setHover(i)}>
              {/* Hit target taller than the mark. */}
              <rect x={x} y={0} width={bw} height={H} fill="transparent" />
              {bh > 0 ? (
                <path
                  className="chart-mark"
                  d={`M${x},${H} V${H - bh + 4} Q${x},${H - bh} ${x + 4},${H - bh} H${x + bw - 4} Q${x + bw},${H - bh} ${x + bw},${H - bh + 4} V${H} Z`}
                  fill={color}
                  opacity={hover === null || hover === i ? 1 : 0.35}
                />
              ) : (
                <rect x={x} y={H - 1.5} width={bw} height={1.5} fill="#D6CFC3" />
              )}
              <text
                x={x + bw / 2}
                y={H + 15}
                textAnchor="middle"
                className="fill-muted text-[11px]"
              >
                {p.label}
              </text>
            </g>
          );
        })}
      </svg>
      <details className="mt-1">
        <summary className="cursor-pointer text-xs font-medium text-primary-strong">
          Show as table
        </summary>
        <table id={tableId} className="mt-2 w-full text-xs">
          <caption className="sr-only">Won value per month, {currency}</caption>
          <thead>
            <tr className="text-left text-muted">
              <th scope="col" className="py-1 font-medium">
                Month
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Deals won
              </th>
              <th scope="col" className="py-1 text-right font-medium">
                Value
              </th>
            </tr>
          </thead>
          <tbody>
            {points.map((p) => (
              <tr key={p.key} className="border-t border-border">
                <th scope="row" className="py-1 text-left font-normal">
                  {p.longLabel}
                </th>
                <td className="py-1 text-right tabular">{p.count}</td>
                <td className="py-1 text-right tabular">
                  {formatMoney(p.minor.toString(), currency)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </div>
  );
}

// ---------------------------------------------------------------------------
// DayHeat: workload per day for the next N days (sequential, one hue).
// Question: "Which days are follow-ups piling up on?"
// ---------------------------------------------------------------------------

export interface DayCell {
  date: string; // YYYY-MM-DD
  weekday: string; // Mon
  day: string; // 24
  count: number;
  isToday?: boolean;
}

export function DayHeat({ days, caption }: { days: DayCell[]; caption: string }) {
  const max = Math.max(1, ...days.map((d) => d.count));
  const shade = (c: number) => {
    if (c === 0) return { bg: '#F3F1EC', fg: '#5A6763' };
    const step = Math.min(SEQ.length - 1, Math.ceil((c / max) * 4));
    return { bg: SEQ[step] ?? SEQ[3], fg: step >= 2 ? '#FFFFFF' : '#142D2A' };
  };
  // Seven columns on phones (two weeks wrap into two rows), one row of fourteen from 640 px.
  return (
    <ol aria-label={caption} className="grid grid-cols-7 gap-[3px] sm:grid-cols-14">
      {days.map((d) => {
        const { bg, fg } = shade(d.count);
        return (
          <li key={d.date} className="min-w-0 text-center">
            <span aria-hidden className="block text-[10px] leading-4 text-muted">
              {d.weekday}
            </span>
            <span
              className={cn(
                'chart-mark mt-0.5 grid h-9 place-items-center rounded-[4px] text-xs font-semibold tabular',
                d.isToday && 'ring-2 ring-ink ring-offset-1',
              )}
              style={{ background: bg, color: fg }}
              title={`${d.date}: ${d.count} follow-up${d.count === 1 ? '' : 's'}`}
            >
              <span aria-hidden>{d.count || ''}</span>
              <span className="sr-only">
                {`${d.weekday} ${d.day}: ${d.count} follow-up${d.count === 1 ? '' : 's'}${d.isToday ? ' (today)' : ''}`}
              </span>
            </span>
            <span aria-hidden className="mt-0.5 block text-[10px] leading-4 text-muted">
              {d.day}
            </span>
          </li>
        );
      })}
    </ol>
  );
}
