/**
 * Gantt-style timeline and task dependency map. Both draw stored dates and stored links only:
 * a bar needs two stored dates, a marker needs one, and nothing is invented to fill a gap.
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Badge } from '../../components/ui/feedback';
import { cn } from '../../lib/format';

const DAY = 86_400_000;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
export const shortDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export interface TimelineMarker {
  id: string;
  date: string;
  label: string;
  kind: 'milestone' | 'task';
  state: 'done' | 'open' | 'late' | 'blocked';
}

export interface TimelineRow {
  id: string;
  label: ReactNode;
  /** Plain text name, for the table equivalent. */
  name: string;
  href?: string;
  sub?: ReactNode;
  start: string | null;
  end: string | null;
  /** How the bar's dates were decided, read out in the table. */
  barNote?: string;
  markers: TimelineMarker[];
}

const MARKER_FILL: Record<TimelineMarker['state'], string> = {
  done: 'var(--color-primary)',
  open: '#FFFFFF',
  late: 'var(--color-danger, #B3261E)',
  blocked: 'var(--color-violet)',
};

const STATE_RANK: Record<TimelineMarker['state'], number> = {
  late: 3,
  blocked: 2,
  open: 1,
  done: 0,
};

export interface MarkerCluster {
  id: string;
  /** Date the cluster is drawn at (the earliest of its markers). */
  date: string;
  markers: TimelineMarker[];
}

/**
 * Markers that would be drawn on top of each other (same day, or closer than `gap` of the range)
 * become one cluster, drawn once with a count; its tooltip and the table list every item.
 */
export function clusterMarkers(
  markers: TimelineMarker[],
  span: number,
  gap = 0.015,
): MarkerCluster[] {
  const sorted = [...markers].sort((a, b) => ms(a.date) - ms(b.date) || a.id.localeCompare(b.id));
  const out: MarkerCluster[] = [];
  for (const m of sorted) {
    const last = out.at(-1);
    if (last && (ms(m.date) - ms(last.markers.at(-1)!.date)) / span < gap) last.markers.push(m);
    else out.push({ id: m.id, date: m.date, markers: [m] });
  }
  return out;
}

/** The cluster takes the most urgent state of its items: past due, then blocked, open, done. */
export const clusterState = (c: MarkerCluster) =>
  c.markers.reduce(
    (w, m) => (STATE_RANK[m.state] > STATE_RANK[w] ? m.state : w),
    'done' as TimelineMarker['state'],
  );

