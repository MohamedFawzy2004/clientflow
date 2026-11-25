// Final signature release (ADR-072): read-only intelligence over stored records.
// Every query starts from an existing read scope (contacts, deals, proposals, projects, invoices),
// so a role never sees a node, a count or a total it could not open on its own page. Nothing here
// writes, infers links, scores people or converts currencies.
import {
  can,
  GRAPH_LIMIT,
  invoiceReference,
  proposalReference,
  utcIsoToZonedLocal,
  type DeliveryIntelligence,
  type FinanceIntelligence,
  type ProjectPlan,
  type RelationshipGraphData,
  type SalesIntelligence,
  type TrendQuery,
} from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import { addDays, agencyToday, formatDateOnly, parseDateOnly } from '../../lib/agency-time.js';
import { forbidden, notFound } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { contactReadScope } from '../contacts/policy.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { dealReadScope } from '../deals/policy.js';
import { costOfEntries, invoiceScope } from '../invoices/service.js';
import { canManage, canWork, findWorkable, projectReadScope } from '../projects/access.js';
import { proposalReadScope } from '../proposals/service.js';

const OPEN_PROJECT_STATES = ['PLANNED', 'ACTIVE', 'ON_HOLD'] as const;

const person = (u: { id: string; name: string }) => ({ id: u.id, name: u.name });
const addTo = (m: Map<string, bigint>, k: string, v: bigint) => m.set(k, (m.get(k) ?? 0n) + v);
const toRecord = (m: Map<string, bigint>) =>
  Object.fromEntries([...m.entries()].sort().map(([k, v]) => [k, v.toString()]));

