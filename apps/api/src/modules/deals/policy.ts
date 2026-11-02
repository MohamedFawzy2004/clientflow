import { can } from '@clientflow/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { forbidden } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';

/** Deals this user may read: the whole agency for managers, own deals for SALES (spec §1.1). */
export function dealReadScope(user: AuthUser): Prisma.DealWhereInput {
  const base: Prisma.DealWhereInput = { agencyId: user.agencyId, archivedAt: null };
  if (can(user.role, 'deals.read.all')) return base;
  if (can(user.role, 'deals.read.own')) return { ...base, ownerId: user.id };
  throw forbidden('Your role does not have access to deals.');
}

export function assertCanWriteDeals(user: AuthUser) {
  if (!can(user.role, 'deals.write')) throw forbidden('Your role cannot change deals.');
}
