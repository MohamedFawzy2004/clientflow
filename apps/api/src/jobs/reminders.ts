// Scheduled reminders (FR-A01, FR-S09). Each run looks at live data and creates the reminders that
// are due. Every reminder has a dedupe key, so running the scan again (or on two servers at once)
// never creates the same reminder twice.
import {
  changeReference,
  invoiceReference,
  proposalReference,
  type NotificationCategory,
} from '@clientflow/contracts';
import type { Db } from '../db/client.js';
import { addDays, agencyToday, formatDateOnly, parseDateOnly } from '../lib/agency-time.js';
import {
  createPlanned,
  planReminders,
  usersWithPermission,
  type ChannelCache,
  type PlannedNotification,
  type ReminderInput,
} from '../lib/notify.js';
import type { Tx } from '../modules/projects/access.js';

/** Follow-ups and tasks are only reminded about while recent; older ones are in the queues. */
const LOOKBACK_DAYS = 7;
/** A published deliverable or a sent change waiting this long on the client reminds the PM. */
const CLIENT_WAIT_DAYS = 3;
/** Proposals that expire this soon without a decision remind their owner. */
const EXPIRY_DAYS = 3;
/**
 * New reminders per source and run, so one scan stays a short transaction. Candidates that were
 * already reminded do not count: the next run picks up where this one stopped.
 */
const PER_RULE = 500;
/** Candidates read per query, and at most this many queries per source and run. */
const PAGE = 500;
const MAX_PAGES = 40;
const DAY_MS = 86_400_000;

export interface ScanResult {
  scanned: boolean;
  created: number;
}

/**
 * Creates due reminders for one agency. A transaction-level advisory lock keeps two workers from
 * scanning the same agency at once; the loser simply skips (the winner covers it).
 */
export async function runReminderScan(db: Db, agencyId: string, now: Date): Promise<ScanResult> {
  return db.$transaction(
    async (tx) => {
      const [lock] = await tx.$queryRaw<Array<{ ok: boolean }>>`
        SELECT pg_try_advisory_xact_lock(hashtext('clientflow.reminders'), hashtext(${agencyId})) AS ok`;
      if (!lock?.ok) return { scanned: false, created: 0 };
      const agency = await tx.agency.findUnique({ where: { id: agencyId } });
      if (!agency) return { scanned: false, created: 0 };
      const today = agencyToday(now, agency.timezone);
      let created = 0;
      for (const source of SOURCES)
        created += await runSource(tx, { agencyId, now, today }, source);
      return { scanned: true, created };
    },
    { timeout: 60_000 },
  );
}

interface Ctx {
  agencyId: string;
  now: Date;
  /** The agency's calendar date, YYYY-MM-DD. */
  today: string;
}

/** One kind of candidate. `page` reads candidates after `after` in id order. */
interface Source {
  category: NotificationCategory;
  page(
    tx: Tx,
    ctx: Ctx,
    after: { id?: { gt: string } },
  ): Promise<Array<{ id: string; reminder: ReminderInput | null }>>;
}

/**
 * Pages through a source in a fixed order and creates up to PER_RULE reminders that do not exist
 * yet. Planning and writing are a few queries per page, not per candidate.
 */
async function runSource(tx: Tx, ctx: Ctx, source: Source): Promise<number> {
  const cache: ChannelCache = new Map();
  const due: PlannedNotification[] = [];
  let reminders = 0;
  let after: string | undefined;
  for (let n = 0; n < MAX_PAGES && reminders < PER_RULE; n++) {
    const rows = await source.page(tx, ctx, after ? { id: { gt: after } } : {});
    if (rows.length === 0) break;
    after = rows[rows.length - 1]!.id;
    const wanted = rows.flatMap((r) => (r.reminder ? [r.reminder] : []));
    const planned = await planReminders(tx, ctx.agencyId, source.category, wanted, cache);
    for (const rowsOfOne of planned) {
      if (rowsOfOne.length === 0) continue;
      if (reminders === PER_RULE) break;
      due.push(...rowsOfOne);
      reminders += 1;
    }
    if (rows.length < PAGE) break;
  }
  return createPlanned(tx, due);
}

