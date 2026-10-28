// Automatic removal of short-lived security records (docs/18_PRIVACY_RETENTION.md, NFR-12).
// They hold only token hashes, but keeping them forever has no use. The worker runs this hourly.
import type { Db } from '../db/client.js';

/** Ended sessions and spent reset links are kept this long for investigating an incident. */
export const AUTH_RECORD_DAYS = 30;

export async function pruneExpiredAuth(db: Db, now = new Date()) {
  const before = new Date(now.getTime() - AUTH_RECORD_DAYS * 86_400_000);
  const [sessions, resets] = await Promise.all([
    db.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: before } }, { revokedAt: { lt: before } }] },
    }),
    db.passwordResetToken.deleteMany({ where: { expiresAt: { lt: before } } }),
  ]);
  return { sessions: sessions.count, resetTokens: resets.count };
}