/** The last `n` months ending with the agency's current month, oldest first (`YYYY-MM`). */
export function monthFrame(n: number, now: Date, timeZone: string): string[] {
  const [y, m] = agencyToday(now, timeZone).split('-').map(Number) as [number, number];
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

/** The agency-local `YYYY-MM` of an instant. */
const localMonth = (at: Date, timeZone: string) =>
  utcIsoToZonedLocal(at.toISOString(), timeZone).slice(0, 7);

/** Start of the first month in the frame, as a UTC instant safe for any time zone (one day early). */
const frameStart = (frame: string[]) => parseDateOnly(addDays(`${frame[0]!}-01`, -1));

// ---------------------------------------------------------------------------
// Relationship graph
// ---------------------------------------------------------------------------

export async function getRelationshipGraph(
  db: Db,
  actor: AuthUser,
  contactId: string,
): Promise<RelationshipGraphData> {
  if (!UUID_PATTERN.test(contactId)) throw notFound();
  const contact = await db.contact.findFirst({
    where: { AND: [contactReadScope(actor, { includeArchived: true }), { id: contactId }] },
    include: {
      owner: { select: { id: true, name: true } },
      clientOrg: { select: { id: true, name: true } },
    },
  });
  if (!contact) throw notFound();

  const readable = {
    deals: can(actor.role, 'deals.read.all') || can(actor.role, 'deals.read.own'),
    proposals: can(actor.role, 'proposals.read.all') || can(actor.role, 'proposals.read.own'),
    projects:
      can(actor.role, 'projects.read.all') ||
      can(actor.role, 'projects.read.member') ||
      can(actor.role, 'projects.read.linked'),
    invoices: can(actor.role, 'invoices.read.all') || can(actor.role, 'invoices.read.project'),
    deliverables: canWork(actor),
  };
  const take = GRAPH_LIMIT + 1;

  const deals = readable.deals
    ? await db.deal.findMany({
        where: { AND: [dealReadScope(actor), { contactId: contact.id }] },
        include: { stage: { select: { name: true } }, owner: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take,
      })
    : [];
  const shownDeals = deals.slice(0, GRAPH_LIMIT);
  const dealIds = shownDeals.map((d) => d.id);

  const proposals =
    readable.proposals && dealIds.length
      ? await db.proposal.findMany({
          where: { AND: [proposalReadScope(actor), { dealId: { in: dealIds } }] },
          include: {
            versions: {
              orderBy: { versionNo: 'desc' },
              take: 1,
              select: { title: true, totalMinor: true, currency: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          take,
        })
      : [];

  // A project belongs here through its deal, or directly through the contact.
  const projects = readable.projects
    ? await db.project.findMany({
        where: {
          AND: [
            projectReadScope(actor),
            {
              OR: [
                ...(dealIds.length ? [{ dealId: { in: dealIds } }] : []),
                { contactId: contact.id },
              ],
            },
          ],
        },
        include: {
          manager: { select: { id: true, name: true } },
          milestones: { select: { status: true } },
        },
        orderBy: { createdAt: 'desc' },
        take,
      })
    : [];
  const shownProjects = projects.slice(0, GRAPH_LIMIT);
  const projectIds = shownProjects.map((p) => p.id);

  const invoices =
    readable.invoices && projectIds.length
      ? await db.invoice.findMany({
          where: { AND: [invoiceScope(actor), { projectId: { in: projectIds } }] },
          orderBy: { createdAt: 'desc' },
          take,
        })
      : [];

  const deliverables =
    readable.deliverables && projectIds.length
      ? await db.deliverable.findMany({
          where: { agencyId: actor.agencyId, projectId: { in: projectIds } },
          select: { id: true, title: true, status: true, projectId: true },
          orderBy: { createdAt: 'desc' },
          take,
        })
      : [];

  return {
    contact: {
      id: contact.id,
      fullName: contact.fullName,
      companyName: contact.companyName,
      lifecycle: contact.lifecycle,
      source: contact.source,
      owner: person(contact.owner),
      clientOrg: contact.clientOrg,
    },
    readable,
    deals: shownDeals.map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      stage: d.stage.name,
      amountMinor: d.amountMinor.toString(),
      currency: d.currency,
      owner: person(d.owner),
    })),
    proposals: proposals.slice(0, GRAPH_LIMIT).map((p) => ({
      id: p.id,
      reference: proposalReference(p.number),
      title: p.versions[0]?.title ?? proposalReference(p.number),
      status: p.status,
      dealId: p.dealId,
      totalMinor: (p.versions[0]?.totalMinor ?? 0n).toString(),
      currency: p.versions[0]?.currency ?? '',
    })),
    projects: shownProjects.map((p) => ({
      id: p.id,
      title: p.title,
      state: p.state,
      dealId: p.dealId,
      manager: person(p.manager),
      milestones: {
        done: p.milestones.filter((m) => m.status === 'DONE').length,
        total: p.milestones.length,
      },
    })),
    invoices: invoices.slice(0, GRAPH_LIMIT).map((i) => ({
      id: i.id,
      reference: i.number === null ? 'Draft invoice' : invoiceReference(i.number),
      status: i.status,
      projectId: i.projectId!,
      totalMinor: i.totalMinor.toString(),
      paidMinor: i.paidMinor.toString(),
      currency: i.currency,
    })),
    deliverables: deliverables.slice(0, GRAPH_LIMIT),
    truncated: {
      deals: deals.length > GRAPH_LIMIT,
      proposals: proposals.length > GRAPH_LIMIT,
      projects: projects.length > GRAPH_LIMIT,
      invoices: invoices.length > GRAPH_LIMIT,
      deliverables: deliverables.length > GRAPH_LIMIT,
    },
  };
}

// ---------------------------------------------------------------------------
// Sales intelligence
// ---------------------------------------------------------------------------

export async function getSalesIntelligence(
  db: Db,
  actor: AuthUser,
  timeZone: string,
  query: TrendQuery,
  now = new Date(),
): Promise<SalesIntelligence> {
  if (!can(actor.role, 'dashboard.sales')) throw forbidden('Your role has no sales dashboard.');
  const scope = dealReadScope(actor);
  const frame = monthFrame(query.months, now, timeZone);
  const since = frameStart(frame);

  const pipeline = await db.pipeline.findFirst({
    where: { agencyId: actor.agencyId },
    include: { stages: { orderBy: { position: 'asc' }, select: { id: true, name: true } } },
  });
  const open = await db.deal.findMany({
    where: { AND: [scope, { status: 'OPEN' }] },
    select: { id: true, stageId: true, amountMinor: true, currency: true, createdAt: true },
  });
  // When did each open deal enter its current stage? The last stage-change activity says so.
  const moves = open.length
    ? await db.activity.groupBy({
        by: ['entityId'],
        where: {
          agencyId: actor.agencyId,
          entityType: 'deal',
          eventType: 'deal.stage_changed',
          entityId: { in: open.map((d) => d.id) },
        },
        _max: { occurredAt: true },
      })
    : [];
  const entered = new Map(moves.map((m) => [m.entityId, m._max.occurredAt]));
  const today = Date.parse(`${agencyToday(now, timeZone)}T00:00:00Z`);
  const stages = (pipeline?.stages ?? []).map((s) => {
    const inStage = open.filter((d) => d.stageId === s.id);
    const totals = new Map<string, bigint>();
    const age = { d0to7: 0, d8to14: 0, d15to30: 0, d31plus: 0 };
    for (const d of inStage) {
      addTo(totals, d.currency, d.amountMinor);
      const since = entered.get(d.id) ?? d.createdAt;
      const localDay = Date.parse(`${agencyToday(since, timeZone)}T00:00:00Z`);
      const days = Math.max(0, Math.round((today - localDay) / 86_400_000));
      if (days <= 7) age.d0to7 += 1;
      else if (days <= 14) age.d8to14 += 1;
      else if (days <= 30) age.d15to30 += 1;
      else age.d31plus += 1;
    }
    return { id: s.id, name: s.name, open: inStage.length, totals: toRecord(totals), age };
  });

  const recent = await db.deal.findMany({
    where: {
      AND: [scope, { OR: [{ closedAt: { gte: since } }, { createdAt: { gte: since } }] }],
    },
    select: { status: true, closedAt: true, createdAt: true, amountMinor: true, currency: true },
  });
  const monthly = frame.map((month) => ({
    month,
    won: 0,
    lost: 0,
    created: 0,
    totals: new Map<string, bigint>(),
    counts: new Map<string, number>(),
  }));
  const byMonth = new Map(monthly.map((m) => [m.month, m]));
  for (const d of recent) {
    const created = byMonth.get(localMonth(d.createdAt, timeZone));
    if (created) created.created += 1;
    if (!d.closedAt) continue;
    const closed = byMonth.get(localMonth(d.closedAt, timeZone));
    if (!closed) continue;
    if (d.status === 'WON') {
      closed.won += 1;
      addTo(closed.totals, d.currency, d.amountMinor);
      closed.counts.set(d.currency, (closed.counts.get(d.currency) ?? 0) + 1);
    } else if (d.status === 'LOST') closed.lost += 1;
  }

  const all = await db.deal.findMany({
    where: scope,
    select: {
      status: true,
      amountMinor: true,
      currency: true,
      contact: { select: { source: true } },
    },
  });
  const sources = new Map<
    string,
    { deals: number; won: number; lost: number; totals: Map<string, bigint> }
  >();
  for (const d of all) {
    const key = d.contact.source ?? '';
    const s = sources.get(key) ?? { deals: 0, won: 0, lost: 0, totals: new Map() };
    s.deals += 1;
    if (d.status === 'WON') {
      s.won += 1;
      addTo(s.totals, d.currency, d.amountMinor);
    }
    if (d.status === 'LOST') s.lost += 1;
    sources.set(key, s);
  }

  // Lead sources, counted on contacts rather than deals, inside the contact read scope. One grouped
  // query replaces a count request per source; roles without contact access get an empty list.
  const contactAccess =
    can(actor.role, 'contacts.read.all') || can(actor.role, 'contacts.read.own');
  const grouped = contactAccess
    ? await db.contact.groupBy({
        by: ['source', 'lifecycle'],
        where: { AND: [contactReadScope(actor), { source: { not: null } }] },
        _count: { _all: true },
      })
    : [];
  const leadSources = new Map<string, { leads: number; clients: number }>();
  for (const g of grouped) {
    if (!g.source) continue;
    const row = leadSources.get(g.source) ?? { leads: 0, clients: 0 };
    row.leads += g._count._all;
    if (g.lifecycle === 'CUSTOMER') row.clients += g._count._all;
    leadSources.set(g.source, row);
  }

  return {
    months: query.months,
    stages,
    leadSources: [...leadSources.entries()]
      .map(([source, r]) => ({ source, ...r }))
      .sort((a, b) => b.leads - a.leads || a.source.localeCompare(b.source)),
    monthly: monthly.map(({ totals, counts, ...m }) => ({
      ...m,
      wonTotals: toRecord(totals),
      wonCounts: Object.fromEntries([...counts.entries()].sort(([a], [b]) => a.localeCompare(b))),
    })),
    sources: [...sources.entries()]
      .map(([source, s]) => ({
        source: source || null,
        deals: s.deals,
        won: s.won,
        lost: s.lost,
        wonTotals: toRecord(s.totals),
      }))
      .sort((a, b) => b.deals - a.deals),
  };
}

// ---------------------------------------------------------------------------
// Finance intelligence
// ---------------------------------------------------------------------------

export async function getFinanceIntelligence(
  db: Db,
  actor: AuthUser,
  timeZone: string,
  query: TrendQuery,
  now = new Date(),
): Promise<FinanceIntelligence> {
  const scope = invoiceScope(actor); // 403 for roles without invoice access
  const frame = monthFrame(query.months, now, timeZone);
  const first = parseDateOnly(`${frame[0]!}-01`);
  const inFrame = new Set(frame);

  const issued = await db.invoice.findMany({
    where: { AND: [scope, { status: { notIn: ['DRAFT', 'VOID'] }, issuedOn: { gte: first } }] },
    select: { issuedOn: true, totalMinor: true, currency: true },
  });
  const payments = await db.payment.findMany({
    where: { invoice: scope, receivedOn: { gte: first } },
    select: { kind: true, amountMinor: true, currency: true, receivedOn: true },
  });
  const series = new Map<string, Map<string, { inv: bigint; rec: bigint }>>();
  const cell = (currency: string, month: string) => {
    const s = series.get(currency) ?? new Map(frame.map((m) => [m, { inv: 0n, rec: 0n }]));
    series.set(currency, s);
    return s.get(month)!;
  };
  for (const i of issued) {
    const month = formatDateOnly(i.issuedOn!).slice(0, 7);
    if (inFrame.has(month)) cell(i.currency, month).inv += i.totalMinor;
  }
  for (const p of payments) {
    const month = formatDateOnly(p.receivedOn).slice(0, 7);
    if (!inFrame.has(month)) continue;
    cell(p.currency, month).rec += p.kind === 'REVERSAL' ? -p.amountMinor : p.amountMinor;
  }

  const byProject = await db.invoice.findMany({
    where: { AND: [scope, { status: { notIn: ['DRAFT', 'VOID'] }, projectId: { not: null } }] },
    select: {
      currency: true,
      totalMinor: true,
      paidMinor: true,
      project: { select: { id: true, title: true } },
    },
  });
  const projects = new Map<
    string,
    { id: string; title: string; currency: string; inv: bigint; paid: bigint; n: number }
  >();
  for (const i of byProject) {
    const key = `${i.project!.id}:${i.currency}`;
    const p = projects.get(key) ?? {
      id: i.project!.id,
      title: i.project!.title,
      currency: i.currency,
      inv: 0n,
      paid: 0n,
      n: 0,
    };
    p.inv += i.totalMinor;
    p.paid += i.paidMinor;
    p.n += 1;
    projects.set(key, p);
  }

  return {
    months: query.months,
    monthly: [...series.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([currency, s]) => ({
        currency,
        points: frame.map((month) => ({
          month,
          invoicedMinor: s.get(month)!.inv.toString(),
          receivedMinor: s.get(month)!.rec.toString(),
        })),
      })),
    projects: [...projects.values()]
      .sort((a, b) => (b.inv > a.inv ? 1 : b.inv < a.inv ? -1 : a.title.localeCompare(b.title)))
      .map((p) => ({
        id: p.id,
        title: p.title,
        currency: p.currency,
        invoicedMinor: p.inv.toString(),
        receivedMinor: p.paid.toString(),
        outstandingMinor: (p.inv - p.paid).toString(),
        invoices: p.n,
      })),
    profitability: can(actor.role, 'finance.view') ? await profitability(db, actor) : null,
  };
}

/**
 * Budget, accepted changes, invoiced (ex VAT), estimated time cost and estimated margin for every
 * non-archived project. Four queries in all, whatever the number of projects: the cost arithmetic
 * is the same as the project finance tab (`costOfEntries`).
 */
async function profitability(db: Db, actor: AuthUser) {
  const projects = await db.project.findMany({
    where: { agencyId: actor.agencyId, state: { not: 'ARCHIVED' } },
    select: { id: true, title: true, state: true, currency: true, budgetMinor: true },
    orderBy: { title: 'asc' },
  });
  const ids = projects.map((p) => p.id);
  const [entries, changes, invoiced] = await Promise.all([
    db.timeEntry.findMany({
      where: { projectId: { in: ids } },
      select: {
        projectId: true,
        userId: true,
        minutes: true,
        workedOn: true,
        user: { select: { name: true } },
      },
    }),
    db.changeRequest.findMany({
      where: { projectId: { in: ids }, status: 'ACCEPTED' },
      select: { projectId: true, acceptedVersion: { select: { priceMinor: true } } },
    }),
    db.invoice.groupBy({
      by: ['projectId'],
      where: { projectId: { in: ids }, status: { notIn: ['DRAFT', 'VOID'] } },
      _sum: { subtotalMinor: true },
    }),
  ]);
  const rates = await db.costRate.findMany({
    where: { userId: { in: [...new Set(entries.map((e) => e.userId))] } },
    orderBy: { effectiveFrom: 'desc' },
  });
  return projects.map((p) => {
    const cost = costOfEntries(
      entries.filter((e) => e.projectId === p.id),
      rates,
      p.currency,
    );
    const added = changes
      .filter((c) => c.projectId === p.id)
      .reduce((n, c) => n + (c.acceptedVersion?.priceMinor ?? 0n), 0n);
    const inv = invoiced.find((i) => i.projectId === p.id)?._sum.subtotalMinor ?? 0n;
    return {
      id: p.id,
      title: p.title,
      state: p.state,
      currency: p.currency,
      originalBudgetMinor: (p.budgetMinor - added).toString(),
      acceptedChangesMinor: added.toString(),
      budgetMinor: p.budgetMinor.toString(),
      invoicedMinor: inv.toString(),
      estimatedCostMinor: cost.estimatedMinor.toString(),
      estimatedMarginMinor: (p.budgetMinor - cost.estimatedMinor).toString(),
      costCompletenessPercent: cost.completenessPercent,
    };
  });
}

// ---------------------------------------------------------------------------
// Delivery intelligence
// ---------------------------------------------------------------------------

/** Monday of the agency week containing `date` (`YYYY-MM-DD`). */
function weekStart(date: string) {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((day + 6) % 7));
}

export async function getDeliveryIntelligence(
  db: Db,
  actor: AuthUser,
  timeZone: string,
  now = new Date(),
): Promise<DeliveryIntelligence> {
  if (!canWork(actor)) throw forbidden('Delivery work is for the project team.');
  const today = agencyToday(now, timeZone);
  const projects = await db.project.findMany({
    where: { AND: [projectReadScope(actor), { state: { in: [...OPEN_PROJECT_STATES] } }] },
    include: {
      manager: { select: { id: true, name: true } },
      milestones: {
        orderBy: { sequence: 'asc' },
        select: { id: true, title: true, dueOn: true, status: true },
      },
    },
    orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { title: 'asc' }],
  });
  const ids = projects.map((p) => p.id);
  const tasks = ids.length
    ? await db.task.findMany({
        where: { agencyId: actor.agencyId, projectId: { in: ids } },
        select: {
          projectId: true,
          status: true,
          dueOn: true,
          estimateMinutes: true,
          assignee: { select: { id: true, name: true } },
        },
      })
    : [];
  // Time: the manager (and Owner/Admin) see everyone's; others see their own (same rule as tasks).
  const managed = new Set(projects.filter((p) => canManage(actor, p)).map((p) => p.id));
  const time = ids.length
    ? await db.timeEntry.groupBy({
        by: ['projectId'],
        where: {
          agencyId: actor.agencyId,
          OR: [
            { projectId: { in: [...managed] } },
            { projectId: { in: ids.filter((i) => !managed.has(i)) }, userId: actor.id },
          ],
        },
        _sum: { minutes: true },
      })
    : [];
  const logged = new Map(time.map((t) => [t.projectId, t._sum.minutes ?? 0]));

  const weekStarts = Array.from({ length: 6 }, (_, i) => addDays(weekStart(today), i * 7));
  const people = new Map<string, DeliveryIntelligence['people'][number]>();
  const isOpen = (s: string) => s !== 'DONE' && s !== 'CANCELED';

  const rows = projects.map((p) => {
    const mine = tasks.filter((t) => t.projectId === p.id);
    const counts = { total: mine.length, done: 0, blocked: 0, overdue: 0, open: 0 };
    let estimate = 0;
    for (const t of mine) {
      estimate += t.estimateMinutes ?? 0;
      if (t.status === 'DONE') counts.done += 1;
      if (t.status === 'BLOCKED') counts.blocked += 1;
      const open = isOpen(t.status);
      const due = t.dueOn ? formatDateOnly(t.dueOn) : null;
      const overdue = open && due !== null && due < today;
      if (open) counts.open += 1;
      if (overdue) counts.overdue += 1;
      if (open && t.assignee) {
        const who = people.get(t.assignee.id) ?? {
          ...person(t.assignee),
          open: 0,
          overdue: 0,
          blocked: 0,
          estimateMinutes: 0,
          dueByWeek: weekStarts.map(() => 0),
        };
        who.open += 1;
        if (overdue) who.overdue += 1;
        if (t.status === 'BLOCKED') who.blocked += 1;
        who.estimateMinutes += t.estimateMinutes ?? 0;
        if (due) {
          const w = weekStarts.indexOf(weekStart(due));
          if (w >= 0) who.dueByWeek[w]! += 1;
        }
        people.set(t.assignee.id, who);
      }
    }
    return {
      id: p.id,
      title: p.title,
      state: p.state,
      startOn: p.startOn ? formatDateOnly(p.startOn) : null,
      dueOn: p.dueOn ? formatDateOnly(p.dueOn) : null,
      manager: person(p.manager),
      milestones: p.milestones.map((m) => ({
        id: m.id,
        title: m.title,
        dueOn: m.dueOn ? formatDateOnly(m.dueOn) : null,
        status: m.status,
      })),
      tasks: counts,
      estimateMinutes: estimate,
      loggedMinutes: logged.get(p.id) ?? 0,
      loggedScope: managed.has(p.id) ? ('all' as const) : ('own' as const),
    };
  });

  return {
    projects: rows,
    people: [...people.values()].sort((a, b) => b.open - a.open || a.name.localeCompare(b.name)),
    weekStarts,
  };
}

