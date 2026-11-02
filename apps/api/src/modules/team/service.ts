import { can, grantableRoles, type StaffRole, type TeamMember } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import type { Prisma, Role, User } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion } from '../../lib/errors.js';
import type { AuthUser } from '../../types/express.js';

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Tx = Prisma.TransactionClient;

export async function listMembers({ db }: AppDeps, actor: AuthUser): Promise<TeamMember[]> {
  const now = new Date();
  const users = await db.user.findMany({
    where: { agencyId: actor.agencyId },
    orderBy: [{ active: 'desc' }, { name: 'asc' }],
    include: {
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } },
    },
  });
  return users.map((u) => toMember(u, u._count.sessions, actor));
}

function toMember(u: User, activeSessions: number, actor: AuthUser): TeamMember {
  return {
    id: u.id,
    name: u.name,
    email: u.emailNorm,
    role: u.role,
    status: u.active ? 'ACTIVE' : 'DEACTIVATED',
    lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
    activeSessions,
    createdAt: u.createdAt.toISOString(),
    version: u.version,
    isSelf: u.id === actor.id,
  };
}

/**
 * Loads the target inside the transaction and applies the rules every team action shares:
 * same agency (else 404), never yourself, and only owners may touch an owner's account.
 * The actor is re-read too, so a request authorized a moment ago cannot act after a demotion.
 */
async function loadForChange(tx: Tx, actor: AuthUser, targetId: string, action: string) {
  if (!UUID_PATTERN.test(targetId)) throw notFound();
  const [current, target] = await Promise.all([
    tx.user.findUnique({ where: { id: actor.id }, select: { role: true, active: true } }),
    tx.user.findFirst({ where: { id: targetId, agencyId: actor.agencyId } }),
  ]);
  if (!current?.active || !can(current.role, 'team.manage')) throw forbidden();
  if (!target) throw notFound();
  if (target.id === actor.id) throw forbidden(`You cannot ${action} your own account.`);
  if (target.role === 'OWNER' && !can(current.role, 'team.manage_owners')) {
    throw forbidden('Only an owner can change another owner’s account.');
  }
  return { target, actorRole: current.role as Role };
}

/**
 * Guarantees at least one active owner remains (FR-I08). The owner rows are locked FOR UPDATE,
 * so two owners demoting each other at the same time are serialized and the second one fails.
 */
async function assertAnotherActiveOwner(tx: Tx, agencyId: string, leavingUserId: string) {
  const owners = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM users WHERE agency_id = ${agencyId}::uuid AND role = 'OWNER' AND active
    FOR UPDATE`;
  if (!owners.some((o) => o.id !== leavingUserId)) {
    throw conflict('The agency must keep at least one active owner. Promote someone else first.');
  }
}

async function revokeAllSessions(tx: Tx, userId: string) {
  const res = await tx.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return res.count;
}

/** Optimistic lock: the update only applies to the version the client last saw (409 otherwise). */
async function updateVersioned(
  tx: Tx,
  target: User,
  expected: number,
  data: Prisma.UserUpdateManyMutationInput,
) {
  if (target.version !== expected) throw staleVersion();
  const res = await tx.user.updateMany({
    where: { id: target.id, version: expected },
    data: { ...data, version: { increment: 1 } },
  });
  if (res.count === 0) throw staleVersion();
}

async function reload({ db }: AppDeps, actor: AuthUser, id: string) {
  const now = new Date();
  const u = await db.user.findUniqueOrThrow({
    where: { id },
    include: {
      _count: { select: { sessions: { where: { revokedAt: null, expiresAt: { gt: now } } } } },
    },
  });
  return toMember(u, u._count.sessions, actor);
}

/** Role change. Every session of the target is revoked: privileges change only on next sign-in (FR-I03). */
export async function changeRole(
  deps: AppDeps,
  actor: AuthUser,
  targetId: string,
  input: { role: StaffRole; version: number },
  requestId: string,
) {
  await deps.db.$transaction(async (tx) => {
    const { target, actorRole } = await loadForChange(tx, actor, targetId, 'change the role of');
    if (!grantableRoles(actorRole).includes(input.role)) {
      throw forbidden(
        input.role === 'OWNER'
          ? 'Only an owner can grant the owner role.'
          : 'You cannot grant that role.',
      );
    }
    if (target.role === input.role) {
      if (target.version !== input.version) throw staleVersion();
      return;
    }
    if (target.role === 'OWNER' && target.active)
      await assertAnotherActiveOwner(tx, actor.agencyId, target.id);
    await updateVersioned(tx, target, input.version, { role: input.role });
    const revoked = await revokeAllSessions(tx, target.id);
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'team.role_change',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: target.id,
      requestId,
      metadata: { from: target.role, to: input.role, sessionsRevoked: revoked },
    });
  });
  return reload(deps, actor, targetId);
}

/** Deactivation takes effect immediately: sessions and unused reset links are revoked (US-19). */
export async function deactivateMember(
  deps: AppDeps,
  actor: AuthUser,
  targetId: string,
  version: number,
  requestId: string,
) {
  await deps.db.$transaction(async (tx) => {
    const { target } = await loadForChange(tx, actor, targetId, 'deactivate');
    if (!target.active) {
      if (target.version !== version) throw staleVersion();
      return;
    }
    if (target.role === 'OWNER') await assertAnotherActiveOwner(tx, actor.agencyId, target.id);
    await updateVersioned(tx, target, version, { active: false });
    const revoked = await revokeAllSessions(tx, target.id);
    await tx.passwordResetToken.updateMany({
      where: { userId: target.id, usedAt: null },
      data: { usedAt: new Date() },
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'team.deactivate',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: target.id,
      requestId,
      metadata: { sessionsRevoked: revoked },
    });
  });
  return reload(deps, actor, targetId);
}

export async function reactivateMember(
  deps: AppDeps,
  actor: AuthUser,
  targetId: string,
  version: number,
  requestId: string,
) {
  await deps.db.$transaction(async (tx) => {
    const { target } = await loadForChange(tx, actor, targetId, 'reactivate');
    if (target.active) {
      if (target.version !== version) throw staleVersion();
      return;
    }
    await updateVersioned(tx, target, version, { active: true });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'team.reactivate',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: target.id,
      requestId,
    });
  });
  return reload(deps, actor, targetId);
}

/** Signs the member out everywhere without changing their account. */
export async function revokeMemberSessions(
  deps: AppDeps,
  actor: AuthUser,
  targetId: string,
  requestId: string,
) {
  await deps.db.$transaction(async (tx) => {
    const { target } = await loadForChange(tx, actor, targetId, 'sign out');
    const revoked = await revokeAllSessions(tx, target.id);
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'team.revoke_sessions',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: target.id,
      requestId,
      metadata: { sessionsRevoked: revoked },
    });
  });
  return reload(deps, actor, targetId);
}
