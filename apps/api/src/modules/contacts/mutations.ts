import {
  can,
  type ActivityCreateInput,
  type ActivityKind,
  ACTIVITY_KIND_LABELS,
} from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Contact, Prisma } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import { normalizeEmail, normalizePhone } from '../../lib/normalize.js';
import { assertAssignableOwner } from '../../lib/sales-owner.js';
import { recordActivity } from '../../lib/timeline.js';
import type { AuthUser } from '../../types/express.js';
import { assertCanWriteContact, contactReadScope } from './policy.js';
import { UUID_PATTERN } from './service.js';

type Tx = Prisma.TransactionClient;

/** Loads a contact the actor may write, inside the transaction. Out of scope → 404. */
async function loadWritable(
  tx: Tx,
  actor: AuthUser,
  id: string,
  options: { allowArchived?: boolean } = {},
) {
  assertCanWriteContact(actor);
  if (!UUID_PATTERN.test(id)) throw notFound();
  const contact = await tx.contact.findFirst({
    where: { AND: [contactReadScope(actor, { includeArchived: true }), { id }] },
  });
  if (!contact) throw notFound();
  if (contact.archivedAt && !options.allowArchived) {
    throw conflict('Archived contacts are read-only. Restore it first.');
  }
  return contact;
}

/**
 * Optimistic lock: applies `data` only if the row still has the version the client saw.
 * A concurrent edit makes the second writer get 409 instead of silently overwriting (T-DEAL-01 pattern).
 */
