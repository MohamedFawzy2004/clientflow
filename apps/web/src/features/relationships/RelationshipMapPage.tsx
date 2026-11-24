import { useEffect, useMemo, useState, type KeyboardEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, ListTree, Network, Search, ShieldAlert, Users } from 'lucide-react';
import {
  formatMoney,
  type ApiSuccess,
  type ContactSummary,
  type ContactWithDeals,
  type Currency,
} from '@clientflow/contracts';
import { api } from '../../lib/api';
import { cn } from '../../lib/format';
import { EmptyState, ErrorState, Skeleton } from '../../components/ui/feedback';
import { PageHeader, Panel, Segmented } from '../../components/ui/page';
import { useSession } from '../auth/session';
import { canSeeLeads } from '../../app/nav';
import { useLead } from '../leads/api';
import { useLinkedRecords } from '../leads/client360';
import {
  bounds,
  buildGraph,
  FILTER_KINDS,
  KIND_LABELS,
  layout,
  type GraphNode,
  type NodeKind,
  type Placed,
  type RelationshipGraph,
} from './graph';

const KIND_STYLE: Record<NodeKind, { fill: string; stroke: string }> = {
  contact: { fill: 'var(--color-ink)', stroke: 'var(--color-ink)' },
  person: { fill: '#FFFFFF', stroke: 'var(--color-ink)' },
  org: { fill: 'var(--color-mint)', stroke: 'var(--color-ink)' },
  deal: { fill: 'var(--color-series-1)', stroke: '#FFFFFF' },
  proposal: { fill: 'var(--color-series-2)', stroke: '#FFFFFF' },
  project: { fill: 'var(--color-series-3)', stroke: '#FFFFFF' },
  invoice: { fill: 'var(--color-series-4)', stroke: '#FFFFFF' },
};

const PLURAL: Record<NodeKind, string> = {
  contact: 'Contact',
  person: 'People',
  org: 'Organization',
  deal: 'Deals',
  proposal: 'Proposals',
  project: 'Projects',
  invoice: 'Invoices',
};

/** Each kind also has its own shape, so identity never depends on colour alone. */
function Shape({
  kind,
  r,
  ...rest
}: {
  kind: NodeKind;
  r: number;
  fill: string;
  stroke: string;
  strokeWidth: number;
}) {
  switch (kind) {
    case 'org':
      return <rect x={-r} y={-r} width={r * 2} height={r * 2} rx={r * 0.35} {...rest} />;
    case 'proposal':
      return <rect x={-r * 0.9} y={-r * 0.9} width={r * 1.8} height={r * 1.8} rx={2} {...rest} />;
    case 'project':
      return (
        <polygon points={`0,${-r * 1.15} ${r * 1.15},0 0,${r * 1.15} ${-r * 1.15},0`} {...rest} />
      );
    case 'invoice':
      return (
        <polygon
          points={`0,${-r * 1.1} ${r * 1.05},${r * 0.85} ${-r * 1.05},${r * 0.85}`}
          {...rest}
        />
      );
    default:
      return <circle r={r} {...rest} />;
  }
}

