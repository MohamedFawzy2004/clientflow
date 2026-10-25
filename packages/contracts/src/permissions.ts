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
  /** Read the service catalog (to build proposals). */
  'services.read': ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'],
  /** Add, edit and archive catalog services (spec §1: Admin configures the catalog). */
  'services.manage': ['OWNER', 'ADMIN'],
  'proposals.read.all': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** Proposals on deals the user owns. */
  'proposals.read.own': ['SALES'],
  /** Create and edit drafts, submit for review, send approved versions (scope still applies). */
  'proposals.write': ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'],
  /** Approve a version for release, or send it back (FR-Q05, US-08). */
  'proposals.approve': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** Create client organizations, invite and deactivate portal users. */
  'portal.manage': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** Client portal: see what was published to the user's own organization and decide on it. */
  'portal.access': ['CLIENT'],
  /** Sales dashboard and reminders, scoped like the records they count (T-ACL-05). */
  'dashboard.sales': ['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES'],
  /** See every owner's numbers and the per-owner breakdown. */
  'dashboard.team': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** Download CSV reports (US-22). */
  'reports.export': ['OWNER', 'ADMIN', 'SALES_MANAGER'],
  /** Edit the agency profile, currency, timezone and working days (FR-I09). */
  'agency.manage': ['OWNER', 'ADMIN'],
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

/** Roles that can be given to staff. CLIENT users are invited to a client organization instead. */
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
