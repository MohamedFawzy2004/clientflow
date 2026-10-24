// Declarative permission matrix (spec §1.1). Roles grant capabilities; record scope (ownership,
// agency, project membership) is checked separately on the server for every row.
// The web app uses this only to hide actions. The API is the authority on every request.
import type { Role } from './base.js';

export const PERMISSIONS = {
  /** Read every contact in the agency. */
  'contacts.read.all': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** Read contacts the user owns. */
  'contacts.read.own': ['SALES'],
  'contacts.create': ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'],
  /** Edit, log activity, archive and convert contacts the user can read (scope still applies). */
  'contacts.write': ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'],
  /** Give a contact or deal to another salesperson (FR-D08). */
  'sales.reassign': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  'deals.read.all': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  'deals.read.own': ['SALES'],
  /** Create, edit, move between stages and mark LOST (scope still applies). */
  'deals.write': ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'],
  /** Mark WON without an accepted proposal, with a written reason (FR-D05). */
  'deals.override_won': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** Reopen a WON or LOST deal, with a written reason (spec §9). */
  'deals.reopen': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** See team members and invitations. */
  'team.read': ['OWNER', 'ADMIN'],
  'team.invite': ['OWNER', 'ADMIN'],
  /** Change roles, deactivate/reactivate, revoke sessions. */
  'team.manage': ['OWNER', 'ADMIN'],
  /** Grant the OWNER role or modify an owner's account. */
  'team.manage_owners': ['OWNER'],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role, permission: Permission): boolean {
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

export function canAny(role: Role, permissions: readonly Permission[]): boolean {
  return permissions.some((p) => can(role, p));
}

/** Roles that can be given to staff. CLIENT users belong to the client portal (M7). */
export const STAFF_ROLES = [
  'OWNER',
  'ADMIN',
  'SALES_MANAGER',
  'SALES',
  'PM',
  'MEMBER',
  'FINANCE',
] as const satisfies readonly Role[];
export type StaffRole = (typeof STAFF_ROLES)[number];

/** Roles the actor may grant. Only owners can create or promote owners. */
export function grantableRoles(actorRole: Role): StaffRole[] {
  if (!can(actorRole, 'team.manage')) return [];
  return STAFF_ROLES.filter((r) => r !== 'OWNER' || can(actorRole, 'team.manage_owners'));
}

export const ROLE_LABELS: Record<Role, string> = {
  OWNER: 'Owner',
  ADMIN: 'Admin',
  SALES_MANAGER: 'Sales manager',
  SALES: 'Sales',
  PM: 'Project manager',
  MEMBER: 'Team member',
  FINANCE: 'Finance',
  CLIENT: 'Client',
};
