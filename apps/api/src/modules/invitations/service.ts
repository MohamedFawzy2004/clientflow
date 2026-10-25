import {
  grantableRoles,
  ROLE_LABELS,
  type InvitationCreate,
  type InvitationStatus,
  type InvitationSummary,
  type StaffRole,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import type { Invitation, Role, User } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { conflict, forbidden, notFound, tokenInvalid, validationFailed } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/normalize.js';
import {
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_PROBLEM_MESSAGES,
} from '../../lib/password.js';
import { generateToken, sha256Hex } from '../../lib/tokens.js';
import type { AuthUser } from '../../types/express.js';

export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type InvitationRow = Invitation & { invitedBy: Pick<User, 'id' | 'name'> };

export function invitationStatus(inv: Invitation, now = new Date()): InvitationStatus {
  if (inv.acceptedAt) return 'ACCEPTED';
  if (inv.revokedAt) return 'REVOKED';
  if (inv.expiresAt <= now) return 'EXPIRED';
  return 'PENDING';
}

export function toInvitationSummary(inv: InvitationRow, now = new Date()): InvitationSummary {
  return {
    id: inv.id,
    email: inv.emailNorm,
    role: inv.role,
    status: invitationStatus(inv, now),
    expiresAt: inv.expiresAt.toISOString(),
    createdAt: inv.createdAt.toISOString(),
    invitedBy: { id: inv.invitedBy.id, name: inv.invitedBy.name },
  };
}

const invitedBySelect = { invitedBy: { select: { id: true, name: true } } } as const;

export async function listInvitations({ db }: AppDeps, actor: AuthUser) {
  const rows = await db.invitation.findMany({
    where: { agencyId: actor.agencyId, role: { not: 'CLIENT' } },
    include: invitedBySelect,
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  return rows.map((r) => toInvitationSummary(r));
}

function assertCanGrant(actor: AuthUser, role: StaffRole) {
  if (!grantableRoles(actor.role).includes(role)) {
    throw forbidden(
      role === 'OWNER' ? 'Only an owner can invite another owner.' : 'You cannot grant that role.',
    );
  }
}

/**
 * Creates (or replaces) the open invitation for an email (FR-I04). Any earlier open invitation
 * for the same email is revoked in the same transaction, so only the newest link works.
 * Returns the raw token once: it is never stored and cannot be retrieved later.
 */
export async function createInvitation(
  deps: AppDeps,
  actor: AuthUser,
  input: InvitationCreate,
  requestId: string,
) {
  const { db, mailer, config } = deps;
  assertCanGrant(actor, input.role);
  const emailNorm = normalizeEmail(input.email);

  const existingMember = await db.user.findUnique({
    where: { agencyId_emailNorm: { agencyId: actor.agencyId, emailNorm } },
    select: { id: true },
  });
  if (existingMember) throw conflict('Someone with this email is already on the team.');

  const token = generateToken(32);
  const now = new Date();
  const invitation = await db.$transaction(async (tx) => {
    const replaced = await tx.invitation.updateMany({
      where: { agencyId: actor.agencyId, emailNorm, acceptedAt: null, revokedAt: null },
      data: { revokedAt: now },
    });
    const created = await tx.invitation.create({
      data: {
        agencyId: actor.agencyId,
        emailNorm,
        role: input.role,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
        createdAt: now,
        invitedById: actor.id,
      },
      include: invitedBySelect,
    });
    await writeAudit(tx, {
      agencyId: actor.agencyId,
      actorId: actor.id,
      action: 'invitation.create',
      outcome: 'SUCCESS',
      targetType: 'invitation',
      targetId: created.id,
      requestId,
      metadata: { role: input.role, replacedOpenInvites: replaced.count },
    });
    return created;
  });

  const agency = await db.agency.findUniqueOrThrow({ where: { id: actor.agencyId } });
  // Fragment, not query string: the token never reaches server logs or the Referer header.
  const acceptUrl = `${config.publicUrl}/activate-invite#token=${token}`;
  await mailer.send({
    kind: 'invitation',
    to: emailNorm,
    subject: `${actor.name} invited you to ${agency.name} on ClientFlow`,
    text: [
      'Hello,',
      '',
      `${actor.name} invited you to join ${agency.name} on ClientFlow as ${ROLE_LABELS[input.role]}.`,
      'Accept within 7 days:',
      acceptUrl,
      '',
      'If you were not expecting this, you can ignore this email.',
    ].join('\n'),
  });

  return {
    invitation: toInvitationSummary(invitation, now),
    acceptUrl,
    emailDelivery: mailer.delivery,
  };
}

async function findAgencyInvitation(deps: AppDeps, actor: AuthUser, id: string) {
  if (!UUID_PATTERN.test(id)) throw notFound();
  const inv = await deps.db.invitation.findFirst({
    where: { id, agencyId: actor.agencyId, role: { not: 'CLIENT' } },
    include: invitedBySelect,
  });
  if (!inv) throw notFound();
  return inv;
}

export async function revokeInvitation(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  requestId: string,
) {
  const inv = await findAgencyInvitation(deps, actor, id);
  // Admins cannot cancel an owner invitation they could not have created.
  assertCanGrant(actor, inv.role as StaffRole);
  const now = new Date();
  const result = await deps.db.invitation.updateMany({
    where: { id: inv.id, acceptedAt: null, revokedAt: null },
    data: { revokedAt: now },
  });
  if (result.count === 0) throw conflict('Only pending invitations can be revoked.');
  await writeAudit(deps.db, {
    agencyId: actor.agencyId,
    actorId: actor.id,
    action: 'invitation.revoke',
    outcome: 'SUCCESS',
    targetType: 'invitation',
    targetId: inv.id,
    requestId,
  });
  return toInvitationSummary({ ...inv, revokedAt: now }, now);
}

/** Issues a fresh link for the same email and role. The old link stops working. */
export async function resendInvitation(
  deps: AppDeps,
  actor: AuthUser,
  id: string,
  requestId: string,
) {
  const inv = await findAgencyInvitation(deps, actor, id);
  if (inv.acceptedAt) throw conflict('This invitation was already accepted.');
  return createInvitation(
    deps,
    actor,
    { email: inv.emailNorm, role: inv.role as StaffRole },
    requestId,
  );
}

async function findOpenInvitation(deps: AppDeps, token: string) {
  const inv = await deps.db.invitation.findUnique({
    where: { tokenHash: sha256Hex(token) },
    include: { agency: true, clientOrg: true },
  });
  if (!inv || invitationStatus(inv) !== 'PENDING') throw tokenInvalid('invitation');
  if (inv.clientOrg?.archivedAt) throw tokenInvalid('invitation');
  return inv;
}

export async function previewInvitation(deps: AppDeps, token: string) {
  const inv = await findOpenInvitation(deps, token);
  return {
    email: inv.emailNorm,
    role: inv.role,
    agencyName: inv.agency.name,
    clientOrgName: inv.clientOrg?.name ?? null,
    expiresAt: inv.expiresAt.toISOString(),
  };
}

/**
 * Consumes the invitation and creates the user (FR-I05). The invitation row is locked with
 * SELECT ... FOR UPDATE, so concurrent or repeated acceptance creates exactly one user
 * (T-AUTH-04). The account email is the invited email: it cannot be changed here.
 */
export async function acceptInvitation(
  deps: AppDeps,
  input: { token: string; name: string; password: string },
  requestId: string,
) {
  const { db } = deps;
  const candidate = await findOpenInvitation(deps, input.token);
  const problem = checkPasswordPolicy(input.password, {
    email: candidate.emailNorm,
    name: input.name,
  });
  if (problem) throw validationFailed({ password: [PASSWORD_PROBLEM_MESSAGES[problem]] });
  const passwordHash = await hashPassword(input.password);
  const tokenHash = sha256Hex(input.token);

  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<
      Array<{
        id: string;
        agency_id: string;
        email_norm: string;
        role: Role;
        client_org_id: string | null;
      }>
    >`
      SELECT id, agency_id, email_norm, role, client_org_id FROM invitations
      WHERE token_hash = ${tokenHash} AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > now()
      FOR UPDATE`;
    const inv = locked[0];
    if (!inv) throw tokenInvalid('invitation');

    const existing = await tx.user.findUnique({
      where: { agencyId_emailNorm: { agencyId: inv.agency_id, emailNorm: inv.email_norm } },
      select: { id: true },
    });
    if (existing) throw conflict('An account with this email already exists. Sign in instead.');

    const user = await tx.user.create({
      data: {
        agencyId: inv.agency_id,
        emailNorm: inv.email_norm,
        name: input.name,
        role: inv.role,
        clientOrgId: inv.client_org_id,
        passwordHash,
      },
      include: { agency: true },
    });
    await tx.invitation.update({
      where: { id: inv.id },
      data: { acceptedAt: new Date(), acceptedUserId: user.id },
    });
    await writeAudit(tx, {
      agencyId: inv.agency_id,
      actorId: user.id,
      action: 'invitation.accept',
      outcome: 'SUCCESS',
      targetType: 'invitation',
      targetId: inv.id,
      requestId,
      metadata: { role: inv.role },
    });
    return user;
  });
}