const page = { orderBy: { id: 'asc' as const }, take: PAGE };

const overdueContacts: Source = {
  category: 'FOLLOW_UPS',
  async page(tx, { agencyId, now }, after) {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
    const contacts = await tx.contact.findMany({
      where: { agencyId, archivedAt: null, nextActionAt: { gte: since, lt: now }, ...after },
      select: { id: true, ownerId: true, fullName: true, nextActionAt: true },
      ...page,
    });
    return contacts.map((c) => ({
      id: c.id,
      reminder: {
        recipientIds: [c.ownerId],
        type: 'reminder.follow_up_overdue',
        title: `Follow-up overdue: ${c.fullName}`,
        link: `/app/leads/${c.id}`,
        entity: { type: 'contact', id: c.id },
        // A new follow-up date is a new reminder; the same date is reminded once.
        dedupeKey: `follow-up:contact:${c.id}:${c.nextActionAt!.toISOString()}`,
      },
    }));
  },
};

const overdueDeals: Source = {
  category: 'FOLLOW_UPS',
  async page(tx, { agencyId, now }, after) {
    const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
    const deals = await tx.deal.findMany({
      where: {
        agencyId,
        archivedAt: null,
        status: 'OPEN',
        nextStepAt: { gte: since, lt: now },
        ...after,
      },
      select: { id: true, ownerId: true, title: true, nextStepAt: true },
      ...page,
    });
    return deals.map((d) => ({
      id: d.id,
      reminder: {
        recipientIds: [d.ownerId],
        type: 'reminder.next_step_overdue',
        title: `Next step overdue: ${d.title}`,
        link: `/app/deals/${d.id}`,
        entity: { type: 'deal', id: d.id },
        dedupeKey: `follow-up:deal:${d.id}:${d.nextStepAt!.toISOString()}`,
      },
    }));
  },
};

const expiringProposals: Source = {
  category: 'FOLLOW_UPS',
  async page(tx, { agencyId, today }, after) {
    const versions = await tx.proposalVersion.findMany({
      where: {
        agencyId,
        status: 'SENT',
        expiresOn: { gte: parseDateOnly(today), lte: parseDateOnly(addDays(today, EXPIRY_DAYS)) },
        ...after,
      },
      include: {
        proposal: { select: { id: true, number: true, deal: { select: { ownerId: true } } } },
      },
      ...page,
    });
    return versions.map((v) => ({
      id: v.id,
      reminder: {
        recipientIds: [v.proposal.deal.ownerId],
        type: 'reminder.proposal_expiring',
        title: `${proposalReference(v.proposal.number)} expires on ${formatDateOnly(v.expiresOn)} without a client decision`,
        link: `/app/proposals/${v.proposal.id}`,
        entity: { type: 'proposal', id: v.proposal.id },
        dedupeKey: `proposal-expiring:${v.id}`,
      },
    }));
  },
};

const dueTasks: Source = {
  category: 'TASKS',
  async page(tx, { agencyId, today }, after) {
    const tasks = await tx.task.findMany({
      where: {
        agencyId,
        assigneeId: { not: null },
        status: { notIn: ['DONE', 'CANCELED'] },
        dueOn: { gte: parseDateOnly(addDays(today, -LOOKBACK_DAYS)), lte: parseDateOnly(today) },
        project: { state: { in: ['PLANNED', 'ACTIVE'] } },
        ...after,
      },
      select: { id: true, title: true, assigneeId: true, dueOn: true, projectId: true },
      ...page,
    });
    return tasks.map((t) => {
      const due = formatDateOnly(t.dueOn!);
      return {
        id: t.id,
        reminder: {
          recipientIds: [t.assigneeId],
          type: due === today ? 'reminder.task_due' : 'reminder.task_overdue',
          title: `${due === today ? 'Due today' : `Overdue since ${due}`}: ${t.title}`,
          link: `/app/projects/${t.projectId}/board`,
          entity: { type: 'task', id: t.id },
          dedupeKey: `task-due:${t.id}:${due}`,
        },
      };
    });
  },
};

