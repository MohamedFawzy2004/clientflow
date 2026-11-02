import {
  can,
  type ContactCreate,
  type ContactListFilters,
  type PossibleDuplicate,
} from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { agencyDayBounds } from '../../lib/agency-time.js';
import { writeAudit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { normalizeEmail, normalizePhone } from '../../lib/normalize.js';
import { actorSelect, recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { dealReadScope } from '../deals/policy.js';
import { dealInclude } from '../deals/serializer.js';
import { assertCanCreateContact, contactReadScope } from './policy.js';

export const ownerSelect = { select: { id: true, name: true } } as const;
export const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const UPCOMING_DAYS = 7;

/** PostgreSQL LIKE uses backslash as its default escape character. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

/** Follow-up buckets by agency calendar day (overdue / due today / next 7 days / none). */
export function followUpWhere(
  filter: NonNullable<ContactListFilters['followUp']>,
  field: 'nextActionAt' | 'nextStepAt',
  now: Date,
  timeZone: string,
): Record<string, unknown> {
  const { end } = agencyDayBounds(now, timeZone);
  const upcomingEnd = new Date(end.getTime() + UPCOMING_DAYS * 86_400_000);
  switch (filter) {
    case 'overdue':
      return { [field]: { lt: now } };
    case 'today':
      return { [field]: { gte: now, lt: end } };
    case 'upcoming':
      return { [field]: { gte: end, lt: upcomingEnd } };
    case 'none':
      return { [field]: null };
  }
}

export async function listContacts(
  db: Db,
  actor: AuthUser,
  query: ContactListFilters,
  timeZone: string,
) {
  const archivedView = query.archived === 'true';
  const scope = contactReadScope(actor, { includeArchived: archivedView });
  const filters: Prisma.ContactWhereInput[] = [scope];
  if (archivedView) filters.push({ archivedAt: { not: null } });
  if (query.lifecycle) filters.push({ lifecycle: query.lifecycle });
  if (query.source) filters.push({ source: query.source });
  if (query.ownerId) filters.push({ ownerId: query.ownerId });
  if (query.followUp) {
    filters.push(
      followUpWhere(
        query.followUp,
        'nextActionAt',
        new Date(),
        timeZone,
      ) as Prisma.ContactWhereInput,
    );
  }
  if (query.q) {
    // Prisma parameterizes values, but `contains` does not escape LIKE wildcards, so % and _
    // are escaped here to keep search input literal (T-SEC-02).
    const q = escapeLike(query.q);
    const or: Prisma.ContactWhereInput[] = [
      { fullName: { contains: q, mode: 'insensitive' } },
      { emailNorm: { contains: q.toLowerCase() } },
      { companyName: { contains: q, mode: 'insensitive' } },
    ];
    const digits = q.replace(/\D/g, '');
    if (digits.length >= 3) or.push({ phoneNorm: { contains: digits } });
    filters.push({ OR: or });
  }
  const where: Prisma.ContactWhereInput = { AND: filters };
  // Follow-up views read best soonest-first; everything else newest-first.
  const orderBy: Prisma.ContactOrderByWithRelationInput[] =
    query.followUp && query.followUp !== 'none'
      ? [{ nextActionAt: 'asc' }, { id: 'asc' }]
      : [{ createdAt: 'desc' }, { id: 'desc' }];

  const [total, rows] = await db.$transaction([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      include: { owner: ownerSelect },
      orderBy,
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);
  return { total, rows };
}

/** Detail includes archived contacts (so they can be restored), the timeline and scoped deals. */
export async function getContact(db: Db, actor: AuthUser, id: string) {
  const scope = contactReadScope(actor, { includeArchived: true });
  // Invalid IDs and out-of-scope IDs both return the same 404.
  if (!UUID_PATTERN.test(id)) throw notFound();
  const contact = await db.contact.findFirst({
    where: { AND: [scope, { id }] },
    include: { owner: ownerSelect, clientOrg: { select: { id: true, name: true } } },
  });
  if (!contact) throw notFound();
  const activities = await db.activity.findMany({
    where: { agencyId: actor.agencyId, entityType: 'contact', entityId: contact.id },
    include: actorSelect,
    orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
    take: 50,
  });
  // Deals are scoped on their own: seeing a contact does not grant sight of every deal on it.
  const deals = canReadDeals(actor)
    ? await db.deal.findMany({
        where: { AND: [dealReadScope(actor), { contactId: contact.id }] },
        include: dealInclude,
        orderBy: { updatedAt: 'desc' },
        take: 50,
      })
    : [];
  return { contact, activities, deals };
}

function canReadDeals(actor: AuthUser) {
  return can(actor.role, 'deals.read.all') || can(actor.role, 'deals.read.own');
}

/** Duplicate hints are limited to the actor's own scope, so they never leak hidden records. */
async function findPossibleDuplicates(
  db: Db,
  actor: AuthUser,
  emailNorm: string | null,
  phoneNorm: string | null,
): Promise<PossibleDuplicate[]> {
  const or: Prisma.ContactWhereInput[] = [];
  if (emailNorm) or.push({ emailNorm });
  if (phoneNorm) or.push({ phoneNorm });
  if (or.length === 0) return [];
  const matches = await db.contact.findMany({
    where: { AND: [contactReadScope(actor), { OR: or }] },
    select: { id: true, fullName: true, emailNorm: true, phoneNorm: true },
    orderBy: { createdAt: 'asc' },
    take: 5,
  });
  return matches.map((m) => ({
    id: m.id,
    fullName: m.fullName,
    matchedOn: [
      ...(emailNorm && m.emailNorm === emailNorm ? (['email'] as const) : []),
      ...(phoneNorm && m.phoneNorm === phoneNorm ? (['phone'] as const) : []),
    ],
  }));
}

/**
 * Creates a lead owned by the actor. The contact, its first activity and the audit event are
 * written in one transaction (journey J1 step 2). Duplicates are reported, never merged.
 */
export async function createContact(
  db: Db,
  actor: AuthUser,
  input: ContactCreate,
  requestId: string,
) {
  assertCanCreateContact(actor);
  const emailNorm = input.email ? normalizeEmail(input.email) : null;
  const phoneNorm = input.phone ? normalizePhone(input.phone) : null;
  const possibleDuplicates = await findPossibleDuplicates(db, actor, emailNorm, phoneNorm);

  const contact = await db.$transaction(async (tx) => {
    const lifecycle = input.lifecycle ?? 'LEAD';
    const created = await tx.contact.create({
      data: {
        agencyId: actor.agencyId,
        ownerId: actor.id,
        fullName: input.fullName,
        emailNorm,
        phone: input.phone ?? null,
        phoneNorm,
        companyName: input.companyName ?? null,
        lifecycle,
        convertedAt: lifecycle === 'CUSTOMER' ? new Date() : null,
        source: input.source ?? null,
        nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
        notes: input.notes ?? null,
      },
      include: { owner: ownerSelect },
    });
    await recordActivity(tx, actor, {
      entityType: 'contact',
      entityId: created.id,
      eventType: 'contact.created',
      summary: `${lifecycle === 'LEAD' ? 'Lead' : 'Customer'} added by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'contact.create',
      outcome: 'SUCCESS',
      targetType: 'contact',
      targetId: created.id,
      requestId,
      metadata: { possibleDuplicateCount: possibleDuplicates.length },
    });
    return created;
  });

  return { contact, possibleDuplicates };
}
