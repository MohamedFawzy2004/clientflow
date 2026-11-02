// Turns off one person's two-step sign-in from the server's shell (ADR-069). For the last Owner
// who lost both the phone and the recovery codes; everyone else is reset by an Owner in the app.
//
//   node apps/api/dist/cli/reset-mfa.js --email owner@agency.com
//
// Ends all their sessions. If their role requires two-step sign-in, they set it up again at the
// next sign-in. Recorded in the audit log.
import { loadEnv } from '../config/env.js';
import { createDb, dbOptionsFromEnv } from '../db/client.js';
import { writeAudit } from '../lib/audit.js';
import { normalizeEmail } from '../lib/normalize.js';
import { clearMfa } from '../modules/auth/mfa.js';

const env = loadEnv();
const i = process.argv.indexOf('--email');
const email = i >= 0 ? process.argv[i + 1] : undefined;
if (!email) {
  console.error('Usage: reset-mfa --email <address>');
  process.exit(2);
}

const db = createDb(env.DATABASE_URL, dbOptionsFromEnv(env));
try {
  const user = await db.user.findFirst({ where: { emailNorm: normalizeEmail(email) } });
  if (!user) {
    console.error('No account uses that email.');
    process.exitCode = 1;
  } else {
    await clearMfa(db, user.id);
    await db.session.updateMany({
      where: { userId: user.id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await writeAudit(db, {
      agencyId: user.agencyId,
      actorId: null,
      action: 'mfa.reset',
      outcome: 'SUCCESS',
      targetType: 'user',
      targetId: user.id,
      metadata: { via: 'cli' },
    });
    console.log('Two-step sign-in is off for that account and its sessions have ended.');
  }
} finally {
  await db.$disconnect();
}
