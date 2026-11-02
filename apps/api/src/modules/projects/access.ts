// Project access rules shared by projects, tasks, time, files and deliverables (spec §1.1).
import { can } from '@clientflow/contracts';
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { conflict, forbidden, notFound } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { dealReadScope } from '../deals/policy.js';

export type Tx = Prisma.TransactionClient;

/** A for Owner/Admin, P (manager or member) for PM/members, "Read linked" for sales. */
export function projectReadScope(actor: AuthUser): Prisma.ProjectWhereInput {
  const base = { agencyId: actor.agencyId };
  if (can(actor.role, 'projects.read.all')) return base;
  if (can(actor.role, 'projects.read.member')) {
    return { ...base, OR: [{ managerId: actor.id }, { members: { some: { userId: actor.id } } }] };
  }
  if (can(actor.role, 'projects.read.linked')) return { ...base, deal: dealReadScope(actor) };
  throw forbidden('Your role does not have access to projects.');
}

/** Owners/Admins manage every project; a PM manages the projects they lead. Sales read only. */
export function canManage(actor: AuthUser, project: { managerId: string }) {
  if (!can(actor.role, 'projects.manage')) return false;
  return can(actor.role, 'projects.read.all') || project.managerId === actor.id;
}

/**
 * Delivery work (tasks, own time, files, deliverables): Owner/Admin on every project, PMs and
 * members on the projects they take part in. Linked sales readers never get it.
 */
export function canWork(actor: AuthUser) {
  return can(actor.role, 'delivery.work');
}

export async function findReadable(db: Db | Tx, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const p = await db.project.findFirst({ where: { AND: [projectReadScope(actor), { id }] } });
  if (!p) throw notFound();
  return p;
}

/** Archived projects are history: read-only (FR-P11). */
export function assertNotArchived(p: { state: string }) {
  if (p.state === 'ARCHIVED') throw conflict('Archived projects are read-only.');
}

/** Loads a project the actor may change. */
export async function findManageable(db: Db | Tx, actor: AuthUser, id: string) {
  const p = await findReadable(db, actor, id);
  if (!canManage(actor, p))
    throw forbidden('Only the project manager or an admin can change this project.');
  assertNotArchived(p);
  return p;
}

/** Loads a project whose delivery data the actor may see (role first: 403; then scope: 404). */
export async function findWorkable(db: Db | Tx, actor: AuthUser, id: string) {
  if (!canWork(actor)) throw forbidden('Delivery work is for the project team.');
  return findReadable(db, actor, id);
}

/** Serializes writes that must see a consistent project (sequences, dependency graph). */
export async function lockProject(tx: Tx, id: string) {
  await tx.$queryRaw`SELECT id FROM projects WHERE id = CAST(${id} AS uuid) FOR UPDATE`;
}

/**
 * For work put in front of the client (a deliverable to review, a change to decide). Holds the
 * project's state until commit: completing the project takes `lockProject`, so it waits for this
 * transaction and then sees the new work, and this one sees a project completed just before.
 * Taken after the row being changed (deliverable, change), then the project, as everywhere else.
 */
export async function lockOpenForClient(tx: Tx, id: string) {
  const [row] = await tx.$queryRaw<Array<{ state: string }>>`
    SELECT state::text AS state FROM projects WHERE id = CAST(${id} AS uuid) FOR SHARE`;
  if (!row) throw notFound();
  assertNotArchived(row);
  if (row.state === 'COMPLETED') {
    throw conflict('This project is completed. Make it active again to send the client new work.');
  }
}
