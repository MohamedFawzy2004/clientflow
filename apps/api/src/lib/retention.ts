// Automatic removal of short-lived security records (docs/18_PRIVACY_RETENTION.md, NFR-12).
// They hold only token hashes, but keeping them forever has no use. The worker runs this hourly.
import type { Db } from '../db/client.js';

/** Ended sessions and spent links and codes are kept this long for investigating an incident. */
export const AUTH_RECORD_DAYS = 30;

/**
 * Idempotency records answer a retried request with the first result. A client retries within
 * seconds or minutes; after this many days a repeat of the same key is not a retry, so the
 * record has done its job (backend audit F15).
 */
export const IDEMPOTENCY_RECORD_DAYS = 30;

export async function pruneExpiredAuth(db: Db, now = new Date()) {
  const before = new Date(now.getTime() - AUTH_RECORD_DAYS * 86_400_000);
  const [sessions, resets, challenges, recoveryCodes, invitations] = await Promise.all([
    db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] },
    }),
    db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: before } } }),
    // Security audit F17: two-step challenges last 5 minutes, used recovery codes never work
    // again, and an invitation that was never accepted is dead once expired or revoked.
    db.mfaChallenge.deleteMany({ where: { expiresAt: { lt: before } } }),
    db.mfaRecoveryCode.deleteMany({ where: { usedAt: { lt: before } } }),
    db.invitation.deleteMany({
      where: {
        acceptedAt: null,
        OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }],
      },
    }),
  ]);
  return {
    sessions: sessions.count,
    resetTokens: resets.count,
    mfaChallenges: challenges.count,
    recoveryCodes: recoveryCodes.count,
    invitations: invitations.count,
  };
}

export async function pruneIdempotencyRecords(db: Db, now = new Date()) {
  const before = new Date(now.getTime() - IDEMPOTENCY_RECORD_DAYS * 86_400_000);
  const res = await db.idempotencyRecord.deleteMany({ where: { createdAt: { lt: before } } });
  return { idempotencyRecords: res.count };
}
