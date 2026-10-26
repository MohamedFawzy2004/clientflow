// Portal scope for projects (spec §1.1 `C`): the client's own organization AND an active,
// explicit share with this user. Archived projects leave the portal.
import type { Db } from '../../db/client.js';
import type { Prisma } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { forbidden } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';
import { UUID_PATTERN } from '../contacts/service.js';

export function portalProjectScope(actor: AuthUser): Prisma.ProjectWhereInput {
  if (actor.role !== 'CLIENT' || !actor.clientOrgId) throw forbidden();
  return {
    agencyId: actor.agencyId,
    clientOrgId: actor.clientOrgId,
    state: { not: 'ARCHIVED' },
    shares: { some: { userId: actor.id, revokedAt: null } },
  };
}

/**
 * T-ACL-02: a client asking for a project, deliverable or file outside their scope gets the same
 * 404 as for an unknown ID, and the attempt is recorded as a DENIED audit event.
 */
export async function logPortalDenied(
  db: Db,
  actor: AuthUser,
  targetType: 'project' | 'deliverable' | 'file',
  targetId: string,
  requestId: string,
) {
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'portal.access_denied',
    outcome: 'DENIED',
    targetType,
    ...(UUID_PATTERN.test(targetId) ? { targetId } : {}),
    requestId,
  });
}
