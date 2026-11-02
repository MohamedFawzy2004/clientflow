// What each job kind does. Emails carry a sign-in link and a generic sentence only: no names,
// amounts, scope or comment text (SEC-24). Handlers are safe to run twice.
import {
  NOTIFICATION_CATEGORY_INFO,
  proposalReference,
  type NotificationCategory,
} from '@clientflow/contracts';
import type { Logger } from 'pino';
import type { Db } from '../db/client.js';
import type { Mailer } from '../lib/mailer.js';
import { JOB_PAYLOADS, type JobKind } from './outbox.js';
import { runReminderScan } from './reminders.js';

export interface WorkerDeps {
  db: Db;
  mailer: Mailer;
  logger: Logger;
  /** Base URL for links, without a trailing slash. */
  publicUrl: string;
}

/** Event types whose emails keep the names they had before the outbox (tests and sinks use them). */
const EMAIL_FOR_TYPE: Record<string, { kind: string; subject: string }> = {
  'change.client_requested': { kind: 'change_requested', subject: 'A client requested a change' },
  'change.client_accepted': {
    kind: 'change_decision',
    subject: 'A client decided on a change request',
  },
  'change.client_rejected': {
    kind: 'change_decision',
    subject: 'A client decided on a change request',
  },
  'comment.client': { kind: 'client_comment', subject: 'A client commented' },
  'deliverable.client_approved': {
    kind: 'deliverable_decision',
    subject: 'A client decided on a deliverable',
  },
  'deliverable.client_changes_requested': {
    kind: 'deliverable_decision',
    subject: 'A client decided on a deliverable',
  },
  'proposal.client_accept': {
    kind: 'proposal_decision',
    subject: 'A client decided on a proposal',
  },
  'proposal.client_reject': {
    kind: 'proposal_decision',
    subject: 'A client decided on a proposal',
  },
  'proposal.client_request_changes': {
    kind: 'proposal_decision',
    subject: 'A client decided on a proposal',
  },
};

function notificationEmail(
  publicUrl: string,
  n: { id: string; type: string; category: NotificationCategory; link: string },
) {
  const known = EMAIL_FOR_TYPE[n.type];
  const label = NOTIFICATION_CATEGORY_INFO[n.category].label.toLowerCase();
  return {
    kind: known?.kind ?? 'notification',
    subject: known?.subject ?? `ClientFlow: something new in ${label}`,
    text: [
      'You have a new notification in ClientFlow.',
      '',
      'Open it here (you will be asked to sign in):',
      `${publicUrl}${n.link}`,
      '',
      `Choose which emails you get: ${publicUrl}/app/notifications/settings`,
    ].join('\n'),
  };
}

async function sendNotificationEmail(deps: WorkerDeps, notificationId: string) {
  const { db, mailer, publicUrl } = deps;
  const n = await db.notification.findUnique({
    where: { id: notificationId },
    include: { recipient: { select: { emailNorm: true, active: true, role: true } } },
  });
  // Already emailed, deleted, or the person left: nothing to send.
  if (!n || n.emailedAt || !n.recipient.active || n.recipient.role === 'CLIENT') return;
  const email = notificationEmail(publicUrl, n);
  await mailer.send({
    ...email,
    to: n.recipient.emailNorm,
    idempotencyKey: `notification-${n.id}`,
  });
  await db.notification.update({ where: { id: n.id }, data: { emailedAt: new Date() } });
}

async function sendPortalEmail(
  deps: WorkerDeps,
  jobId: string,
  p: { template: 'change_sent' | 'proposal_sent'; userId: string; entityId: string },
) {
  const { db, mailer, publicUrl } = deps;
  const user = await db.user.findUnique({ where: { id: p.userId } });
  if (!user || !user.active || user.role !== 'CLIENT' || !user.clientOrgId) return;
  if (p.template === 'change_sent') {
    // Still shared with this client? Access may have been revoked since the job was queued.
    const change = await db.changeRequest.findFirst({
      where: {
        id: p.entityId,
        project: { shares: { some: { userId: user.id, revokedAt: null } } },
      },
    });
    if (!change) return;
    await mailer.send({
      kind: 'change_sent',
      to: user.emailNorm,
      subject: 'A change to your project is waiting for your decision',
      // Link only: scope and price stay in the portal (SEC-24).
      text: `Review it here:\n\n${publicUrl}/portal/changes/${change.id}`,
      idempotencyKey: `job-${jobId}`,
    });
    return;
  }
  const proposal = await db.proposal.findFirst({
    where: { id: p.entityId, clientOrgId: user.clientOrgId },
    include: { agency: { select: { name: true } } },
  });
  if (!proposal) return;
  await mailer.send({
    kind: 'proposal_sent',
    to: user.emailNorm,
    subject: `${proposal.agency.name} sent you proposal ${proposalReference(proposal.number)}`,
    text: [
      'Hello,',
      '',
      `${proposal.agency.name} shared a proposal with you on ClientFlow.`,
      'Sign in to review it:',
      `${publicUrl}/portal/proposals/${proposal.id}`,
    ].join('\n'),
    idempotencyKey: `job-${jobId}`,
  });
}

/** Runs one claimed job. Throwing schedules a retry (or the dead letter). */
export async function handleJob(
  deps: WorkerDeps,
  job: { id: string; kind: string; payload: unknown },
) {
  const kind = job.kind as JobKind;
  switch (kind) {
    case 'email.notification': {
      const p = JOB_PAYLOADS[kind].parse(job.payload);
      return sendNotificationEmail(deps, p.notificationId);
    }
    case 'email.portal': {
      const p = JOB_PAYLOADS[kind].parse(job.payload);
      return sendPortalEmail(deps, job.id, p);
    }
    case 'reminders.scan': {
      const p = JOB_PAYLOADS[kind].parse(job.payload);
      await runReminderScan(deps.db, p.agencyId, new Date());
      return;
    }
    default:
      throw new Error(`Unknown job kind ${job.kind}`);
  }
}
