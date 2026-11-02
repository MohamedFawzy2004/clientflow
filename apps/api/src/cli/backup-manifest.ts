// What a backup contains and how a restore is checked against it (ADR-063, T-OPS-01).
import { createHash } from 'node:crypto';
import { createReadStream, existsSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { Db } from '../db/client.js';

export interface BackupManifest {
  format: 'clientflow-backup/1';
  createdAt: string;
  /** Applied migrations, in order: a restore must show the same list. */
  migrations: string[];
  /** Rows per table at backup time. */
  tableCounts: Record<string, number>;
  database: { file: 'db.dump'; bytes: number; sha256: string };
  /** Encrypted objects as stored on disk (still encrypted in the backup). */
  files: Array<{ path: string; bytes: number; sha256: string }>;
  /**
   * First 16 hex characters of SHA-256 of FILE_ENCRYPTION_KEY. Lets a restore tell whether it has
   * the right key. The key itself is never in a backup: it is kept apart (R26).
   */
  keyFingerprint: string;
}

export function sha256File(path: string) {
  return new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')));
  });
}

export function keyFingerprint(hexKey: string) {
  return createHash('sha256').update(Buffer.from(hexKey, 'hex')).digest('hex').slice(0, 16);
}

/** Every file under `dir`, as forward-slash paths relative to it. */
export function listFiles(dir: string): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out.push(relative(dir, p).split(sep).join('/'));
    }
  };
  walk(dir);
  return out.sort();
}

export async function describeFiles(dir: string) {
  return Promise.all(
    listFiles(dir).map(async (path) => ({
      path,
      bytes: statSync(join(dir, path)).size,
      sha256: await sha256File(join(dir, path)),
    })),
  );
}

export async function tableCounts(db: Db) {
  const tables = await db.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
    ORDER BY tablename`;
  const counts: Record<string, number> = {};
  for (const { tablename } of tables) {
    // Table names come from the catalog, not from input; quoted as identifiers.
    const [row] = await db.$queryRawUnsafe<Array<{ n: bigint }>>(
      `SELECT count(*) AS n FROM "${tablename.replace(/"/g, '""')}"`,
    );
    counts[tablename] = Number(row!.n);
  }
  return counts;
}

export async function appliedMigrations(db: Db) {
  const rows = await db.$queryRaw<Array<{ migration_name: string }>>`
    SELECT migration_name FROM _prisma_migrations
    WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL
    ORDER BY migration_name`;
  return rows.map((r) => r.migration_name);
}
