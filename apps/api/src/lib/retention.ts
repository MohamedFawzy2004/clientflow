// Automatic removal of short-lived security records (docs/18_PRIVACY_RETENTION.md, NFR-12).
// They hold only token hashes, but keeping them forever has no use. The worker runs this hourly.
import type { Db } from '../db/client.js';

/** Ended sessions and spent reset links are kept this long for investigating an incident. */
export const AUTH_RECORD_DAYS = 30;

/**
 * Idempotency records answer a retried request with the first result. A client retries within
 * seconds or minutes; after this many days a repeat of the same key is not a retry, so the
 * record has done its job (backend audit F15).
 */
export const IDEMPOTENCY_RECORD_DAYS = 30;

export async function pruneExpiredAuth(db: Db, now = new Date()) {
  const before = new Date(now.getTime() - AUTH_RECORD_DAYS * 86_400_000);
  const [sessions, resets, mfa] = await Promise.all([
    db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] },
    }),
    db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: before } } }),
    // Sign-in already clears a user's old challenges; this catches users who never come back.
    db.mfaChallenge.deleteMany({ where: { expiresAt: { lt: before } } }),
  ]);
  return { sessions: sessions.count, resetTokens: resets.count, mfaChallenges: mfa.count };
}

export async function pruneIdempotencyRecords(db: Db, now = new Date()) {
  const before = new Date(now.getTime() - IDEMPOTENCY_RECORD_DAYS * 86_400_000);
  const res = await db.idempotencyRecord.deleteMany({ where: { createdAt: { lt: before } } });
  return { idempotencyRecords: res.count };
}
