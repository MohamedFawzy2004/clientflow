// Reports stored objects without a file row (crash leftovers) and file rows without an object.
// Read-only unless --delete is given (backend audit, F13; docs/19_RUNBOOK.md).
//
//   npm run files:orphans                 # report only
//   npm run files:orphans -- --delete     # also remove orphans older than 24 hours
//
// Run it against the database and FILE_STORAGE_DIR of the same environment. It refuses to
// delete when they look mismatched (see unsafeToRemove).
import { loadEnv } from '../config/env.js';
import { createDb, dbOptionsFromEnv } from '../db/client.js';
import { findOrphans, ORPHAN_MIN_AGE_MS, unsafeToRemove } from '../modules/files/orphans.js';
import { LocalEncryptedStorage } from '../modules/files/storage.js';

const env = loadEnv();
const remove = process.argv.includes('--delete');
const db = createDb(env.DATABASE_URL, dbOptionsFromEnv(env));
const storage = new LocalEncryptedStorage(
  env.FILE_STORAGE_DIR,
  Buffer.from(env.FILE_ENCRYPTION_KEY, 'hex'),
);

try {
  const r = await findOrphans(db, storage);
  const partial = r.orphans.filter((o) => o.partial);
  const finished = r.orphans.filter((o) => !o.partial);
  const mb = (n: number) => `${(n / 1_048_576).toFixed(1)} MB`;
  console.log(`Stored objects: ${r.objects}. File rows: ${r.rows}.`);
  console.log(
    `Orphans older than ${ORPHAN_MIN_AGE_MS / 3_600_000} h: ${finished.length} objects, ${partial.length} unfinished writes (${mb(r.orphans.reduce((s, o) => s + o.bytes, 0))}).`,
  );
  if (r.recent > 0)
    console.log(`Younger orphans left alone (uploads may be running): ${r.recent}.`);
  if (r.missing.length > 0) {
    console.log(`File rows whose object is MISSING (cannot be downloaded): ${r.missing.length}.`);
    for (const m of r.missing.slice(0, 20)) console.log(`  file ${m.fileId}`);
    process.exitCode = 1;
  }
  if (remove && r.orphans.length > 0) {
    const reason = unsafeToRemove(r);
    if (reason) {
      console.error(`Not deleting: ${reason}`);
      process.exitCode = 2;
    } else {
      for (const o of r.orphans) {
        if (o.partial) await storage.removePartial(o.key);
        else await storage.remove(o.key);
      }
      console.log(`Deleted ${r.orphans.length} orphans.`);
    }
  } else if (r.orphans.length > 0) {
    console.log('Nothing deleted. Run again with --delete to remove the orphans.');
  }
} finally {
  await db.$disconnect();
}
