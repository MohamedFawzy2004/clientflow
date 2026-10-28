// npm run restore -- --from <backup dir> --target-url <postgresql://…/clientflow_restore>
//                     --storage-dir <empty dir>
// Restores a backup into an ISOLATED, empty database and file folder, then proves it reconciles
// (T-OPS-01): migrations, row counts, and every stored file decrypts to its recorded checksum.
// It refuses to touch the database in DATABASE_URL.
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import { LocalEncryptedStorage } from '../modules/files/storage.js';
import {
  appliedMigrations,
  describeFiles,
  keyFingerprint,
  sha256File,
  tableCounts,
  type BackupManifest,
} from './backup-manifest.js';
import { parsePgUrl, pgRestore } from './pg-tools.js';

const env = loadEnv();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const from = arg('--from');
const targetUrl = arg('--target-url');
const storageDir = arg('--storage-dir');
if (!from || !targetUrl || !storageDir) {
  console.error('Usage: restore --from <dir> --target-url <url> --storage-dir <dir>');
  process.exit(2);
}

const problems: string[] = [];
const fail = (msg: string) => {
  console.error(msg);
  process.exit(1);
};

const manifest = JSON.parse(readFileSync(join(from, 'manifest.json'), 'utf8')) as BackupManifest;
if (manifest.format !== 'clientflow-backup/1') fail('Unknown backup format.');

// 1. The backup itself is intact.
if ((await sha256File(join(from, 'db.dump'))) !== manifest.database.sha256) {
  fail('db.dump does not match its checksum: the backup is damaged.');
}
const files = await describeFiles(join(from, 'files'));
if (JSON.stringify(files) !== JSON.stringify(manifest.files)) {
  fail('The file copy does not match the manifest: the backup is damaged.');
}
if (keyFingerprint(env.FILE_ENCRYPTION_KEY) !== manifest.keyFingerprint) {
  fail('FILE_ENCRYPTION_KEY is not the key this backup was made with. Files could not be read.');
}

// 2. Isolation: never the live database, never a database or folder that has content.
const live = parsePgUrl(env.DATABASE_URL);
const target = parsePgUrl(targetUrl);
if (live.host === target.host && live.port === target.port && live.database === target.database) {
  fail('Refusing to restore into the database in DATABASE_URL. Restore into a separate one.');
}
const storage = resolve(storageDir);
if (existsSync(storage) && readdirSync(storage).length > 0) {
  fail(`Refusing to restore files into ${storage}: the folder is not empty.`);
}
const admin = createDb(targetUrl.replace(/\/[^/?]+(\?|$)/, '/postgres$1'));
try {
  const exists = await admin.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM pg_database WHERE datname = ${target.database}`;
  if (Number(exists[0]!.n) === 0) {
    if (!/^[a-z0-9_]+$/.test(target.database)) fail('Use a plain lowercase database name.');
    await admin.$executeRawUnsafe(`CREATE DATABASE "${target.database}"`);
  }
} finally {
  await admin.$disconnect();
}
const db = createDb(targetUrl);
const started = Date.now();
try {
  const existing = await db.$queryRaw<Array<{ n: bigint }>>`
    SELECT count(*) AS n FROM pg_tables WHERE schemaname = 'public'`;
  if (Number(existing[0]!.n) > 0) fail(`Refusing: ${target.database} already has tables.`);

  // 3. Restore.
  await pgRestore(target, join(from, 'db.dump'));
  mkdirSync(storage, { recursive: true });
  if (existsSync(join(from, 'files'))) cpSync(join(from, 'files'), storage, { recursive: true });

  // 4. Reconcile.
  const migrations = await appliedMigrations(db);
  if (JSON.stringify(migrations) !== JSON.stringify(manifest.migrations)) {
    problems.push('The applied migrations differ from the backup.');
  }
  const counts = await tableCounts(db);
  for (const [table, n] of Object.entries(manifest.tableCounts)) {
    if (counts[table] !== n)
      problems.push(`${table}: ${counts[table] ?? 'missing'} rows, expected ${n}`);
  }
  const store = new LocalEncryptedStorage(storage, Buffer.from(env.FILE_ENCRYPTION_KEY, 'hex'));
  const rows = await db.storedFile.findMany({
    select: {
      id: true,
      storageKey: true,
      sizeBytes: true,
      sha256: true,
      encIv: true,
      encTag: true,
    },
  });
  let verified = 0;
  for (const f of rows) {
    try {
      const h = createHash('sha256');
      let bytes = 0;
      for await (const chunk of store.get(f.storageKey, { iv: f.encIv, tag: f.encTag })) {
        h.update(chunk as Buffer);
        bytes += (chunk as Buffer).length;
      }
      if (h.digest('hex') !== f.sha256 || bytes !== f.sizeBytes) {
        problems.push(`file ${f.id}: content does not match its checksum`);
      } else verified += 1;
    } catch {
      problems.push(`file ${f.id}: missing or cannot be decrypted`);
    }
  }
  // Objects no file row points to (uploads whose database rows were removed, e.g. by test
  // resets). They are reported, not a failure: nothing can reach them.
  const referenced = new Set(rows.map((f) => `${f.storageKey.slice(0, 2)}/${f.storageKey}.bin`));
  const unreferenced = manifest.files.filter((f) => !referenced.has(f.path)).length;
  // IDs and counts only: no names, emails or file names in the report.
  console.log(
    JSON.stringify(
      {
        restoredInto: target.database,
        seconds: Math.round((Date.now() - started) / 100) / 10,
        backupCreatedAt: manifest.createdAt,
        migrations: migrations.length,
        tables: Object.keys(counts).length,
        rows: Object.values(counts).reduce((a, b) => a + b, 0),
        filesVerified: verified,
        filesInDatabase: rows.length,
        unreferencedObjects: unreferenced,
        problems,
        result: problems.length === 0 ? 'RECONCILED' : 'MISMATCH',
      },
      null,
      2,
    ),
  );
  if (problems.length > 0) process.exitCode = 1;
} finally {
  await db.$disconnect();
}
