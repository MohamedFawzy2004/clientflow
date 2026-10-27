// Scheduled reminders (FR-A01, FR-S09). Each run looks at live data and creates the reminders that
// are due. Every reminder has a dedupe key, so running the scan again (or on two servers at once)
// never creates the same reminder twice.
import { changeReference, invoiceReference, proposalReference } from '@clientflow/contracts';
import type { Db } from '../db/client.js';
import { addDays, agencyToday, formatDateOnly, parseDateOnly } from '../lib/agency-time.js';
import { notify, usersWithPermission } from '../lib/notify.js';
import type { Tx } from '../modules/projects/access.js';

/** Follow-ups and tasks are only reminded about while recent; older ones are in the queues. */
const LOOKBACK_DAYS = 7;
/** A published deliverable or a sent change waiting this long on the client reminds the PM. */
const CLIENT_WAIT_DAYS = 3;
/** Proposals that expire this soon without a decision remind their owner. */
const EXPIRY_DAYS = 3;
/** Upper bound per rule and run, so one scan stays a short transaction. */
const PER_RULE = 500;
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
      for (const rule of RULES) created += await rule(tx, { agencyId, now, today });
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

type Rule = (tx: Tx, ctx: Ctx) => Promise<number>;

const overdueFollowUps: Rule = async (tx, { agencyId, now }) => {
  const since = new Date(now.getTime() - LOOKBACK_DAYS * DAY_MS);
  const [contacts, deals] = await Promise.all([
    tx.contact.findMany({
      where: { agencyId, archivedAt: null, nextActionAt: { gte: since, lt: now } },
      select: { id: true, ownerId: true, fullName: true, nextActionAt: true },
      take: PER_RULE,
    }),
    tx.deal.findMany({
      where: { agencyId, archivedAt: null, status: 'OPEN', nextStepAt: { gte: since, lt: now } },
      select: { id: true, ownerId: true, title: true, nextStepAt: true },
      take: PER_RULE,
    }),
  ]);
  let n = 0;
  for (const c of contacts) {
    n += await notify(tx, {
      agencyId,
      recipientIds: [c.ownerId],
      category: 'FOLLOW_UPS',
      type: 'reminder.follow_up_overdue',
      title: `Follow-up overdue: ${c.fullName}`,
      link: `/app/leads/${c.id}`,
      entity: { type: 'contact', id: c.id },
      // A new follow-up date is a new reminder; the same date is reminded once.
      dedupeKey: `follow-up:contact:${c.id}:${c.nextActionAt!.toISOString()}`,
    });
  }
  for (const d of deals) {
    n += await notify(tx, {
      agencyId,
      recipientIds: [d.ownerId],
      category: 'FOLLOW_UPS',
      type: 'reminder.next_step_overdue',
      title: `Next step overdue: ${d.title}`,
      link: `/app/deals/${d.id}`,
      entity: { type: 'deal', id: d.id },
      dedupeKey: `follow-up:deal:${d.id}:${d.nextStepAt!.toISOString()}`,
    });
  }
  return n;
};

const expiringProposals: Rule = async (tx, { agencyId, today }) => {
  const versions = await tx.proposalVersion.findMany({
    where: {
      agencyId,
      status: 'SENT',
      expiresOn: { gte: parseDateOnly(today), lte: parseDateOnly(addDays(today, EXPIRY_DAYS)) },
    },
    include: {
      proposal: { select: { id: true, number: true, deal: { select: { ownerId: true } } } },
    },
    take: PER_RULE,
  });
  let n = 0;
  for (const v of versions) {
    n += await notify(tx, {
      agencyId,
      recipientIds: [v.proposal.deal.ownerId],
      category: 'FOLLOW_UPS',
      type: 'reminder.proposal_expiring',
      title: `${proposalReference(v.proposal.number)} expires on ${formatDateOnly(v.expiresOn)} without a client decision`,
      link: `/app/proposals/${v.proposal.id}`,
      entity: { type: 'proposal', id: v.proposal.id },
      dedupeKey: `proposal-expiring:${v.id}`,
    });
  }
  return n;
};

