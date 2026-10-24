import type {
  ContactCreate,
  ContactListQuery,
  PossibleDuplicate,
} from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { normalizeEmail, normalizePhone } from '../../lib/normalize.js';
import type { AuthUser } from '../../types/express.js';
import { assertCanCreateContact, contactReadScope } from './policy.js';

const ownerSelect = { select: { id: true, name: true } } as const;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** PostgreSQL LIKE uses backslash as its default escape character. */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

export async function listContacts(db: Db, actor: AuthUser, query: ContactListQuery) {
  const scope = contactReadScope(actor);
  const filters: Prisma.ContactWhereInput[] = [scope];
  if (query.lifecycle) filters.push({ lifecycle: query.lifecycle });
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

  const [total, rows] = await db.$transaction([
    db.contact.count({ where }),
    db.contact.findMany({
      where,
      include: { owner: ownerSelect },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
  ]);
  return { total, rows };
}

export async function getContact(db: Db, actor: AuthUser, id: string) {
  const scope = contactReadScope(actor);
  // Invalid IDs and out-of-scope IDs both return the same 404.
  if (!UUID_PATTERN.test(id)) throw notFound();
  const contact = await db.contact.findFirst({
    where: { AND: [scope, { id }] },
    include: { owner: ownerSelect },
  });
  if (!contact) throw notFound();
  const activities = await db.activity.findMany({
    where: { agencyId: actor.agencyId, entityType: 'contact', entityId: contact.id },
    include: { actor: ownerSelect },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });
  return { contact, activities };
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
    const created = await tx.contact.create({
      data: {
        agencyId: actor.agencyId,
        ownerId: actor.id,
        fullName: input.fullName,
        emailNorm,
        phone: input.phone ?? null,
        phoneNorm,
        companyName: input.companyName ?? null,
        lifecycle: input.lifecycle ?? 'LEAD',
        source: input.source ?? null,
        nextActionAt: input.nextActionAt ? new Date(input.nextActionAt) : null,
        notes: input.notes ?? null,
      },
      include: { owner: ownerSelect },
    });
    await tx.activity.create({
      data: {
        agencyId: actor.agencyId,
        actorId: actor.id,
        entityType: 'contact',
        entityId: created.id,
        eventType: 'contact.created',
        summary: `${created.lifecycle === 'LEAD' ? 'Lead' : 'Customer'} added by ${actor.name}`,
      },
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