function LegendShape({ kind }: { kind: NodeKind }) {
  const s = KIND_STYLE[kind];
  return (
    <svg viewBox="-12 -12 24 24" aria-hidden className="size-4 shrink-0">
      <Shape
        kind={kind}
        r={8}
        fill={s.fill}
        stroke={s.stroke === '#FFFFFF' ? s.fill : s.stroke}
        strokeWidth={1.5}
      />
    </svg>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

const money = (minor: string, currency: string) => formatMoney(minor, currency as Currency);

// ---------------------------------------------------------------------------
// Contact picker
// ---------------------------------------------------------------------------

function useContactOptions(q: string) {
  const { data: user } = useSession();
  return useQuery({
    queryKey: ['u', user?.id ?? 'anon', 'relationships', 'contacts', q],
    staleTime: 30_000,
    queryFn: ({ signal }) =>
      api.get<ApiSuccess<ContactSummary[]>>(
        `/api/v1/contacts?limit=50${q ? `&q=${encodeURIComponent(q)}` : ''}`,
        { signal },
      ),
  });
}

function ContactPicker({ focus, onPick }: { focus: string | null; onPick: (id: string) => void }) {
  const [text, setText] = useState('');
  const [q, setQ] = useState('');
  useEffect(() => {
    const t = setTimeout(() => setQ(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);
  const contacts = useContactOptions(q);
  const rows = useMemo(() => {
    const list = Array.isArray(contacts.data?.data) ? contacts.data.data : [];
    // Customers first: they usually carry the most linked records.
    return [...list].sort(
      (a, b) =>
        Number(b.lifecycle === 'CUSTOMER') - Number(a.lifecycle === 'CUSTOMER') ||
        a.fullName.localeCompare(b.fullName),
    );
  }, [contacts.data]);
  useEffect(() => {
    if (!focus && !q && rows[0]) onPick(rows[0].id);
  }, [focus, q, rows, onPick]);

  return (
    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
      <div className="relative min-w-0 sm:w-64">
        <label htmlFor="map-search" className="mb-1 block text-[13px] font-medium text-ink">
          Find a contact
        </label>
        <Search
          aria-hidden
          className="pointer-events-none absolute bottom-3 left-3 size-4 text-muted md:bottom-2.5"
        />
        <input
          id="map-search"
          type="search"
          value={text}
          maxLength={100}
          onChange={(e) => setText(e.target.value)}
          placeholder="Name or company"
          className="h-10 w-full rounded-md border border-control bg-surface pl-9 pr-3 text-sm text-ink placeholder:text-muted hover:border-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 md:h-9"
        />
      </div>
      <div className="min-w-0 sm:w-72">
        <label htmlFor="map-contact" className="mb-1 block text-[13px] font-medium text-ink">
          Centre the map on
        </label>
        <select
          id="map-contact"
          value={focus ?? ''}
          onChange={(e) => e.target.value && onPick(e.target.value)}
          className="h-10 w-full rounded-md border border-control bg-surface px-3 text-sm text-ink hover:border-ink focus:border-primary focus:outline-none focus:ring-[3px] focus:ring-primary/15 md:h-9"
        >
          {focus && !rows.some((r) => r.id === focus) ? (
            <option value={focus}>Current contact</option>
          ) : null}
          {rows.length === 0 ? <option value="">No contacts match</option> : null}
          {rows.map((c) => (
            <option key={c.id} value={c.id}>
              {c.fullName}
              {c.companyName ? `, ${c.companyName}` : ''}
              {c.lifecycle === 'CUSTOMER' ? ' (customer)' : ''}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Map and list views
// ---------------------------------------------------------------------------

function GraphSvg({
  placed,
  graph,
  selected,
  onSelect,
  contactName,
}: {
  placed: Placed[];
  graph: RelationshipGraph;
  selected: string | null;
  onSelect: (id: string) => void;
  contactName: string;
}) {
  const byId = new Map(placed.map((p) => [p.id, p]));
  const edges = graph.edges.filter((e) => byId.has(e.from) && byId.has(e.to));
  const near = new Set<string>();
  if (selected)
    for (const e of edges) {
      if (e.from === selected) near.add(e.to);
      if (e.to === selected) near.add(e.from);
    }
  const key = (e: KeyboardEvent, id: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onSelect(id);
    }
  };
  return (
    <svg
      viewBox={bounds(placed).join(' ')}
      className="block h-auto w-full"
      role="group"
      aria-label={`Relationship map for ${contactName}: ${placed.length} records and people, ${edges.length} links. Each shape is a button; the list view shows the same links as text.`}
    >
      <g aria-hidden>
        {[...new Set(placed.map((p) => p.depth))]
          .filter((d) => d > 0)
          .map((d) => {
            const p = placed.find((x) => x.depth === d)!;
            return (
              <circle
                key={d}
                r={Math.hypot(p.x, p.y)}
                fill="none"
                stroke="var(--color-border)"
                strokeDasharray="2 6"
              />
            );
          })}
        {edges.map((e) => {
          const a = byId.get(e.from)!;
          const b = byId.get(e.to)!;
          const hot = selected && (e.from === selected || e.to === selected);
          return (
            <line
              key={`${e.from}-${e.to}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={hot ? 'var(--color-ink)' : 'var(--color-border-strong)'}
              strokeWidth={hot ? 2 : 1.25}
              opacity={selected && !hot ? 0.45 : 1}
            />
          );
        })}
      </g>
      {placed.map((n) => {
        const s = KIND_STYLE[n.kind];
        const isSel = n.id === selected;
        const dim = selected && !isSel && !near.has(n.id);
        // Labels sit outside the node, pointing away from the centre, so fans do not collide.
        const dist = Math.hypot(n.x, n.y);
        const cos = dist ? n.x / dist : 0;
        const sin = dist ? n.y / dist : 1;
        const side =
          n.depth !== 1 ? 'middle' : cos > 0.35 ? 'start' : cos < -0.35 ? 'end' : 'middle';
        const lx = side === 'middle' ? 0 : cos * (n.r + 8);
        const ly = side === 'middle' ? (sin >= 0 ? n.r + 17 : -n.r - 9) : sin * (n.r + 8) + 4.5;
        return (
          <g
            key={n.id}
            role="button"
            tabIndex={0}
            aria-pressed={isSel}
            aria-label={`${KIND_LABELS[n.kind]}: ${n.label}, ${n.degree} link${n.degree === 1 ? '' : 's'}`}
            transform={`translate(${n.x} ${n.y})`}
            onClick={() => onSelect(n.id)}
            onKeyDown={(e) => key(e, n.id)}
            className="cursor-pointer outline-none [&:focus-visible>.ring]:opacity-100"
            opacity={dim ? 0.4 : 1}
            style={{ transition: 'opacity 160ms var(--ease-out)' }}
          >
            <circle
              className="ring"
              r={n.r + 7}
              fill="none"
              stroke="var(--color-primary)"
              strokeWidth={2.5}
              opacity={0}
            />
            {isSel ? (
              <circle r={n.r + 5} fill="none" stroke="var(--color-ink)" strokeWidth={2} />
            ) : null}
            <Shape kind={n.kind} r={n.r} fill={s.fill} stroke={s.stroke} strokeWidth={2} />
            <text
              x={lx}
              y={ly}
              textAnchor={side}
              className="pointer-events-none select-none"
              fontSize={n.kind === 'contact' ? 16 : 13}
              fontWeight={n.kind === 'contact' || isSel ? 640 : 500}
              fill="var(--color-ink)"
              stroke="var(--color-bg)"
              strokeWidth={4}
              paintOrder="stroke"
            >
              {truncate(n.label, n.kind === 'contact' ? 28 : 22)}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function GraphList({
  graph,
  visible,
  onSelect,
}: {
  graph: RelationshipGraph;
  visible: (n: GraphNode) => boolean;
  onSelect: (id: string) => void;
}) {
  const nodes = graph.nodes.filter(visible);
  const root = nodes.find((n) => n.kind === 'contact');
  const linkLabel = (a: string, b: string) =>
    graph.edges.find((e) => (e.from === a && e.to === b) || (e.from === b && e.to === a))?.label;
  const item = (n: GraphNode, via: string) => (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className="text-xs text-muted">{linkLabel(via, n.id)}</span>
      {n.href ? (
        <Link to={n.href} className="font-medium text-primary-strong hover:underline">
          {n.label}
        </Link>
      ) : (
        <button
          type="button"
          onClick={() => onSelect(n.id)}
          className="font-medium text-ink hover:underline"
        >
          {n.label}
        </button>
      )}
      <span className="text-xs text-muted">
        {KIND_LABELS[n.kind]}, {n.detail === KIND_LABELS[n.kind] ? '' : `${n.detail}, `}
        {n.degree} link{n.degree === 1 ? '' : 's'}
      </span>
    </span>
  );
  if (!root) return null;
  const first = nodes.filter((n) => n.kind !== 'contact' && n.parent === null);
  return (
    <div className="px-5 pb-5 pt-2 text-sm">
      <p className="font-semibold text-ink">
        {root.label} <span className="text-xs font-normal text-muted">{root.detail}</span>
      </p>
      <ul className="mt-2 flex flex-col gap-2 border-l border-border-strong pl-4">
        {first.map((n) => {
          const kids = nodes.filter((k) => k.parent === n.id);
          return (
            <li key={n.id}>
              {item(n, root.id)}
              {kids.length > 0 ? (
                <ul className="mt-1.5 flex flex-col gap-1.5 border-l border-border pl-4">
                  {kids.map((k) => {
                    const via =
                      graph.edges.find((e) => e.to === k.id && nodes.some((x) => x.id === e.from))
                        ?.from ?? n.id;
                    return <li key={k.id}>{item(k, via)}</li>;
                  })}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SelectionPanel({
  graph,
  node,
  onSelect,
  collapsed,
  onToggle,
}: {
  graph: RelationshipGraph;
  node: GraphNode | null;
  onSelect: (id: string) => void;
  collapsed: boolean;
  onToggle: () => void;
}) {
  if (!node) {
    return (
      <p className="px-5 pb-5 pt-2 text-sm text-muted">
        Select a shape on the map, or tab to it and press Enter, to see how it connects.
      </p>
    );
  }
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const links = graph.edges
    .filter((e) => e.from === node.id || e.to === node.id)
    .map((e) => ({ label: e.label, other: byId.get(e.from === node.id ? e.to : e.from)! }));
  const hasKids = graph.nodes.some((n) => n.parent === node.id);
  return (
    <div className="px-5 pb-5 pt-2" aria-live="polite">
      <p className="flex items-center gap-2 text-xs text-muted">
        <LegendShape kind={node.kind} />
        {KIND_LABELS[node.kind]}
      </p>
      <p className="mt-1 break-words text-base font-semibold text-ink">{node.label}</p>
      {node.detail !== KIND_LABELS[node.kind] ? (
        <p className="text-[13px] text-muted">{node.detail}</p>
      ) : null}
      <div className="mt-3 flex flex-wrap gap-2">
        {node.href ? (
          <Link
            to={node.href}
            className="press inline-flex h-9 items-center gap-1.5 rounded-md bg-primary px-3 text-sm font-medium text-white hover:bg-primary-hover"
          >
            {node.kind === 'contact'
              ? 'Open Client 360'
              : `Open ${KIND_LABELS[node.kind].toLowerCase()}`}
            <ArrowUpRight aria-hidden className="size-4" />
          </Link>
        ) : null}
        {hasKids ? (
          <button
            type="button"
            aria-expanded={!collapsed}
            onClick={onToggle}
            className="press inline-flex h-9 items-center rounded-md border border-border-strong px-3 text-sm font-medium text-ink hover:border-subtle"
          >
            {collapsed ? 'Expand linked records' : 'Collapse linked records'}
          </button>
        ) : null}
      </div>
      <h3 className="mt-5 text-[13px] font-semibold text-ink">
        {links.length} link{links.length === 1 ? '' : 's'}
      </h3>
      <ul className="mt-1.5 divide-y divide-border">
        {links.map(({ label, other }) => (
          <li key={other.id} className="flex items-center justify-between gap-3 py-2">
            <button
              type="button"
              onClick={() => onSelect(other.id)}
              className="min-w-0 truncate text-left text-sm text-ink hover:text-primary-strong hover:underline"
            >
              {other.label}
            </button>
            <span className="shrink-0 text-xs text-muted">{label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function MapBody({ lead }: { lead: ContactWithDeals }) {
  const linked = useLinkedRecords(lead);
  const [view, setView] = useState<'map' | 'list'>(() =>
    typeof window !== 'undefined' && window.matchMedia?.('(max-width: 639px)').matches
      ? 'list'
      : 'map',
  );
  const [hidden, setHidden] = useState<Set<NodeKind>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  const graph = useMemo(
    () =>
      buildGraph({
        contact: lead,
        proposals: linked.proposals.rows,
        projects: linked.projects.rows,
        invoices: linked.invoices.rows,
        money,
      }),
    [lead, linked.proposals.rows, linked.projects.rows, linked.invoices.rows],
  );
  const visible = (n: GraphNode) =>
    n.kind === 'contact' || (!hidden.has(n.kind) && (!n.parent || !collapsed.has(n.parent)));
  const placed = layout(graph, visible);
  const counts = FILTER_KINDS.map((k) => ({
    k,
    n: graph.nodes.filter((n) => n.kind === k).length,
  }));
  const loading = [linked.proposals.q, linked.projects.q, linked.invoices.q].some(
    (q) => q.isPending && q.fetchStatus !== 'idle',
  );
  const selNode = graph.nodes.find((n) => n.id === selected) ?? null;
  const parents = graph.nodes.filter((n) => graph.nodes.some((k) => k.parent === n.id));

  return (
    <div className="mt-5 flex flex-col gap-4">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="group" aria-label="Show relationship types" className="flex flex-wrap gap-1.5">
          {counts.map(({ k, n }) => {
            const on = !hidden.has(k);
            return (
              <button
                key={k}
                type="button"
                aria-pressed={on}
                disabled={n === 0}
                onClick={() =>
                  setHidden((h) => {
                    const next = new Set(h);
                    if (next.has(k)) next.delete(k);
                    else next.add(k);
                    return next;
                  })
                }
                className={cn(
                  'press inline-flex h-9 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium disabled:opacity-50',
                  on
                    ? 'border-border-strong bg-surface text-ink'
                    : 'border-dashed border-control bg-transparent text-muted line-through',
                )}
              >
                <LegendShape kind={k} />
                {PLURAL[k]}
                <span className="text-muted tabular">{n}</span>
              </button>
            );
          })}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {parents.length > 0 ? (
            <button
              type="button"
              onClick={() =>
                setCollapsed((c) => (c.size > 0 ? new Set() : new Set(parents.map((p) => p.id))))
              }
              className="h-9 rounded-md px-2 text-[13px] font-medium text-primary-strong hover:underline"
            >
              {collapsed.size > 0 ? 'Expand all' : 'Collapse all'}
            </button>
          ) : null}
          <Segmented
            label="View"
            value={view}
            onChange={setView}
            options={[
              { value: 'map', label: 'Map', icon: <Network aria-hidden className="size-4" /> },
              { value: 'list', label: 'List', icon: <ListTree aria-hidden className="size-4" /> },
            ]}
          />
        </div>
      </div>

      <div className="grid grid-cols-1 items-start gap-5 xl:grid-cols-12">
        <Panel
          bodyClassName="p-0"
          className="xl:col-span-8"
          title={view === 'map' ? `Around ${lead.fullName}` : `Links from ${lead.fullName}`}
          description={
            loading
              ? 'Loading linked proposals, projects and invoices…'
              : 'Size shows how many links a record has here. Shapes and colours show the type.'
          }
        >
          {view === 'map' ? (
            <div className="px-2 pb-3 sm:px-5">
              <GraphSvg
                placed={placed}
                graph={graph}
                selected={selected}
                onSelect={setSelected}
                contactName={lead.fullName}
              />
            </div>
          ) : (
            <GraphList graph={graph} visible={visible} onSelect={setSelected} />
          )}
        </Panel>
        <div className="flex min-w-0 flex-col gap-5 xl:col-span-4">
          <Panel bodyClassName="p-0" id="map-selection" title="Selected">
            <SelectionPanel
              graph={graph}
              node={selNode}
              onSelect={setSelected}
              collapsed={!!selNode && collapsed.has(selNode.id)}
              onToggle={() =>
                selNode &&
                setCollapsed((c) => {
                  const next = new Set(c);
                  if (next.has(selNode.id)) next.delete(selNode.id);
                  else next.add(selNode.id);
                  return next;
                })
              }
            />
          </Panel>
          <Panel bodyClassName="p-0" title="How this map is built" tone="sunk">
            <ul className="flex flex-col gap-1.5 px-5 pb-5 pt-2 text-[13px] text-muted">
              <li>
                Every line is a stored link: owner, deal, proposal, hand-off, project manager,
                invoice.
              </li>
              <li>Nothing is guessed or scored. A record you cannot open is not shown.</li>
              <li>
                Proposals, projects and invoices come from their lists (up to 200, 200 and 500
                records), so a very large agency can miss older ones here.
              </li>
            </ul>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function RelationshipMapPage() {
  const { data: user } = useSession();
  const [params, setParams] = useSearchParams();
  const focus = params.get('focus');
  const onPick = useMemo(
    () => (id: string) => setParams({ focus: id }, { replace: true }),
    [setParams],
  );
  const lead = useLead(focus ?? '');
  if (!user) return null;
  if (!canSeeLeads(user.role)) {
    return (
      <EmptyState
        icon={<ShieldAlert aria-hidden className="size-5" />}
        title="The relationship map is not part of your role"
        description="It is built from leads and deals. Ask your agency owner or admin if you need access."
      />
    );
  }
  return (
    <>
      <PageHeader
        title="Relationship map"
        description="Who and what is connected to a contact: the team, deals, proposals, projects and invoices, from stored records only."
      />
      <div className="mt-6">
        <ContactPicker focus={focus} onPick={onPick} />
      </div>
      {!focus ? (
        <div className="mt-5 rounded-lg border border-border bg-surface">
          <EmptyState
            icon={<Users aria-hidden className="size-5" />}
            title="No contact to map yet"
            description="Add a lead, then come back to see the people and records around it."
          />
        </div>
      ) : lead.isPending ? (
        <Skeleton className="mt-5 h-[480px] rounded-lg" />
      ) : lead.isError ? (
        <div className="mt-5 rounded-lg border border-border bg-surface">
          <ErrorState
            message={lead.error.message}
            onRetry={() => lead.refetch()}
            retrying={lead.isFetching}
          />
        </div>
      ) : (
        <MapBody key={lead.data.data.id} lead={lead.data.data} />
      )}
    </>
  );
}