export function Timeline({
  rows,
  today,
  caption,
  labelHeader,
}: {
  rows: TimelineRow[];
  today: string;
  caption: string;
  labelHeader: string;
}) {
  const dates = rows.flatMap((r) => [r.start, r.end, ...r.markers.map((m) => m.date)]);
  const known = [...dates.filter((d): d is string => !!d), today].map(ms);
  const from = Math.min(...known) - 7 * DAY;
  const to = Math.max(...known) + 7 * DAY;
  const span = Math.max(DAY, to - from);
  const x = (d: string) => `${(((ms(d) - from) / span) * 100).toFixed(3)}%`;

  // Month ticks: the first of each month inside the range.
  const ticks: string[] = [];
  const first = new Date(from);
  for (
    let t = Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + 1, 1);
    t < to;
    t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1)
  )
    ticks.push(iso(t));
  const everyOther = ticks.length > 8;

  return (
    <div>
      {/* The drawing scrolls sideways on narrow screens, so its scroller takes focus (arrow keys
          scroll it). The drawing itself is hidden from assistive tech; the table below carries it. */}
      <div
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling area must take focus (axe scrollable-region-focusable)
        tabIndex={0}
        role="region"
        aria-label={`${caption}, drawing`}
        className="overflow-x-auto rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <div aria-hidden className="min-w-[640px]">
          <div className="grid grid-cols-[minmax(9rem,14rem)_1fr] border-b border-border text-[11px] text-muted">
            <span className="px-3 py-1.5">{labelHeader}</span>
            <div className="relative h-7">
              {ticks.map((t, i) => (
                <span
                  key={t}
                  className={cn(
                    'absolute top-1.5 -translate-x-1/2 whitespace-nowrap',
                    ((everyOther && i % 2 === 1) || (ms(t) - from) / span > 0.95) && 'invisible',
                  )}
                  style={{ left: x(t) }}
                >
                  {new Date(`${t}T00:00:00Z`).toLocaleDateString('en-GB', {
                    month: 'short',
                    year: t.endsWith('-01-01') ? '2-digit' : undefined,
                    timeZone: 'UTC',
                  })}
                </span>
              ))}
            </div>
          </div>
          <div className="relative">
            {rows.map((r) => (
              <div
                key={r.id}
                className="grid grid-cols-[minmax(9rem,14rem)_1fr] items-center border-b border-border/70 last:border-b-0"
              >
                <div className="min-w-0 px-3 py-2">
                  <p className="truncate text-[13px] font-medium text-ink">{r.label}</p>
                  {r.sub ? <p className="truncate text-xs text-muted">{r.sub}</p> : null}
                </div>
                <div className="relative h-11">
                  {ticks.map((t) => (
                    <span
                      key={t}
                      className="absolute inset-y-0 w-px bg-border/70"
                      style={{ left: x(t) }}
                    />
                  ))}
                  <span className="absolute inset-y-0 w-0.5 bg-ink/70" style={{ left: x(today) }} />
                  {r.start && r.end && ms(r.end) >= ms(r.start) ? (
                    <span
                      className="absolute top-1/2 h-3 -translate-y-1/2 rounded-[4px] bg-seq-3"
                      style={{
                        left: x(r.start),
                        width: `${(((ms(r.end) - ms(r.start)) / span) * 100).toFixed(3)}%`,
                        minWidth: 4,
                      }}
                    />
                  ) : null}
                  {clusterMarkers(r.markers, span).map((c) => {
                    const m = c.markers[0]!;
                    if (c.markers.length === 1) {
                      return (
                        <span
                          key={c.id}
                          title={`${m.label}, ${shortDay(m.date)}`}
                          className={cn(
                            'absolute top-1/2 -translate-x-1/2 -translate-y-1/2 border-2',
                            m.kind === 'milestone'
                              ? 'size-3.5 rotate-45 rounded-[2px] border-ink'
                              : 'size-2.5 rounded-full border-ink/80',
                          )}
                          style={{ left: x(m.date), background: MARKER_FILL[m.state] }}
                        />
                      );
                    }
                    // Several items due on (nearly) the same day: one counted marker, not a pile.
                    const state = clusterState(c);
                    return (
                      <span
                        key={c.id}
                        data-cluster={c.markers.length}
                        title={c.markers.map((i) => `${i.label}, ${shortDay(i.date)}`).join('; ')}
                        className={cn(
                          'absolute top-1/2 grid h-[18px] min-w-[18px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-2 px-1 text-[10px] font-semibold leading-none tabular-nums',
                          c.markers.some((i) => i.kind === 'milestone')
                            ? 'border-ink'
                            : 'border-ink/80',
                          state === 'open' ? 'text-ink' : 'text-white',
                        )}
                        style={{ left: x(c.date), background: MARKER_FILL[state] }}
                      >
                        {c.markers.length}
                      </span>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <ul aria-hidden className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
        <li className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-5 rounded-[3px] bg-seq-3" /> Stored start to due date
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rotate-45 rounded-[2px] border-2 border-ink bg-primary" />
          Milestone due (filled when done)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="size-2.5 rounded-full border-2 border-ink/80 bg-white" /> Task due
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span
            className="size-2.5 rounded-full border-2 border-ink/80"
            style={{ background: MARKER_FILL.late }}
          />
          Past due, not done
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="grid h-3.5 min-w-3.5 place-items-center rounded-full border-2 border-ink/80 bg-white text-[8px] font-semibold leading-none text-ink">
            2
          </span>
          Several due within a day or two (hover for each)
        </li>
        <li className="inline-flex items-center gap-1.5">
          <span className="h-3 w-0.5 bg-ink/70" /> Today
        </li>
      </ul>
      <div className="sr-only">
        <table>
          <caption>{caption}</caption>
          <thead>
            <tr>
              <th scope="col">{labelHeader}</th>
              <th scope="col">Dates</th>
              <th scope="col">Due items</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <th scope="row">{r.name}</th>
                <td>
                  {r.start && r.end
                    ? `${shortDay(r.start)} to ${shortDay(r.end)}${r.barNote ? ` (${r.barNote})` : ''}`
                    : r.end
                      ? `Due ${shortDay(r.end)}`
                      : 'No dates set'}
                </td>
                <td>
                  {r.markers.length === 0
                    ? 'None'
                    : r.markers
                        .map(
                          (m) =>
                            `${m.label}, ${shortDay(m.date)}${m.state === 'done' ? ', done' : m.state === 'late' ? ', past due' : ''}`,
                        )
                        .join('; ')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Dependency map: tasks in columns by how many tasks they wait on in a chain.
// ---------------------------------------------------------------------------

export interface DepTask {
  id: string;
  title: string;
  status: string;
}

const STATUS_STYLE: Record<string, { fill: string; text: string; label: string }> = {
  DONE: { fill: 'var(--color-primary)', text: '#FFFFFF', label: 'Done' },
  BLOCKED: { fill: 'var(--color-violet-soft)', text: 'var(--color-ink)', label: 'Blocked' },
  IN_PROGRESS: { fill: 'var(--color-mint-soft)', text: 'var(--color-ink)', label: 'In progress' },
  IN_REVIEW: { fill: 'var(--color-mint-soft)', text: 'var(--color-ink)', label: 'In review' },
  TODO: { fill: '#FFFFFF', text: 'var(--color-ink)', label: 'To do' },
  CANCELED: { fill: 'var(--color-surface-alt)', text: 'var(--color-muted)', label: 'Canceled' },
};
export const statusLabel = (s: string) => STATUS_STYLE[s]?.label ?? s;

export function DependencyMap({
  tasks,
  dependencies,
  taskHref,
}: {
  tasks: DepTask[];
  dependencies: Array<{ taskId: string; dependsOnId: string }>;
  taskHref: (id: string) => string;
}) {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const deps = dependencies.filter((d) => byId.has(d.taskId) && byId.has(d.dependsOnId));
  const involved = [...new Set(deps.flatMap((d) => [d.taskId, d.dependsOnId]))];
  if (involved.length === 0) {
    return (
      <p className="text-sm text-muted">
        No task in this project waits on another yet. Add a dependency from a task to see the chain
        here.
      </p>
    );
  }
  const waitsOn = new Map<string, string[]>();
  for (const d of deps) waitsOn.set(d.taskId, [...(waitsOn.get(d.taskId) ?? []), d.dependsOnId]);
  // Level = longest chain of tasks before this one (the API refuses cycles).
  const level = new Map<string, number>();
  const visit = (id: string, seen: Set<string>): number => {
    if (level.has(id)) return level.get(id)!;
    if (seen.has(id)) return 0;
    seen.add(id);
    const l = Math.max(-1, ...(waitsOn.get(id) ?? []).map((p) => visit(p, seen))) + 1;
    level.set(id, l);
    return l;
  };
  involved.forEach((id) => visit(id, new Set()));
  const columns: string[][] = [];
  for (const id of involved) (columns[level.get(id)!] ??= []).push(id);
  columns.forEach((c) => c.sort((a, b) => byId.get(a)!.title.localeCompare(byId.get(b)!.title)));

  const W = 168;
  const H = 40;
  const GX = 64;
  const GY = 14;
  const pos = new Map<string, { x: number; y: number }>();
  columns.forEach((col, ci) =>
    col.forEach((id, ri) => pos.set(id, { x: ci * (W + GX), y: ri * (H + GY) })),
  );
  const width = columns.length * (W + GX) - GX;
  const height = Math.max(...columns.map((c) => c.length)) * (H + GY) - GY;
  const clip = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s);

  return (
    <div className="flex flex-col gap-4">
      <div
        // eslint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrolling area must take focus (axe scrollable-region-focusable)
        tabIndex={0}
        role="region"
        aria-label="Task dependency drawing"
        className="overflow-x-auto rounded-md border border-border bg-bg p-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
      >
        <svg
          aria-hidden
          width={width}
          height={height}
          viewBox={`-2 -2 ${width + 4} ${height + 4}`}
          className="block"
        >
          <defs>
            <marker
              id="dep-arrow"
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto"
            >
              <path d="M0,0 L8,4 L0,8 z" fill="var(--color-muted)" />
            </marker>
          </defs>
          {deps.map((d) => {
            const a = pos.get(d.dependsOnId)!;
            const b = pos.get(d.taskId)!;
            const x1 = a.x + W;
            const y1 = a.y + H / 2;
            const x2 = b.x - 2;
            const y2 = b.y + H / 2;
            const mx = (x1 + x2) / 2;
            const blocking = byId.get(d.dependsOnId)!.status !== 'DONE';
            return (
              <path
                key={`${d.dependsOnId}-${d.taskId}`}
                d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`}
                fill="none"
                stroke={blocking ? 'var(--color-ink)' : 'var(--color-border-strong)'}
                strokeWidth={blocking ? 1.75 : 1.25}
                strokeDasharray={blocking ? undefined : '4 4'}
                markerEnd="url(#dep-arrow)"
              />
            );
          })}
          {involved.map((id) => {
            const t = byId.get(id)!;
            const p = pos.get(id)!;
            const st = STATUS_STYLE[t.status] ?? STATUS_STYLE.TODO!;
            return (
              <g key={id} transform={`translate(${p.x} ${p.y})`}>
                {/* Names are clipped to fit the box; hovering shows the whole name. */}
                <title>{`${t.title} (${st.label})`}</title>
                <rect
                  width={W}
                  height={H}
                  rx={6}
                  fill={st.fill}
                  stroke={
                    t.status === 'BLOCKED' ? 'var(--color-violet)' : 'var(--color-border-strong)'
                  }
                  strokeWidth={t.status === 'BLOCKED' ? 2 : 1}
                />
                <text x={10} y={17} fontSize={12} fontWeight={600} fill={st.text}>
                  {clip(t.title)}
                </text>
                <text x={10} y={31} fontSize={10.5} fill={st.text} opacity={0.85}>
                  {st.label}
                </text>
              </g>
            );
          })}
        </svg>
      </div>
      <p className="text-xs text-muted">
        Read left to right: each task waits on the tasks to its left. A solid line means the earlier
        task is not done yet; a dashed line means it is done.
      </p>
      <ul className="flex flex-col divide-y divide-border rounded-md border border-border text-[13px]">
        {involved
          .filter((id) => waitsOn.has(id))
          .sort((a, b) => level.get(a)! - level.get(b)!)
          .map((id) => {
            const t = byId.get(id)!;
            const open = waitsOn.get(id)!.filter((p) => byId.get(p)!.status !== 'DONE');
            return (
              <li key={id} className="flex flex-wrap items-baseline gap-x-2 gap-y-1 px-4 py-2.5">
                <Link to={taskHref(id)} className="font-medium text-ink hover:underline">
                  {t.title}
                </Link>
                <span className="text-muted">({statusLabel(t.status)}) waits on</span>
                {waitsOn.get(id)!.map((p, i, all) => (
                  <span key={p}>
                    <Link to={taskHref(p)} className="text-primary-strong hover:underline">
                      {byId.get(p)!.title}
                    </Link>
                    <span className="text-muted">
                      {' '}
                      ({statusLabel(byId.get(p)!.status)}){i < all.length - 1 ? ',' : ''}
                    </span>
                  </span>
                ))}
                {open.length > 0 ? (
                  <span className="ml-auto text-xs font-medium text-ink">
                    {open.length} not done
                  </span>
                ) : (
                  <span className="ml-auto text-xs text-muted">Ready</span>
                )}
              </li>
            );
          })}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda: the same stored dates as the timeline, read top to bottom by date. On a phone this
// replaces sideways scrolling; the timeline stays one tap away.

export interface AgendaItem extends TimelineMarker {
  /** The milestone (or "No milestone") the item belongs to. */
  group: string;
}

export interface AgendaDay {
  date: string;
  items: AgendaItem[];
}

/** Every marker of every row, grouped by due date, earliest first. Nothing is added or dropped. */
export function agendaDays(rows: TimelineRow[]): AgendaDay[] {
  const items = rows
    .flatMap((r) => r.markers.map((m) => ({ ...m, group: r.name })))
    .sort(
      (a, b) =>
        ms(a.date) - ms(b.date) ||
        (a.kind === b.kind ? 0 : a.kind === 'milestone' ? -1 : 1) ||
        a.label.localeCompare(b.label),
    );
  const days: AgendaDay[] = [];
  for (const it of items) {
    const last = days.at(-1);
    if (last && last.date === it.date) last.items.push(it);
    else days.push({ date: it.date, items: [it] });
  }
  return days;
}

const STATE_TEXT: Record<TimelineMarker['state'], string> = {
  done: 'Done',
  open: 'Open',
  late: 'Past due',
  blocked: 'Blocked',
};
const STATE_TONE = {
  done: 'success',
  open: 'neutral',
  late: 'danger',
  blocked: 'warning',
} as const;

const longDay = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function Agenda({ rows, today }: { rows: TimelineRow[]; today: string }) {
  const days = agendaDays(rows);
  if (days.length === 0)
    return <p className="text-sm text-muted">Nothing on this plan has a due date yet.</p>;
  return (
    <ol className="flex flex-col gap-4">
      {days.map((d) => (
        <li key={d.date}>
          <h3 className="mb-1.5 flex items-baseline gap-2 text-[13px] font-semibold text-ink">
            <time dateTime={d.date}>{longDay(d.date)}</time>
            {d.date === today ? (
              <span className="text-xs font-medium text-primary">Today</span>
            ) : null}
          </h3>
          <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-bg">
            {d.items.map((it) => (
              <li key={it.id} className="flex min-h-11 items-center gap-3 px-3 py-2">
                <span
                  aria-hidden
                  className={cn(
                    'size-2.5 shrink-0 border-2 border-ink/70',
                    it.kind === 'milestone' ? 'rotate-45' : 'rounded-full',
                  )}
                  style={{ background: MARKER_FILL[it.state] }}
                />
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="break-words text-sm text-text">
                    {it.kind === 'milestone' ? <span className="sr-only">Milestone: </span> : null}
                    {it.label}
                  </span>
                  <span className="break-words text-xs text-muted">{it.group}</span>
                </span>
                <Badge tone={STATE_TONE[it.state]}>{STATE_TEXT[it.state]}</Badge>
              </li>
            ))}
          </ul>
        </li>
      ))}
    </ol>
  );
}