async function updateVersioned(
  tx: Tx,
  contact: Contact,
  expected: number,
  data: Prisma.ContactUncheckedUpdateManyInput,
) {
  if (contact.version !== expected) throw staleVersion();
  const res = await tx.contact.updateMany({
    where: { id: contact.id, version: expected },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) throw staleVersion();
}

const FIELD_LABELS: Record<string, string> = {
  fullName: 'name',
  email: 'email',
  phone: 'phone',
  companyName: 'company',
  source: 'source',
  nextActionAt: 'next follow-up',
  notes: 'notes',
};

export interface ContactUpdate {
  version: number;
  fullName?: string | undefined;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  companyName?: string | null | undefined;
  source?: Contact['source'] | undefined;
  nextActionAt?: string | null | undefined;
  notes?: string | null | undefined;
}

/** Edit with optimistic locking (US-05 PATCH, FR-C01). The timeline names fields, never values. */
export async function updateContact(
  db: Db,
  actor: AuthUser,
  id: string,
  input: ContactUpdate,
  requestId: string,
) {
  await db.$transaction(async (tx) => {
    const contact = await loadWritable(tx, actor, id);
    const data: Prisma.ContactUncheckedUpdateManyInput = {};
    if (input.fullName !== undefined) data.fullName = input.fullName;
    if (input.email !== undefined)
      data.emailNorm = input.email === null ? null : normalizeEmail(input.email);
    if (input.phone !== undefined) {
      data.phone = input.phone;
      data.phoneNorm = input.phone === null ? null : normalizePhone(input.phone);
    }
    if (input.companyName !== undefined) data.companyName = input.companyName;
    if (input.source !== undefined) data.source = input.source;
    if (input.nextActionAt !== undefined)
      data.nextActionAt = input.nextActionAt === null ? null : new Date(input.nextActionAt);
    if (input.notes !== undefined) data.notes = input.notes;

    const changed = Object.keys(FIELD_LABELS).filter(
      (k) => (input as unknown as Record<string, unknown>)[k] !== undefined,
    );
    if (changed.length === 0) {
      if (contact.version !== input.version) throw staleVersion();
      return;
    }
    await updateVersioned(tx, contact, input.version, data);
    await recordActivity(tx, actor, {
      entityType: 'contact',
      entityId: contact.id,
      eventType: 'contact.updated',
      summary: `${actor.name} updated ${changed.map((k) => FIELD_LABELS[k]).join(', ')}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'contact.update',
      outcome: 'SUCCESS',
      targetType: 'contact',
      targetId: contact.id,
      requestId,
      metadata: { fields: changed.join(',') },
    });
  });
}

/** LEAD → CUSTOMER in place: same ID, same deals and timeline (FR-C07). Repeating is a no-op (US-06). */
export async function convertContact(
  db: Db,
  actor: AuthUser,
  id: string,
  version: number,
  requestId: string,
) {
  return db.$transaction(async (tx) => {
    const contact = await loadWritable(tx, actor, id);
    if (contact.lifecycle === 'CUSTOMER') return { changed: false };
    await updateVersioned(tx, contact, version, { lifecycle: 'CUSTOMER', convertedAt: new Date() });
    await recordActivity(tx, actor, {
      entityType: 'contact',
      entityId: contact.id,
      eventType: 'contact.converted',
      summary: `Converted to customer by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'contact.convert',
      outcome: 'SUCCESS',
      targetType: 'contact',
      targetId: contact.id,
      requestId,
    });
    return { changed: true };
  });
}

/** Archive or restore (reversible, never a hard delete: spec §7.4.13). Idempotent. */
export async function setArchived(
  db: Db,
  actor: AuthUser,
  id: string,
  archived: boolean,
  version: number,
  requestId: string,
) {
  return db.$transaction(async (tx) => {
    const contact = await loadWritable(tx, actor, id, { allowArchived: true });
    if (Boolean(contact.archivedAt) === archived) return { changed: false };
    await updateVersioned(tx, contact, version, { archivedAt: archived ? new Date() : null });
    await recordActivity(tx, actor, {
      entityType: 'contact',
      entityId: contact.id,
      eventType: archived ? 'contact.archived' : 'contact.restored',
      summary: `${archived ? 'Archived' : 'Restored'} by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: archived ? 'contact.archive' : 'contact.restore',
      outcome: 'SUCCESS',
      targetType: 'contact',
      targetId: contact.id,
      requestId,
    });
    return { changed: true };
  });
}

/** Managers give a contact to another salesperson (FR-D08). History lands on the timeline. */
export async function reassignContact(
  db: Db,
  actor: AuthUser,
  id: string,
  ownerId: string,
  version: number,
  requestId: string,
) {
  if (!can(actor.role, 'sales.reassign')) throw forbidden('Only managers can reassign leads.');
  return db.$transaction(async (tx) => {
    const contact = await loadWritable(tx, actor, id);
    const newOwner = await assertAssignableOwner(tx, actor.agencyId, ownerId);
    if (contact.ownerId === newOwner.id) {
      if (contact.version !== version) throw staleVersion();
      return { changed: false };
    }
    const oldOwner = await tx.user.findUniqueOrThrow({
      where: { id: contact.ownerId },
      select: { name: true },
    });
    await updateVersioned(tx, contact, version, { ownerId: newOwner.id });
    await recordActivity(tx, actor, {
      entityType: 'contact',
      entityId: contact.id,
      eventType: 'contact.reassigned',
      summary: `Owner changed from ${oldOwner.name} to ${newOwner.name} by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'contact.reassign',
      outcome: 'SUCCESS',
      targetType: 'contact',
      targetId: contact.id,
      requestId,
      metadata: { fromUserId: contact.ownerId, toUserId: newOwner.id },
    });
    return { changed: true };
  });
}

const FUTURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Notes and logged calls/emails/meetings (FR-C08). Body is stored as plain text. */
export async function addTimelineEntry(
  db: Db,
  actor: AuthUser,
  id: string,
  input: ActivityCreateInput,
) {
  const occurredAt = input.occurredAt ? new Date(input.occurredAt) : new Date();
  if (occurredAt.getTime() > Date.now() + FUTURE_TOLERANCE_MS) {
    throw validationFailed({
      occurredAt: ['Log things that already happened. Use the follow-up date for plans.'],
    });
  }
  return db.$transaction(async (tx) => {
    const contact = await loadWritable(tx, actor, id);
    const kind: ActivityKind = input.kind;
    const verb = kind === 'NOTE' ? 'added' : 'logged';
    return recordActivity(tx, actor, {
      entityType: 'contact',
      entityId: contact.id,
      eventType: `activity.${kind.toLowerCase()}`,
      summary: `${ACTIVITY_KIND_LABELS[kind]} ${verb} by ${actor.name}`,
      body: input.body,
      occurredAt,
    });
  });
}
