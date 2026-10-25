import { canAny, type AssignableUser } from '@clientflow/contracts';
import type { Db } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { validationFailed } from './errors.js';

type Reader = Db | Prisma.TransactionClient;

/** Roles that can own contacts and deals: the same roles that can read them. */
function canOwnSalesRecords(role: Parameters<typeof canAny>[0]) {
  return canAny(role, ['contacts.read.all', 'contacts.read.own']);
}

/** People a record can be given to: active, same agency, and able to see sales records. */
export async function listAssignableUsers(db: Reader, agencyId: string): Promise<AssignableUser[]> {
  const users = await db.user.findMany({
    where: { agencyId, active: true },
    select: { id: true, name: true, role: true },
    orderBy: { name: 'asc' },
  });
  return users.filter((u) => canOwnSalesRecords(u.role));
}

/** Validates a new owner. Unknown, other-agency, inactive or non-sales users are all a 422. */
export async function assertAssignableOwner(db: Reader, agencyId: string, ownerId: string) {
  const user = await db.user.findFirst({
    where: { id: ownerId, agencyId, active: true },
    select: { id: true, name: true, role: true },
  });
  if (!user || !canOwnSalesRecords(user.role)) {
    throw validationFailed({ ownerId: ['Choose an active salesperson or manager.'] });
  }
  return user;
}
