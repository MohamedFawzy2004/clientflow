import {
  can,
  minorToDecimalString,
  proposalReference,
  zonedLocalToUtcIso,
  type Currency,
  type DashboardQuery,
  type MoneyTotals,
  type OwnerRow,
  type Reminder,
  type ReminderList,
  type SalesDashboard,
} from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { addDays, agencyToday, parseDateOnly, utcToLocalDateTime } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { forbidden, validationFailed } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { contactReadScope } from '../contacts/policy.js';
import { followUpWhere } from '../contacts/service.js';
import { dealReadScope } from '../deals/policy.js';
import { proposalReadScope } from '../proposals/service.js';

interface Range {
  from: string;
  to: string;
  start: Date;
  end: Date;
  today: string;
}

/** Inclusive agency-local dates → [start, end) instants. Defaults: this month to date. */
function resolveRange(query: { from?: string; to?: string }, timeZone: string): Range {
  const today = agencyToday(new Date(), timeZone);
  const from = query.from ?? `${today.slice(0, 8)}01`;
  const to = query.to ?? today;
  if (from > to) throw validationFailed({ to: ['The end date is before the start.'] });
  return {
    from,
    to,
    today,
    start: new Date(zonedLocalToUtcIso(`${from}T00:00`, timeZone)!),
    end: new Date(zonedLocalToUtcIso(`${addDays(to, 1)}T00:00`, timeZone)!),
  };
}

/**
 * Who the numbers are about. Managers see the agency or one chosen owner; a salesperson only
 * ever sees their own records, and asking for someone else is refused rather than ignored.
 */
async function resolveOwner(db: Db, actor: AuthUser, ownerId: string | undefined) {
  if (!can(actor.role, 'dashboard.sales')) throw forbidden('Your role has no sales dashboard.');
  if (!can(actor.role, 'dashboard.team')) {
    if (ownerId && ownerId !== actor.id) throw forbidden('You can only see your own numbers.');
    return { id: actor.id, name: actor.name };
  }
  if (!ownerId) return null;
  const owner = await db.user.findFirst({
    where: { id: ownerId, agencyId: actor.agencyId, role: { not: 'CLIENT' } },
    select: { id: true, name: true },
  });
  if (!owner) throw validationFailed({ ownerId: ['Choose an owner from the list.'] });
  return owner;
}

function totals(
  rows: Array<{
    currency: string;
    _sum: { amountMinor?: bigint | null; totalMinor?: bigint | null };
  }>,
): MoneyTotals {
  const out: MoneyTotals = {};
  for (const r of rows) {
    const v = r._sum.amountMinor ?? r._sum.totalMinor ?? 0n;
    out[r.currency as Currency] = (BigInt(out[r.currency as Currency] ?? '0') + v).toString();
  }
  return out;
}

/**
 * The sales dashboard (FR-F08, US-15). Every number is a database aggregate inside the viewer's
 * scope, the same scope the list pages use, so hidden records are never counted (T-ACL-05).
 * Money is summed per currency and never across currencies.
 */
