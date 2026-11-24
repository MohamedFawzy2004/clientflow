import type {
  ContactWithDeals,
  InvoiceSummary,
  ProjectSummary,
  ProposalSummary,
  RelationshipGraphData,
} from '@clientflow/contracts';

/**
 * Relationship graph around one contact, built only from persisted foreign keys:
 *
 *   contact ─owns─ person (contact.owner)
 *   contact ─belongs to─ client organization (contact.clientOrg)
 *   contact ─has─ deal (deal.contact)            deal ─owned by─ person (deal.owner)
 *   deal ─has─ proposal (proposal.deal)          deal ─handed off to─ project (project.fromDeal)
 *   project ─managed by─ person (project.manager) project ─billed by─ invoice (invoice.project)
 *
 * Nothing is inferred: no similarity, no scoring, no guessed links. Node size encodes the number
 * of links the node has in this graph (its degree), which the legend states.
 */

export type NodeKind =
  'contact' | 'person' | 'org' | 'deal' | 'proposal' | 'project' | 'invoice' | 'deliverable';

export interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  detail: string;
  href: string | null;
  /** The ring-1 node this hangs off (deal or project), for expand/collapse. */
  parent: string | null;
  degree: number;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface RelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const KIND_LABELS: Record<NodeKind, string> = {
  contact: 'Contact',
  person: 'Team member',
  org: 'Client organization',
  deal: 'Deal',
  proposal: 'Proposal',
  project: 'Project',
  invoice: 'Invoice',
  deliverable: 'Deliverable',
};

/** Filterable relationship types (the focus contact is always shown). */
export const FILTER_KINDS: Array<Exclude<NodeKind, 'contact'>> = [
  'person',
  'org',
  'deal',
  'proposal',
  'project',
  'invoice',
  'deliverable',
];

/** People links (owner, manager) draw dashed; record links draw solid. */
export const PEOPLE_LINKS = new Set(['owned by', 'managed by']);

export function buildGraph(input: {
  contact: ContactWithDeals;
  proposals: ProposalSummary[];
  projects: ProjectSummary[];
  invoices: InvoiceSummary[];
  /** Label helper so money formatting stays with the caller. */
  money: (minor: string, currency: string) => string;
}): RelationshipGraph {
  const { contact, money } = input;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: Omit<GraphNode, 'degree'>) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, degree: 0 });
    return n.id;
  };
  const link = (from: string, to: string, label: string) => {
    if (edges.some((e) => e.from === from && e.to === to)) return;
    edges.push({ from, to, label });
  };
  const person = (p: { id: string; name: string }, parent: string | null) =>
    add({
      id: `person:${p.id}`,
      kind: 'person',
      label: p.name,
      detail: KIND_LABELS.person,
      href: null,
      parent,
    });

  const root = add({
    id: `contact:${contact.id}`,
    kind: 'contact',
    label: contact.fullName,
    detail: contact.companyName ?? (contact.lifecycle === 'CUSTOMER' ? 'Customer' : 'Lead'),
    href: `/app/leads/${contact.id}`,
    parent: null,
  });
  link(root, person(contact.owner, null), 'owned by');
  if (contact.clientOrg) {
    link(
      root,
      add({
        id: `org:${contact.clientOrg.id}`,
        kind: 'org',
        label: contact.clientOrg.name,
        detail: KIND_LABELS.org,
        href: null,
        parent: null,
      }),
      'belongs to',
    );
  }

  const dealIds = new Set(contact.deals.map((d) => d.id));
  for (const d of contact.deals) {
    const id = add({
      id: `deal:${d.id}`,
      kind: 'deal',
      label: d.title,
      detail: `${money(d.amountMinor, d.currency)}, ${
        d.status === 'OPEN' ? d.stage.name : d.status === 'WON' ? 'won' : 'lost'
      }`,
      href: `/app/deals/${d.id}`,
      parent: null,
    });
    link(root, id, 'deal');
    if (d.owner.id !== contact.owner.id) link(id, person(d.owner, id), 'owned by');
  }
  for (const p of input.proposals) {
    if (!dealIds.has(p.deal.id)) continue;
    const parent = `deal:${p.deal.id}`;
    link(
      parent,
      add({
        id: `proposal:${p.id}`,
        kind: 'proposal',
        label: p.reference,
        detail: `${p.title}, ${money(p.totalMinor, p.currency)}`,
        href: `/app/proposals/${p.id}`,
        parent,
      }),
      'proposal',
    );
  }
  const projectIds = new Set<string>();
  for (const p of input.projects) {
    if (!p.fromDeal || !dealIds.has(p.fromDeal.id)) continue;
    projectIds.add(p.id);
    const parent = `deal:${p.fromDeal.id}`;
    const id = add({
      id: `project:${p.id}`,
      kind: 'project',
      label: p.title,
      detail: `${p.milestones.done}/${p.milestones.total} milestones done`,
      href: `/app/projects/${p.id}`,
      parent,
    });
    link(parent, id, 'handed off to');
    link(id, person(p.manager, parent), 'managed by');
  }
  for (const i of input.invoices) {
    if (!i.project || !projectIds.has(i.project.id)) continue;
    const projectNode = nodes.get(`project:${i.project.id}`);
    link(
      `project:${i.project.id}`,
      add({
        id: `invoice:${i.id}`,
        kind: 'invoice',
        label: i.number === null ? 'Draft invoice' : i.reference,
        detail: `${money(i.totalMinor, i.currency)}, ${i.displayStatus.toLowerCase().replace(/_/g, ' ')}`,
        href: `/app/invoices/${i.id}`,
        parent: projectNode?.parent ?? null,
      }),
      'invoice',
    );
  }

  for (const e of edges) {
    nodes.get(e.from)!.degree += 1;
    nodes.get(e.to)!.degree += 1;
  }
  return { nodes: [...nodes.values()], edges };
}

