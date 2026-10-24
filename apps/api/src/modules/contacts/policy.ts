import type { Role } from '@clientflow/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { forbidden } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';

// Contact access in M1 (ADR-009, spec §1.1). Every query goes through these helpers, so
// list, detail, search, counts and duplicate hints share the same scope (SEC-25).
const SEES_ALL_AGENCY_CONTACTS: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN', 'SALES_MANAGER']);
const SEES_OWNED_CONTACTS: ReadonlySet<Role> = new Set(['SALES']);
const CAN_CREATE_CONTACTS: ReadonlySet<Role> = new Set(['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES']);

export function canReadContacts(role: Role): boolean {
  return SEES_ALL_AGENCY_CONTACTS.has(role) || SEES_OWNED_CONTACTS.has(role);
}

/** Prisma filter for contacts this user may read. Throws 403 for roles with no contact access. */
export function contactReadScope(user: AuthUser): Prisma.ContactWhereInput {
  const base: Prisma.ContactWhereInput = { agencyId: user.agencyId, archivedAt: null };
  if (SEES_ALL_AGENCY_CONTACTS.has(user.role)) return base;
  if (SEES_OWNED_CONTACTS.has(user.role)) return { ...base, ownerId: user.id };
  throw forbidden('Your role does not have access to leads.');
}

export function assertCanCreateContact(user: AuthUser): void {
  if (!CAN_CREATE_CONTACTS.has(user.role)) {
    throw forbidden('Your role cannot add leads.');
  }
}
