import { can } from '@clientflow/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { forbidden } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';

// Contact scope from the permission matrix (ADR-009, spec §1.1). Every query goes through these
// helpers, so list, detail, search, counts, duplicate hints and follow-ups share one scope (SEC-25).

/**
 * Prisma filter for contacts this user may read. Throws 403 for roles with no contact access.
 * Archived contacts are excluded unless `includeArchived` (detail pages and the archived view).
 */
export function contactReadScope(
  user: AuthUser,
  options: { includeArchived?: boolean } = {},
): Prisma.ContactWhereInput {
  const base: Prisma.ContactWhereInput = {
    agencyId: user.agencyId,
    ...(options.includeArchived ? {} : { archivedAt: null }),
  };
  if (can(user.role, 'contacts.read.all')) return base;
  if (can(user.role, 'contacts.read.own')) return { ...base, ownerId: user.id };
  throw forbidden('Your role does not have access to leads.');
}

export function assertCanCreateContact(user: AuthUser): void {
  if (!can(user.role, 'contacts.create')) throw forbidden('Your role cannot add leads.');
}

/** Writes need `contacts.write` AND the record must be in the read scope (checked by the caller). */
export function assertCanWriteContact(user: AuthUser): void {
  if (!can(user.role, 'contacts.write')) throw forbidden('Your role cannot change leads.');
}