/**
 * The same graph from `GET /contacts/:id/graph` (ADR-072). The server applies every read scope
 * and returns stored keys only; this only turns them into nodes and links. Kinds the viewer cannot
 * read arrive empty, so they never appear, not even as a count.
 */
export function buildServerGraph(
  data: RelationshipGraphData,
  money: (minor: string, currency: string) => string,
): RelationshipGraph {
  const { contact } = data;
  const nodes = new Map<string, GraphNode>();
  const edges: GraphEdge[] = [];
  const add = (n: Omit<GraphNode, 'degree'>) => {
    if (!nodes.has(n.id)) nodes.set(n.id, { ...n, degree: 0 });
    return n.id;
  };
  const link = (from: string, to: string, label: string) => {
    if (!nodes.has(from) || !nodes.has(to)) return;
    if (edges.some((e) => e.from === from && e.to === to)) return;
    edges.push({ from, to, label });
  };
  const person = (p: { id: string; name: string }, parent: string | null) =>
    add({
      id: `person:${p.id}`,
      kind: 'person',
      label: p.name,
      detail: KIND_LABELS.person,
      href: null,
      parent,
    });
  const root = add({
    id: `contact:${contact.id}`,
    kind: 'contact',
    label: contact.fullName,
    detail: contact.companyName ?? (contact.lifecycle === 'CUSTOMER' ? 'Customer' : 'Lead'),
    href: `/app/leads/${contact.id}`,
    parent: null,
  });
  link(root, person(contact.owner, null), 'owned by');
  if (contact.clientOrg) {
    const org = add({
      id: `org:${contact.clientOrg.id}`,
      kind: 'org',
      label: contact.clientOrg.name,
      detail: KIND_LABELS.org,
      href: null,
      parent: null,
    });
    link(root, org, 'belongs to');
  }
  for (const d of data.deals) {
    const id = add({
      id: `deal:${d.id}`,
      kind: 'deal',
      label: d.title,
      detail: `${money(d.amountMinor, d.currency)}, ${
        d.status === 'OPEN' ? d.stage : d.status === 'WON' ? 'won' : 'lost'
      }`,
      href: `/app/deals/${d.id}`,
      parent: null,
    });
    link(root, id, 'deal');
    if (d.owner.id !== contact.owner.id) link(id, person(d.owner, id), 'owned by');
  }
  for (const p of data.proposals) {
    const parent = `deal:${p.dealId}`;
    const id = add({
      id: `proposal:${p.id}`,
      kind: 'proposal',
      label: p.reference,
      detail: `${p.title}, ${money(p.totalMinor, p.currency)}`,
      href: `/app/proposals/${p.id}`,
      parent,
    });
    link(parent, id, 'proposal');
  }
  for (const p of data.projects) {
    // A project reached through a deal hangs off that deal; one linked only to the contact
    // hangs off the contact.
    const viaDeal = p.dealId && nodes.has(`deal:${p.dealId}`) ? `deal:${p.dealId}` : null;
    const id = add({
      id: `project:${p.id}`,
      kind: 'project',
      label: p.title,
      detail: `${p.milestones.done}/${p.milestones.total} milestones done`,
      href: `/app/projects/${p.id}`,
      parent: viaDeal,
    });
    link(viaDeal ?? root, id, viaDeal ? 'handed off to' : 'project');
    link(id, person(p.manager, viaDeal ?? id), 'managed by');
  }
  const status = (s: string) => s.toLowerCase().replace(/_/g, ' ');
  for (const i of data.invoices) {
    const project = nodes.get(`project:${i.projectId}`);
    const id = add({
      id: `invoice:${i.id}`,
      kind: 'invoice',
      label: i.reference,
      detail: `${money(i.totalMinor, i.currency)}, ${status(i.status)}`,
      href: `/app/invoices/${i.id}`,
      parent: project?.parent ?? project?.id ?? null,
    });
    link(`project:${i.projectId}`, id, 'invoice');
  }
  for (const d of data.deliverables) {
    const project = nodes.get(`project:${d.projectId}`);
    const id = add({
      id: `deliverable:${d.id}`,
      kind: 'deliverable',
      label: d.title,
      detail: `Deliverable, ${status(d.status)}`,
      href: `/app/projects/${d.projectId}/deliverables/${d.id}`,
      parent: project?.parent ?? project?.id ?? null,
    });
    link(`project:${d.projectId}`, id, 'deliverable');
  }
  for (const e of edges) {
    nodes.get(e.from)!.degree += 1;
    nodes.get(e.to)!.degree += 1;
  }
  return { nodes: [...nodes.values()], edges };
}