const dueTasks: Rule = async (tx, { agencyId, today }) => {
  const tasks = await tx.task.findMany({
    where: {
      agencyId,
      assigneeId: { not: null },
      status: { notIn: ['DONE', 'CANCELED'] },
      dueOn: { gte: parseDateOnly(addDays(today, -LOOKBACK_DAYS)), lte: parseDateOnly(today) },
      project: { state: { in: ['PLANNED', 'ACTIVE'] } },
    },
    select: { id: true, title: true, assigneeId: true, dueOn: true, projectId: true },
    take: PER_RULE,
  });
  let n = 0;
  for (const t of tasks) {
    const due = formatDateOnly(t.dueOn!);
    n += await notify(tx, {
      agencyId,
      recipientIds: [t.assigneeId],
      category: 'TASKS',
      type: due === today ? 'reminder.task_due' : 'reminder.task_overdue',
      title: `${due === today ? 'Due today' : `Overdue since ${due}`}: ${t.title}`,
      link: `/app/projects/${t.projectId}/board`,
      entity: { type: 'task', id: t.id },
      dedupeKey: `task-due:${t.id}:${due}`,
    });
  }
  return n;
};

const overdueInvoices: Rule = async (tx, { agencyId, today }) => {
  const invoices = await tx.invoice.findMany({
    where: {
      agencyId,
      status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
      dueOn: { lt: parseDateOnly(today) },
    },
    select: {
      id: true,
      number: true,
      dueOn: true,
      totalMinor: true,
      paidMinor: true,
      clientOrg: { select: { name: true } },
    },
    take: PER_RULE,
  });
  const open = invoices.filter((i) => i.paidMinor < i.totalMinor);
  if (open.length === 0) return 0;
  const finance = await usersWithPermission(tx, agencyId, 'invoices.manage');
  let n = 0;
  for (const i of open) {
    n += await notify(tx, {
      agencyId,
      recipientIds: finance,
      category: 'INVOICES',
      type: 'reminder.invoice_overdue',
      title: `${invoiceReference(i.number)} for ${i.clientOrg.name} is overdue (due ${formatDateOnly(i.dueOn)})`,
      link: `/app/invoices/${i.id}`,
      entity: { type: 'invoice', id: i.id },
      // Once per due date: moving the due date and missing it again reminds again.
      dedupeKey: `invoice-overdue:${i.id}:${formatDateOnly(i.dueOn)}`,
    });
  }
  return n;
};

const waitingOnClient: Rule = async (tx, { agencyId, now }) => {
  const before = new Date(now.getTime() - CLIENT_WAIT_DAYS * DAY_MS);
  const [deliverables, changes] = await Promise.all([
    tx.deliverableVersion.findMany({
      where: {
        agencyId,
        publishedAt: { lt: before },
        review: null,
        deliverable: { status: 'PUBLISHED' },
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
      take: PER_RULE,
    }),
    tx.changeVersion.findMany({
      where: { agencyId, status: 'SENT', sentAt: { lt: before } },
      include: {
        changeRequest: {
          select: { id: true, number: true, project: { select: { id: true, managerId: true } } },
        },
      },
      take: PER_RULE,
    }),
  ]);
  let n = 0;
  for (const v of deliverables) {
    if (v.versionNo !== v.deliverable.currentVersionNo) continue;
    n += await notify(tx, {
      agencyId,
      recipientIds: [v.deliverable.project.managerId],
      category: 'CLIENT_ACTIVITY',
      type: 'reminder.client_review_waiting',
      title: `“${v.deliverable.title}” v${v.versionNo} has waited ${CLIENT_WAIT_DAYS}+ days for the client's review`,
      link: `/app/projects/${v.projectId}/deliverables/${v.deliverable.id}`,
      entity: { type: 'deliverable', id: v.deliverable.id },
      dedupeKey: `client-waiting:deliverable-version:${v.id}`,
    });
  }
  for (const v of changes) {
    const c = v.changeRequest;
    n += await notify(tx, {
      agencyId,
      recipientIds: [c.project.managerId],
      category: 'CLIENT_ACTIVITY',
      type: 'reminder.client_decision_waiting',
      title: `${changeReference(c.number)} v${v.versionNo} has waited ${CLIENT_WAIT_DAYS}+ days for the client's decision`,
      link: `/app/projects/${c.project.id}/changes/${c.id}`,
      entity: { type: 'change_request', id: c.id },
      dedupeKey: `client-waiting:change-version:${v.id}`,
    });
  }
  return n;
};

const RULES: Rule[] = [
  overdueFollowUps,
  expiringProposals,
  dueTasks,
  overdueInvoices,
  waitingOnClient,
];
