import {
  can,
  parseMoneyToMinor,
  type serviceCreateSchema,
  type serviceUpdateSchema,
  type Currency,
  type ServiceSummary,
} from '@clientflow/contracts';
import type { z } from 'zod';
import type { Db } from '../../db/client.js';
import type { ServiceItem } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { forbidden, notFound, staleVersion, validationFailed } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';

export function toServiceSummary(s: ServiceItem): ServiceSummary {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    unit: s.unit,
    rateMinor: s.rateMinor.toString(),
    currency: s.currency as Currency,
    archivedAt: s.archivedAt?.toISOString() ?? null,
    version: s.version,
  };
}

function assertCanRead(actor: AuthUser) {
  if (!can(actor.role, 'services.read'))
    throw forbidden('Your role cannot see the service catalog.');
}

function assertCanManage(actor: AuthUser) {
  if (!can(actor.role, 'services.manage')) {
    throw forbidden('Only an owner or admin can change the service catalog.');
  }
}

function toRate(rate: string, currency: Currency) {
  const minor = parseMoneyToMinor(rate, currency);
  if (minor === null)
    throw validationFailed({ rate: ['Use a positive number with at most 2 decimals.'] });
  return BigInt(minor);
}

export async function listServices(db: Db, actor: AuthUser, includeArchived: boolean) {
  assertCanRead(actor);
  const rows = await db.serviceItem.findMany({
    where: { agencyId: actor.agencyId, ...(includeArchived ? {} : { archivedAt: null }) },
    orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { name: 'asc' }],
    take: 500,
  });
  return rows.map(toServiceSummary);
}

export async function createService(
  db: Db,
  actor: AuthUser,
  input: z.output<typeof serviceCreateSchema>,
  requestId: string,
) {
  assertCanManage(actor);
  const created = await db.serviceItem.create({
    data: {
      agencyId: actor.agencyId,
      name: input.name,
      description: input.description,
      unit: input.unit,
      rateMinor: toRate(input.rate, input.currency),
      currency: input.currency,
    },
  });
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'service.create',
    outcome: 'SUCCESS',
    targetType: 'service',
    targetId: created.id,
    requestId,
  });
  return toServiceSummary(created);
}

async function findService(db: Db, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const s = await db.serviceItem.findFirst({ where: { id, agencyId: actor.agencyId } });
  if (!s) throw notFound();
  return s;
}

/** Edits never touch proposals: their lines are copies (spec §8.3 snapshot rule). */
export async function updateService(
  db: Db,
  actor: AuthUser,
  id: string,
  input: z.output<typeof serviceUpdateSchema>,
  requestId: string,
) {
  assertCanManage(actor);
  const s = await findService(db, actor, id);
  const currency = (input.currency ?? s.currency) as Currency;
  const res = await db.serviceItem.updateMany({
    where: { id: s.id, version: input.version },
    data: {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.unit !== undefined ? { unit: input.unit } : {}),
      ...(input.rate !== undefined ? { rateMinor: toRate(input.rate, currency) } : {}),
      ...(input.currency !== undefined ? { currency } : {}),
      version: { increment: 1 },
    },
  });
  if (res.count === 0) throw staleVersion();
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'service.update',
    outcome: 'SUCCESS',
    targetType: 'service',
    targetId: s.id,
    requestId,
  });
  return toServiceSummary(await findService(db, actor, id));
}

export async function setServiceArchived(
  db: Db,
  actor: AuthUser,
  id: string,
  archived: boolean,
  version: number,
  requestId: string,
) {
  assertCanManage(actor);
  const s = await findService(db, actor, id);
  const res = await db.serviceItem.updateMany({
    where: { id: s.id, version },
    data: { archivedAt: archived ? new Date() : null, version: { increment: 1 } },
  });
  if (res.count === 0) throw staleVersion();
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: archived ? 'service.archive' : 'service.restore',
    outcome: 'SUCCESS',
    targetType: 'service',
    targetId: s.id,
    requestId,
  });
  return toServiceSummary(await findService(db, actor, id));
}
