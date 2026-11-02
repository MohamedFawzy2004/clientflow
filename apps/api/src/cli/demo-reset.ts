// Rebuilds the fictional demo workspace (FR-A08, ADR-066):
//
//   DEMO_MODE=true npm run demo:reset -- --confirm <database name>
//
// Refuses unless DEMO_MODE is true, the database name contains "demo" and is typed back with
// --confirm, and the database is empty or holds only a demo agency. Passwords go to
// apps/api/.demo-credentials.local.json (gitignored) and are never printed.
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { DemoRefused, checkDemoTarget } from '../demo/guard.js';
import { resetDemo } from '../demo/reset.js';
import { LocalEncryptedStorage } from '../modules/files/storage.js';

const env = loadEnv();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};

const db = createDb(env.DATABASE_URL);
try {
  const target = await checkDemoTarget(db, { demoMode: env.DEMO_MODE, confirm: arg('--confirm') });
  const result = await resetDemo({
    db,
    storage: new LocalEncryptedStorage(
      env.FILE_STORAGE_DIR,
      Buffer.from(env.FILE_ENCRYPTION_KEY, 'hex'),
    ),
    csrfSecret: env.CSRF_SECRET,
    files: { maxBytes: env.FILE_MAX_BYTES, projectQuotaBytes: env.FILE_PROJECT_QUOTA_BYTES },
    log: (m) => console.log(`  ${m}`),
  });
  const file = fileURLToPath(new URL('../../.demo-credentials.local.json', import.meta.url));
  writeFileSync(file, JSON.stringify(result.credentials, null, 2) + '\n', { mode: 0o600 });
  console.log(
    `Demo "${target.database}" ready: ${result.credentials.length} accounts, ` +
      `${result.removedFiles} old file(s) removed, ${result.droppedEmails} queued email(s) dropped. ` +
      'Passwords: apps/api/.demo-credentials.local.json',
  );
} catch (err) {
  if (!(err instanceof DemoRefused)) throw err;
  console.error(`demo:reset refused: ${err.message}`);
  process.exitCode = 2;
} finally {
  await db.$disconnect();
}