export async function getSalesDashboard(
  db: Db,
  actor: AuthUser,
  timeZone: string,
  query: DashboardQuery,
): Promise<SalesDashboard> {
  const owner = await resolveOwner(db, actor, query.ownerId);
  const range = resolveRange(query, timeZone);
  const ownerDeal: Prisma.DealWhereInput = owner ? { ownerId: owner.id } : {};
  const deals = (extra: Prisma.DealWhereInput): Prisma.DealWhereInput => ({
    AND: [dealReadScope(actor), ownerDeal, extra],
  });
  const closedIn = { closedAt: { gte: range.start, lt: range.end } };
  const proposals = (extra: Prisma.ProposalWhereInput): Prisma.ProposalWhereInput => ({
    AND: [proposalReadScope(actor), owner ? { deal: { ownerId: owner.id } } : {}, extra],
  });
  const now = new Date();
  const contactsDue = (filter: 'overdue' | 'today'): Prisma.ContactWhereInput => ({
    AND: [
      contactReadScope(actor),
      owner ? { ownerId: owner.id } : {},
      followUpWhere(filter, 'nextActionAt', now, timeZone) as Prisma.ContactWhereInput,
    ],
  });
  const dealsDue = (filter: 'overdue' | 'today') =>
    deals({
      status: 'OPEN',
      ...(followUpWhere(filter, 'nextStepAt', now, timeZone) as Prisma.DealWhereInput),
    });
  const todayDate = parseDateOnly(range.today);
  const weekDate = parseDateOnly(addDays(range.today, 7));

  const [
    open,
    won,
    lostCount,
    newLeads,
    inReview,
    awaitingClient,
    expiring,
    accepted,
    overdueC,
    overdueD,
    todayC,
    todayD,
  ] = await Promise.all([
    db.deal.groupBy({
      by: ['currency'],
      where: deals({ status: 'OPEN' }),
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    db.deal.groupBy({
      by: ['currency'],
      where: deals({ status: 'WON', ...closedIn }),
      _sum: { amountMinor: true },
      _count: { _all: true },
    }),
    db.deal.count({ where: deals({ status: 'LOST', ...closedIn }) }),
    db.contact.count({
      where: {
        AND: [
          contactReadScope(actor, { includeArchived: true }),
          owner ? { ownerId: owner.id } : {},
          { createdAt: { gte: range.start, lt: range.end } },
        ],
      },
    }),
    db.proposal.count({ where: proposals({ status: 'IN_REVIEW' }) }),
    db.proposal.count({
      where: proposals({ versions: { some: { status: 'SENT', expiresOn: { gte: todayDate } } } }),
    }),
    db.proposal.count({
      where: proposals({
        versions: { some: { status: 'SENT', expiresOn: { gte: todayDate, lte: weekDate } } },
      }),
    }),
    db.proposalVersion.groupBy({
      by: ['currency'],
      where: {
        status: 'ACCEPTED',
        decidedAt: { gte: range.start, lt: range.end },
        proposal: proposals({}),
      },
      _sum: { totalMinor: true },
      _count: { _all: true },
    }),
    db.contact.count({ where: contactsDue('overdue') }),
    db.deal.count({ where: dealsDue('overdue') }),
    db.contact.count({ where: contactsDue('today') }),
    db.deal.count({ where: dealsDue('today') }),
  ]);

  const wonCount = won.reduce((n, r) => n + r._count._all, 0);
  const closed = wonCount + lostCount;

  let byOwner: OwnerRow[] | null = null;
  if (can(actor.role, 'dashboard.team')) {
    const [openBy, wonBy] = await Promise.all([
      db.deal.groupBy({
        by: ['ownerId', 'currency'],
        where: deals({ status: 'OPEN' }),
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
      db.deal.groupBy({
        by: ['ownerId', 'currency'],
        where: deals({ status: 'WON', ...closedIn }),
        _sum: { amountMinor: true },
        _count: { _all: true },
      }),
    ]);
    const ids = [...new Set([...openBy, ...wonBy].map((r) => r.ownerId))];
    const users = await db.user.findMany({
      where: { id: { in: ids }, agencyId: actor.agencyId },
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    byOwner = users.map((u) => {
      const mine = <T extends { ownerId: string }>(rows: T[]) =>
        rows.filter((r) => r.ownerId === u.id);
      return {
        owner: u,
        openDeals: mine(openBy).reduce((n, r) => n + r._count._all, 0),
        openTotals: totals(mine(openBy)),
        won: mine(wonBy).reduce((n, r) => n + r._count._all, 0),
        wonTotals: totals(mine(wonBy)),
      };
    });
  }

  return {
    range: { from: range.from, to: range.to, timeZone },
    owner,
    pipeline: { openDeals: open.reduce((n, r) => n + r._count._all, 0), totals: totals(open) },
    won: { count: wonCount, totals: totals(won) },
    lost: { count: lostCount },
    winRatePercent: closed === 0 ? null : Math.round((wonCount * 100) / closed),
    newLeads,
    proposals: {
      inReview,
      awaitingClient,
      expiringIn7Days: expiring,
      accepted: accepted.reduce((n, r) => n + r._count._all, 0),
      acceptedTotals: totals(accepted),
    },
    followUps: { overdue: overdueC + overdueD, dueToday: todayC + todayD },
    byOwner,
  };
}

// ---------------------------------------------------------------------------
// Reminders (FR-A01)
// ---------------------------------------------------------------------------

const REMINDER_LIMIT = 50;

/**
 * Personal reminders, computed from live data on each request: the viewer's own overdue and due
 * follow-ups, proposals waiting for their review (approvers), and their proposals that need
 * attention (client asked for changes, or expiring within 3 days).
 */
export async function getReminders(
  db: Db,
  actor: AuthUser,
  timeZone: string,
): Promise<ReminderList> {
  if (!can(actor.role, 'dashboard.sales')) throw forbidden('Your role has no sales reminders.');
  const now = new Date();
  const today = agencyToday(now, timeZone);
  const mineContacts = (f: 'overdue' | 'today'): Prisma.ContactWhereInput => ({
    AND: [
      contactReadScope(actor),
      { ownerId: actor.id },
      followUpWhere(f, 'nextActionAt', now, timeZone) as Prisma.ContactWhereInput,
    ],
  });
  const mineDeals = (f: 'overdue' | 'today'): Prisma.DealWhereInput => ({
    AND: [
      dealReadScope(actor),
      { ownerId: actor.id, status: 'OPEN' },
      followUpWhere(f, 'nextStepAt', now, timeZone) as Prisma.DealWhereInput,
    ],
  });
  const myProposals: Prisma.ProposalWhereInput = {
    AND: [proposalReadScope(actor), { deal: { ownerId: actor.id } }],
  };

  const [cOver, dOver, cToday, dToday, reviews, changes, expiring] = await Promise.all([
    db.contact.findMany({
      where: mineContacts('overdue'),
      orderBy: { nextActionAt: 'asc' },
      take: REMINDER_LIMIT,
    }),
    db.deal.findMany({
      where: mineDeals('overdue'),
      orderBy: { nextStepAt: 'asc' },
      take: REMINDER_LIMIT,
    }),
    db.contact.findMany({
      where: mineContacts('today'),
      orderBy: { nextActionAt: 'asc' },
      take: REMINDER_LIMIT,
    }),
    db.deal.findMany({
      where: mineDeals('today'),
      orderBy: { nextStepAt: 'asc' },
      take: REMINDER_LIMIT,
    }),
    can(actor.role, 'proposals.approve')
      ? db.proposal.findMany({
          where: { AND: [proposalReadScope(actor), { status: 'IN_REVIEW' }] },
          include: { deal: { select: { title: true, owner: { select: { name: true } } } } },
          orderBy: { updatedAt: 'asc' },
          take: REMINDER_LIMIT,
        })
      : [],
    db.proposal.findMany({
      where: { AND: [myProposals, { status: 'CHANGES_REQUESTED' }] },
      include: { deal: { select: { title: true } } },
      orderBy: { updatedAt: 'asc' },
      take: REMINDER_LIMIT,
    }),
    db.proposal.findMany({
      where: {
        AND: [
          myProposals,
          {
            versions: {
              some: {
                status: 'SENT',
                expiresOn: { gte: parseDateOnly(today), lte: parseDateOnly(addDays(today, 3)) },
              },
            },
          },
        ],
      },
      include: {
        deal: { select: { title: true } },
        versions: { where: { status: 'SENT' }, select: { expiresOn: true } },
      },
      take: REMINDER_LIMIT,
    }),
  ]);

  const items: Reminder[] = [
    ...cOver.map((c) => ({
      kind: 'follow_up_overdue' as const,
      id: `c-${c.id}`,
      title: c.fullName,
      detail: 'Follow-up overdue',
      href: `/app/leads/${c.id}`,
      dueAt: c.nextActionAt?.toISOString() ?? null,
    })),
    ...dOver.map((d) => ({
      kind: 'follow_up_overdue' as const,
      id: `d-${d.id}`,
      title: d.title,
      detail: d.nextStep ? `Next step overdue: ${d.nextStep}` : 'Next step overdue',
      href: `/app/deals/${d.id}`,
      dueAt: d.nextStepAt?.toISOString() ?? null,
    })),
    ...reviews.map((p) => ({
      kind: 'proposal_review' as const,
      id: `r-${p.id}`,
      title: `${proposalReference(p.number)} · ${p.deal.title}`,
      detail: `Waiting for your review (from ${p.deal.owner.name})`,
      href: `/app/proposals/${p.id}`,
      dueAt: null,
    })),
    ...changes.map((p) => ({
      kind: 'proposal_changes' as const,
      id: `x-${p.id}`,
      title: `${proposalReference(p.number)} · ${p.deal.title}`,
      detail: 'The client asked for changes',
      href: `/app/proposals/${p.id}`,
      dueAt: null,
    })),
    ...expiring.map((p) => ({
      kind: 'proposal_expiring' as const,
      id: `e-${p.id}`,
      title: `${proposalReference(p.number)} · ${p.deal.title}`,
      detail: `Expires ${p.versions[0]?.expiresOn.toISOString().slice(0, 10) ?? ''} without a client decision`,
      href: `/app/proposals/${p.id}`,
      dueAt: null,
    })),
    ...cToday.map((c) => ({
      kind: 'follow_up_today' as const,
      id: `ct-${c.id}`,
      title: c.fullName,
      detail: 'Follow-up due today',
      href: `/app/leads/${c.id}`,
      dueAt: c.nextActionAt?.toISOString() ?? null,
    })),
    ...dToday.map((d) => ({
      kind: 'follow_up_today' as const,
      id: `dt-${d.id}`,
      title: d.title,
      detail: d.nextStep ? `Next step today: ${d.nextStep}` : 'Next step due today',
      href: `/app/deals/${d.id}`,
      dueAt: d.nextStepAt?.toISOString() ?? null,
    })),
  ];
  return { items: items.slice(0, REMINDER_LIMIT), total: items.length };
}

// ---------------------------------------------------------------------------
// CSV export (US-22)
// ---------------------------------------------------------------------------

export const EXPORT_ROW_LIMIT = 5000;

/**
 * One CSV cell. Text that a spreadsheet would treat as a formula (= + - @, tab, carriage
 * return) is prefixed with an apostrophe, so it is shown as text and never executed (OWASP CSV
 * injection). Every cell is quoted, with quotes doubled.
 */
export function csvCell(value: string | null | undefined): string {
  let v = value ?? '';
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  return `"${v.replace(/"/g, '""')}"`;
}

export async function exportDealsCsv(
  db: Db,
  actor: AuthUser,
  timeZone: string,
  query: DashboardQuery,
  requestId: string,
): Promise<{ filename: string; body: string; rows: number }> {
  if (!can(actor.role, 'reports.export')) throw forbidden('Your role cannot export reports.');
  const owner = await resolveOwner(db, actor, query.ownerId);
  const range = resolveRange(query, timeZone);
  const inRange = { gte: range.start, lt: range.end };
  const rows = await db.deal.findMany({
    where: {
      AND: [
        dealReadScope(actor),
        owner ? { ownerId: owner.id } : {},
        { OR: [{ createdAt: inRange }, { closedAt: inRange }] },
      ],
    },
    include: {
      contact: { select: { fullName: true, companyName: true } },
      owner: { select: { name: true } },
      stage: { select: { name: true } },
    },
    orderBy: { createdAt: 'asc' },
    take: EXPORT_ROW_LIMIT,
  });
  const header = [
    'Deal',
    'Contact',
    'Company',
    'Owner',
    'Stage',
    'Status',
    'Currency',
    'Amount',
    'Created',
    'Closed',
    'Lost reason',
  ];
  const lines = [header.map(csvCell).join(',')];
  for (const d of rows) {
    lines.push(
      [
        d.title,
        d.contact.fullName,
        d.contact.companyName,
        d.owner.name,
        d.stage.name,
        d.status,
        d.currency,
        minorToDecimalString(d.amountMinor, d.currency as Currency),
        utcToLocalDateTime(d.createdAt, timeZone),
        d.closedAt ? utcToLocalDateTime(d.closedAt, timeZone) : '',
        d.lostReason,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'export.deals',
    outcome: 'SUCCESS',
    requestId,
    metadata: { rows: rows.length, from: range.from, to: range.to, ownerId: owner?.id ?? null },
  });
  // UTF-8 BOM so spreadsheet apps read Arabic names correctly; CRLF per RFC 4180.
  return {
    filename: `deals-${range.from}-to-${range.to}.csv`,
    body: `\uFEFF${lines.join('\r\n')}\r\n`,
    rows: rows.length,
  };
}
