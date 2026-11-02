// npm run backup -- [--out <dir>]
// Writes a consistent database dump, a copy of the encrypted file store and a manifest
// (ADR-063). The file encryption key is NOT included: keep it in the secret manager (R26).
import { cpSync, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { loadEnv } from '../config/env.js';
import { createDb } from '../db/client.js';
import {
  appliedMigrations,
  describeFiles,
  keyFingerprint,
  sha256File,
  tableCounts,
  type BackupManifest,
} from './backup-manifest.js';
import { parsePgUrl, pgDump } from './pg-tools.js';

const env = loadEnv();
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const out = resolve(arg('--out') ?? join('backups', stamp));
if (existsSync(out)) {
  console.error(`Refusing to overwrite ${out}`);
  process.exit(2);
}
mkdirSync(out, { recursive: true, mode: 0o700 });

const db = createDb(env.DATABASE_URL);
const started = Date.now();
try {
  // Counts first, then the dump: rows written in between show up as a count mismatch on restore
  // only if the agency was busy. Back up at a quiet time, or compare against the dump itself.
  const [migrations, counts] = [await appliedMigrations(db), await tableCounts(db)];
  const dump = join(out, 'db.dump');
  await pgDump(parsePgUrl(env.DATABASE_URL), dump);
  const storage = resolve(env.FILE_STORAGE_DIR);
  if (existsSync(storage)) cpSync(storage, join(out, 'files'), { recursive: true });
  const manifest: BackupManifest = {
    format: 'clientflow-backup/1',
    createdAt: new Date().toISOString(),
    migrations,
    tableCounts: counts,
    database: { file: 'db.dump', bytes: statSync(dump).size, sha256: await sha256File(dump) },
    files: await describeFiles(join(out, 'files')),
    keyFingerprint: keyFingerprint(env.FILE_ENCRYPTION_KEY),
  };
  writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 2), { mode: 0o600 });
  // Counts and sizes only: no row data, names or addresses in the log.
  console.log(
    JSON.stringify({
      backup: out,
      seconds: Math.round((Date.now() - started) / 100) / 10,
      tables: Object.keys(counts).length,
      rows: Object.values(counts).reduce((a, b) => a + b, 0),
      dumpBytes: manifest.database.bytes,
      files: manifest.files.length,
      migrations: migrations.length,
    }),
  );
} finally {
  await db.$disconnect();
}