/** Milestones, tasks and every dependency of one project the viewer works on. */
export async function getProjectPlan(db: Db, actor: AuthUser, id: string): Promise<ProjectPlan> {
  const p = await findWorkable(db, actor, id);
  const [milestones, tasks, deps] = await Promise.all([
    db.projectMilestone.findMany({ where: { projectId: p.id }, orderBy: { sequence: 'asc' } }),
    db.task.findMany({
      where: { projectId: p.id, agencyId: actor.agencyId },
      include: { assignee: { select: { id: true, name: true } } },
      orderBy: [{ dueOn: { sort: 'asc', nulls: 'last' } }, { createdAt: 'asc' }],
    }),
    db.taskDependency.findMany({
      where: { projectId: p.id },
      select: { taskId: true, dependsOnId: true },
    }),
  ]);
  return {
    project: {
      id: p.id,
      title: p.title,
      startOn: p.startOn ? formatDateOnly(p.startOn) : null,
      dueOn: p.dueOn ? formatDateOnly(p.dueOn) : null,
    },
    milestones: milestones.map((m) => ({
      id: m.id,
      title: m.title,
      dueOn: m.dueOn ? formatDateOnly(m.dueOn) : null,
      status: m.status,
      sequence: m.sequence,
    })),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      priority: t.priority,
      dueOn: t.dueOn ? formatDateOnly(t.dueOn) : null,
      milestoneId: t.milestoneId,
      assignee: t.assignee ? person(t.assignee) : null,
      estimateMinutes: t.estimateMinutes,
    })),
    dependencies: deps,
  };
}
