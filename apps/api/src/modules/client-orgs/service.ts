import {
  can,
  type ClientOrgDetail,
  type PortalInvitationCreated,
  type PortalInvitationSummary,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import type { Invitation } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, staleVersion } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/normalize.js';
import { recordActivity } from '../../lib/timeline.js';
import { generateToken, sha256Hex } from '../../lib/tokens.js';
import type { AuthUser } from '../../types/express.js';
import { contactReadScope } from '../contacts/policy.js';
import { UUID_PATTERN } from '../contacts/service.js';
import { INVITATION_TTL_MS, invitationStatus } from '../invitations/service.js';

function assertCanManage(actor: AuthUser) {
  if (!can(actor.role, 'portal.manage')) {
    throw forbidden('Only an owner, admin or sales manager can manage client portal access.');
  }
}

async function findOrg(db: Db, actor: AuthUser, id: string) {
  assertCanManage(actor);
  if (!UUID_PATTERN.test(id)) throw notFound();
  const org = await db.clientOrganization.findFirst({ where: { id, agencyId: actor.agencyId } });
  if (!org) throw notFound();
  return org;
}

function toInvitation(inv: Invitation): PortalInvitationSummary {
  return {
    id: inv.id,
    email: inv.emailNorm,
    status: invitationStatus(inv),
    expiresAt: inv.expiresAt.toISOString(),
  };
}

export async function getClientOrg(db: Db, actor: AuthUser, id: string): Promise<ClientOrgDetail> {
  const org = await findOrg(db, actor, id);
  const [users, invitations] = await Promise.all([
    db.user.findMany({
      where: { agencyId: actor.agencyId, clientOrgId: org.id, role: 'CLIENT' },
      orderBy: { name: 'asc' },
    }),
    db.invitation.findMany({
      where: { agencyId: actor.agencyId, clientOrgId: org.id, acceptedAt: null },
      orderBy: { createdAt: 'desc' },
      take: 50,
    }),
  ]);
  return {
    id: org.id,
    name: org.name,
    portalUsers: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.emailNorm,
      active: u.active,
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      version: u.version,
    })),
    invitations: invitations.map(toInvitation),
  };
}

/** Creates the customer's organization and links the contact to it. One organization per contact. */
export async function createOrgForContact(
  db: Db,
  actor: AuthUser,
  contactId: string,
  name: string,
  requestId: string,
) {
  assertCanManage(actor);
  if (!UUID_PATTERN.test(contactId)) throw notFound();
  const contact = await db.contact.findFirst({
    where: { AND: [contactReadScope(actor), { id: contactId }] },
  });
  if (!contact) throw notFound();
  if (contact.clientOrgId) throw conflict('This contact already has a client organization.');

  const orgId = await db.$transaction(async (tx) => {
    const org = await tx.clientOrganization.create({ data: { agencyId: actor.agencyId, name } });
    const linked = await tx.contact.updateMany({
      where: { id: contact.id, clientOrgId: null },
      data: { clientOrgId: org.id, version: { increment: 1 } },
    });
    if (linked.count === 0) throw conflict('This contact already has a client organization.');
    await recordActivity(tx, actor, {
      entityType: 'contact',
      entityId: contact.id,
      eventType: 'contact.client_org',
      summary: `Client portal set up for ${name} by ${actor.name}`,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'client_org.create',
      outcome: 'SUCCESS',
      targetType: 'client_organization',
      targetId: org.id,
      requestId,
    });
    return org.id;
  });
  return getClientOrg(db, actor, orgId);
}

/**
 * Invites a person to the organization's portal (spec J5: one-time, expiring, bound to that
 * organization). Uses the same hashed-token invitation table and acceptance page as staff.
 */
export async function invitePortalUser(
  deps: AppDeps,
  actor: AuthUser,
  orgId: string,
  email: string,
  requestId: string,
): Promise<PortalInvitationCreated> {
  const { db, mailer, config } = deps;
  const org = await findOrg(db, actor, orgId);
  if (org.archivedAt) throw conflict('This client organization is archived.');
  const emailNorm = normalizeEmail(email);
  const existing = await db.user.findUnique({
    where: { agencyId_emailNorm: { agencyId: actor.agencyId, emailNorm } },
    select: { id: true },
  });
  if (existing) throw conflict('Someone with this email already has a ClientFlow account here.');

  const token = generateToken(32);
  const now = new Date();
  const invitation = await db.$transaction(async (tx) => {
    await tx.invitation.updateMany({
      where: { agencyId: actor.agencyId, emailNorm, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const created = await tx.invitation.create({
      data: {
        agencyId: actor.agencyId,
        emailNorm,
        role: 'CLIENT',
        clientOrgId: org.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        createdAt: now,
        invitedById: actor.id,
      },
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'portal.invite',
      outcome: 'SUCCESS',
      targetType: 'invitation',
      targetId: created.id,
      requestId,
      metadata: { clientOrgId: org.id },
    });
    return created;
  });

  const agency = await db.agency.findUniqueOrThrow({ where: { id: actor.agencyId } });
  const acceptUrl = `${config.publicUrl}/activate-invite#token=${token}`;
  await mailer.send({
    kind: 'portal_invitation',
    to: emailNorm,
    subject: `${agency.name} invited you to their client portal`,
    text: [
      'Hello,',
      '',
      `${agency.name} invited you to review proposals for ${org.name} in their ClientFlow client portal.`,
      'Accept within 7 days:',
      acceptUrl,
      '',
      'If you were not expecting this, you can ignore this email.',
    ].join('\n'),
  });
  return { invitation: toInvitation(invitation), acceptUrl, emailDelivery: mailer.delivery };
}

export async function revokePortalInvitation(
  db: Db,
  actor: AuthUser,
  orgId: string,
  invitationId: string,
  requestId: string,
) {
  const org = await findOrg(db, actor, orgId);
  if (!UUID_PATTERN.test(invitationId)) throw notFound();
  const res = await db.invitation.updateMany({
    where: { id: invitationId, clientOrgId: org.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  if (res.count === 0) throw conflict('Only pending invitations can be revoked.');
  await writeAudit(db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'portal.invite_revoke',
    outcome: 'SUCCESS',
    targetType: 'invitation',
    targetId: invitationId,
    requestId,
  });
  return getClientOrg(db, actor, org.id);
}

/** Removes a person's portal access at once: deactivates the account and ends its sessions. */
export async function setPortalUserActive(
  db: Db,
  actor: AuthUser,
  orgId: string,
  userId: string,
  active: boolean,
  version: number,
  requestId: string,
) {
  const org = await findOrg(db, actor, orgId);
  if (!UUID_PATTERN.test(userId)) throw notFound();
  await db.$transaction(async (tx) => {
    const user = await tx.user.findFirst({
      where: { id: userId, agencyId: actor.agencyId, clientOrgId: org.id, role: 'CLIENT' },
    });
    if (!user) throw notFound();
    if (user.version !== version) throw staleVersion();
    const res = await tx.user.updateMany({
      where: { id: user.id, version },
      data: { active, version: { increment: 1 } },
    });
    if (res.count === 0) throw staleVersion();
    if (!active) {
      await tx.session.updateMany({
        where: { userId: user.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: active ? 'portal.user_reactivate' : 'portal.user_deactivate',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: user.id,
      requestId,
    });
  });
  return getClientOrg(db, actor, org.id);
}
