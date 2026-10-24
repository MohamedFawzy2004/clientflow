import {
  canAny,
  type FollowUpFilter,
  type FollowUpItem,
  type FollowUpQueue,
} from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { forbidden } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { contactReadScope } from '../contacts/policy.js';
import { followUpWhere } from '../contacts/service.js';
import { dealReadScope } from '../deals/policy.js';

const PER_BUCKET = 50;

/**
 * The "what do I do next" queue (FR-D07, journey J1 step 5): contacts by next action and open
 * deals by next step, bucketed by the agency's calendar day. Every query reuses the same scope as
 * the list pages, so counts never include records the viewer cannot open (SEC-25).
 */
export async function getFollowUps(
  db: Db,
  actor: AuthUser,
  timeZone: string,
): Promise<FollowUpQueue> {
  const readsContacts = canAny(actor.role, ['contacts.read.all', 'contacts.read.own']);
  const readsDeals = canAny(actor.role, ['deals.read.all', 'deals.read.own']);
  if (!readsContacts && !readsDeals) throw forbidden('Your role has no sales follow-ups.');
  const now = new Date();

  async function bucket(filter: FollowUpFilter) {
    const contactWhere: Prisma.ContactWhereInput = {
      AND: [
        contactReadScope(actor),
        followUpWhere(filter, 'nextActionAt', now, timeZone) as Prisma.ContactWhereInput,
        // "No next step" only flags open leads; a quiet customer is not a missing follow-up.
        ...(filter === 'none' ? [{ lifecycle: 'LEAD' as const }] : []),
      ],
    };
    const dealWhere: Prisma.DealWhereInput = {
      AND: [
        dealReadScope(actor),
        { status: 'OPEN' },
        followUpWhere(filter, 'nextStepAt', now, timeZone) as Prisma.DealWhereInput,
      ],
    };
    const sortDue = filter === 'none' ? undefined : ('asc' as const);
    const [contacts, contactCount, deals, dealCount] = await Promise.all([
      readsContacts
        ? db.contact.findMany({
            where: contactWhere,
            include: { owner: { select: { id: true, name: true } } },
            orderBy: sortDue ? { nextActionAt: sortDue } : { updatedAt: 'asc' },
            take: PER_BUCKET,
          })
        : [],
      readsContacts ? db.contact.count({ where: contactWhere }) : 0,
      readsDeals
        ? db.deal.findMany({
            where: dealWhere,
            include: {
              owner: { select: { id: true, name: true } },
              contact: { select: { fullName: true } },
            },
            orderBy: sortDue ? { nextStepAt: sortDue } : { updatedAt: 'asc' },
            take: PER_BUCKET,
          })
        : [],
      readsDeals ? db.deal.count({ where: dealWhere }) : 0,
    ]);
    const items: FollowUpItem[] = [
      ...contacts.map((c) => ({
        type: 'contact' as const,
        id: c.id,
        title: c.fullName,
        subtitle: c.companyName,
        dueAt: c.nextActionAt?.toISOString() ?? null,
        owner: c.owner,
        lifecycle: c.lifecycle,
      })),
      ...deals.map((d) => ({
        type: 'deal' as const,
        id: d.id,
        title: d.title,
        subtitle: d.nextStep ?? d.contact.fullName,
        dueAt: d.nextStepAt?.toISOString() ?? null,
        owner: d.owner,
      })),
    ].sort((a, b) => (a.dueAt ?? '').localeCompare(b.dueAt ?? ''));
    return { items: items.slice(0, PER_BUCKET), count: contactCount + dealCount };
  }

  const [overdue, today, upcoming, noNextStep] = await Promise.all([
    bucket('overdue'),
    bucket('today'),
    bucket('upcoming'),
    bucket('none'),
  ]);
  return {
    overdue: overdue.items,
    today: today.items,
    upcoming: upcoming.items,
    noNextStep: noNextStep.items,
    counts: {
      overdue: overdue.count,
      today: today.count,
      upcoming: upcoming.count,
      noNextStep: noNextStep.count,
    },
  };
}