export interface Placed extends GraphNode {
  x: number;
  y: number;
  r: number;
  depth: number;
}

const KIND_ORDER: NodeKind[] = [
  'contact',
  'org',
  'person',
  'deal',
  'proposal',
  'project',
  'invoice',
  'deliverable',
];

/**
 * Radial tree layout. The contact sits in the middle; every other shown node hangs off the node
 * that first reaches it (breadth first), one ring per step away. Each subtree gets an angle in
 * proportion to its number of leaves, so a deal with a proposal, a project and two invoices fans
 * out behind that deal instead of crossing the map.
 */
export function layout(
  graph: RelationshipGraph,
  visible: (n: GraphNode) => boolean,
  rings: number[] = [0, 135, 255, 365, 465],
): Placed[] {
  const shown = graph.nodes.filter(visible);
  const ids = new Set(shown.map((n) => n.id));
  const root = shown.find((n) => n.kind === 'contact');
  if (!root) return [];
  const adj = new Map<string, string[]>();
  for (const e of graph.edges) {
    if (!ids.has(e.from) || !ids.has(e.to)) continue;
    adj.set(e.from, [...(adj.get(e.from) ?? []), e.to]);
    adj.set(e.to, [...(adj.get(e.to) ?? []), e.from]);
  }
  const byId = new Map(shown.map((n) => [n.id, n]));
  const order = (x: string) => KIND_ORDER.indexOf(byId.get(x)!.kind);
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>([[root.id, 0]]);
  const queue = [root.id];
  while (queue.length) {
    const cur = queue.shift()!;
    const next = (adj.get(cur) ?? [])
      .filter((x) => !depth.has(x))
      .sort((x, y) => order(x) - order(y));
    for (const x of next) {
      depth.set(x, depth.get(cur)! + 1);
      queue.push(x);
    }
    children.set(cur, next);
  }
  const leaves = new Map<string, number>();
  const count = (id: string): number => {
    const kids = children.get(id) ?? [];
    const n = kids.length === 0 ? 1 : kids.reduce((s, k) => s + count(k), 0);
    leaves.set(id, n);
    return n;
  };
  count(root.id);
  const maxDegree = Math.max(1, ...shown.map((n) => n.degree));
  const radius = (n: GraphNode) =>
    n.kind === 'contact' ? 30 : 10 + Math.round(12 * Math.sqrt(n.degree / maxDegree));
  const placed: Placed[] = [];
  const place = (id: string, from: number, to: number) => {
    const n = byId.get(id)!;
    const d = depth.get(id)!;
    const a = (from + to) / 2;
    const r = rings[Math.min(d, rings.length - 1)]!;
    placed.push({ ...n, x: r * Math.cos(a), y: r * Math.sin(a), r: radius(n), depth: d });
    const kids = children.get(id) ?? [];
    const total = kids.reduce((s, k) => s + leaves.get(k)!, 0);
    // Children never spread wider than ~70° per ring step, so fans stay readable.
    const span = d === 0 ? to - from : Math.min(to - from, (Math.PI / 180) * 34 * total);
    let start = d === 0 ? from : a - span / 2;
    for (const k of kids) {
      const w = (span * leaves.get(k)!) / total;
      place(k, start, start + w);
      start += w;
    }
  };
  place(root.id, -Math.PI / 2, (3 * Math.PI) / 2);
  return placed;
}

/** Tight viewBox around the placed nodes, with room for labels. */
export function bounds(placed: Placed[], pad = 70): [number, number, number, number] {
  if (placed.length === 0) return [-200, -200, 400, 400];
  const xs = placed.map((p) => p.x);
  const ys = placed.map((p) => p.y);
  const minX = Math.min(...xs) - pad - 90;
  const maxX = Math.max(...xs) + pad + 90;
  const minY = Math.min(...ys) - pad;
  const maxY = Math.max(...ys) + pad;
  return [minX, minY, maxX - minX, maxY - minY];
}
