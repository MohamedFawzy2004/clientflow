import type { AppDeps } from '../../app.js';
import { writeAudit } from '../../lib/audit.js';
import { tokenInvalid, validationFailed } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/normalize.js';
import {
  checkPasswordPolicy,
  hashPassword,
  PASSWORD_PROBLEM_MESSAGES,
} from '../../lib/password.js';
import { generateToken, sha256Hex } from '../../lib/tokens.js';

export const RESET_TOKEN_TTL_MS = 30 * 60 * 1000;

/**
 * Handles a reset request for `email` (FR-I06). The caller always answers with the same generic
 * 202 before this finishes, so the response never reveals whether the account exists.
 * Older unused tokens for the user are invalidated, so only the newest link works.
 */
export async function processResetRequest(deps: AppDeps, email: string, requestId: string) {
  const { db, mailer, config } = deps;
  const emailNorm = normalizeEmail(email);
  const user = await db.user.findFirst({
    where: { emailNorm, active: true },
    include: { agency: true },
  });
  if (!user) {
    await writeAudit(db, {
      action: 'auth.password_reset_request',
      outcome: 'FAILURE',
      requestId,
      metadata: { reason: 'no_active_account' },
    });
    return;
  }

  const token = generateToken(32);
  const now = new Date();
  await db.$transaction(async (tx) => {
    await tx.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: now },
    });
    await tx.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: sha256Hex(token),
        expiresAt: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
        createdAt: now,
      },
    });
    await writeAudit(tx, {
      agencyId: user.agencyId,
      action: 'auth.password_reset_request',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: user.id,
      requestId,
    });
  });

  // The token goes in the URL fragment, which browsers never send to servers or in Referer.
  await mailer.send({
    kind: 'password_reset',
    to: user.emailNorm,
    subject: 'Reset your ClientFlow password',
    text: [
      `Hi ${user.name},`,
      '',
      `Someone asked to reset the password for your ${user.agency.name} account on ClientFlow.`,
      'Use this link within 30 minutes:',
      `${config.publicUrl}/reset-password#token=${token}`,
      '',
      'If you did not ask for this, ignore this email. Your password stays the same.',
    ].join('\n'),
  });
}

/**
 * Consumes a reset token and sets the new password. Single use: the token row is locked, so two
 * concurrent confirmations cannot both succeed. All sessions are revoked afterwards.
 */
export async function confirmReset(
  deps: AppDeps,
  input: { token: string; password: string },
  requestId: string,
) {
  const { db, mailer } = deps;
  const tokenHash = sha256Hex(input.token);

  // Read first (no lock) only to run the password policy with the user's own details.
  const candidate = await db.passwordResetToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (
    !candidate ||
    candidate.usedAt ||
    candidate.expiresAt <= new Date() ||
    !candidate.user.active
  ) {
    throw tokenInvalid('reset');
  }
  const problem = checkPasswordPolicy(input.password, {
    email: candidate.user.emailNorm,
    name: candidate.user.name,
  });
  if (problem) throw validationFailed({ password: [PASSWORD_PROBLEM_MESSAGES[problem]] });
  const passwordHash = await hashPassword(input.password);

  const user = await db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<Array<{ id: string; user_id: string }>>`
      SELECT t.id, t.user_id FROM password_reset_tokens t
      JOIN users u ON u.id = t.user_id
      WHERE t.token_hash = ${tokenHash} AND t.used_at IS NULL AND t.expires_at > now() AND u.active
      FOR UPDATE OF t`;
    const row = locked[0];
    if (!row) throw tokenInvalid('reset');
    const now = new Date();
    await tx.passwordResetToken.updateMany({
      where: { userId: row.user_id, usedAt: null },
      data: { usedAt: now },
    });
    const updated = await tx.user.update({
      where: { id: row.user_id },
      data: { passwordHash, version: { increment: 1 } },
    });
    await tx.session.updateMany({
      where: { userId: row.user_id, revokedAt: null },
      data: { revokedAt: now },
    });
    await writeAudit(tx, {
      agencyId: updated.agencyId,
      actorId: updated.id,
      action: 'auth.password_reset',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: updated.id,
      requestId,
    });
    return updated;
  });

  await mailer.send({
    kind: 'password_changed',
    to: user.emailNorm,
    subject: 'Your ClientFlow password was changed',
    text: [
      `Hi ${user.name},`,
      '',
      'The password for your ClientFlow account was just changed, and you were signed out everywhere.',
      'If this was not you, contact your agency owner or admin immediately.',
    ].join('\n'),
  });
}