const overdueInvoices: Source = {
  category: 'INVOICES',
  async page(tx, { agencyId, today }, after) {
    const invoices = await tx.invoice.findMany({
      where: {
        agencyId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        dueOn: { lt: parseDateOnly(today) },
        ...after,
      },
      select: {
        id: true,
        number: true,
        dueOn: true,
        totalMinor: true,
        paidMinor: true,
        clientOrg: { select: { name: true } },
      },
      ...page,
    });
    const open = invoices.filter((i) => i.paidMinor < i.totalMinor);
    const finance =
      open.length > 0 ? await usersWithPermission(tx, agencyId, 'invoices.manage') : [];
    return invoices.map((i) => ({
      id: i.id,
      reminder:
        i.paidMinor < i.totalMinor
          ? {
              recipientIds: finance,
              type: 'reminder.invoice_overdue',
              title: `${invoiceReference(i.number)} for ${i.clientOrg.name} is overdue (due ${formatDateOnly(i.dueOn)})`,
              link: `/app/invoices/${i.id}`,
              entity: { type: 'invoice', id: i.id },
              // Once per due date: moving the due date and missing it again reminds again.
              dedupeKey: `invoice-overdue:${i.id}:${formatDateOnly(i.dueOn)}`,
            }
          : null,
    }));
  },
};

const waitingDeliverables: Source = {
  category: 'CLIENT_ACTIVITY',
  async page(tx, { agencyId, now }, after) {
    const before = new Date(now.getTime() - CLIENT_WAIT_DAYS * DAY_MS);
    const versions = await tx.deliverableVersion.findMany({
      where: {
        agencyId,
        publishedAt: { lt: before },
        review: null,
        deliverable: { status: 'PUBLISHED' },
        ...after,
      },
      include: {
        deliverable: {
          select: {
            id: true,
            title: true,
            currentVersionNo: true,
            project: { select: { managerId: true } },
          },
        },
      },
      ...page,
    });
    return versions.map((v) => ({
      id: v.id,
      reminder:
        v.versionNo === v.deliverable.currentVersionNo
          ? {
              recipientIds: [v.deliverable.project.managerId],
              type: 'reminder.client_review_waiting',
              title: `“${v.deliverable.title}” v${v.versionNo} has waited ${CLIENT_WAIT_DAYS}+ days for the client's review`,
              link: `/app/projects/${v.projectId}/deliverables/${v.deliverable.id}`,
              entity: { type: 'deliverable', id: v.deliverable.id },
              dedupeKey: `client-waiting:deliverable-version:${v.id}`,
            }
          : null,
    }));
  },
};

const waitingChanges: Source = {
  category: 'CLIENT_ACTIVITY',
  async page(tx, { agencyId, now }, after) {
    const before = new Date(now.getTime() - CLIENT_WAIT_DAYS * DAY_MS);
    const versions = await tx.changeVersion.findMany({
      where: { agencyId, status: 'SENT', sentAt: { lt: before }, ...after },
      include: {
        changeRequest: {
          select: { id: true, number: true, project: { select: { id: true, managerId: true } } },
        },
      },
      ...page,
    });
    return versions.map((v) => {
      const c = v.changeRequest;
      return {
        id: v.id,
        reminder: {
          recipientIds: [c.project.managerId],
          type: 'reminder.client_decision_waiting',
          title: `${changeReference(c.number)} v${v.versionNo} has waited ${CLIENT_WAIT_DAYS}+ days for the client's decision`,
          link: `/app/projects/${c.project.id}/changes/${c.id}`,
          entity: { type: 'change_request', id: c.id },
          dedupeKey: `client-waiting:change-version:${v.id}`,
        },
      };
    });
  },
};

const SOURCES: Source[] = [
  overdueContacts,
  overdueDeals,
  expiringProposals,
  dueTasks,
  overdueInvoices,
  waitingDeliverables,
  waitingChanges,
];
