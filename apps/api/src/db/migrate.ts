// Applies prisma/migrations in order, recording each one in `_prisma_migrations` exactly as
// `prisma migrate deploy` does (same table, SHA-256 checksum of migration.sql, same advisory
// lock), so either tool can take over later. It exists because the runtime image has no Prisma
// CLI (ADR-065) and Render runs its pre-deploy step inside that image (ADR-067).
import { createHash, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import pg from 'pg';

/** Prisma Migrate's lock id, so this runner and the Prisma CLI never migrate at the same time. */
const PRISMA_MIGRATE_LOCK = 72707369;

export class MigrationError extends Error {}

export interface MigrationResult {
  applied: string[];
  alreadyApplied: number;
  /** Applied earlier, but the file has changed since. Prisma warns about these too. */
  modified: string[];
}

export async function applyMigrations(
  databaseUrl: string,
  dir: string,
  log: (line: string) => void = () => {},
): Promise<MigrationResult> {
  const folders = readdirSync(dir)
    .filter((name) => statSync(join(dir, name)).isDirectory())
    .sort();
  const migrations = folders.map((name) => {
    const sql = readFileSync(join(dir, name, 'migration.sql'));
    return {
      name,
      sql: sql.toString('utf8'),
      checksum: createHash('sha256').update(sql).digest('hex'),
    };
  });

  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    await client.query('SELECT pg_advisory_lock($1)', [PRISMA_MIGRATE_LOCK]);
    await client.query(`CREATE TABLE IF NOT EXISTS "_prisma_migrations" (
      "id" VARCHAR(36) PRIMARY KEY NOT NULL,
      "checksum" VARCHAR(64) NOT NULL,
      "finished_at" TIMESTAMPTZ,
      "migration_name" VARCHAR(255) NOT NULL,
      "logs" TEXT,
      "rolled_back_at" TIMESTAMPTZ,
      "started_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
      "applied_steps_count" INTEGER NOT NULL DEFAULT 0
    )`);
    const { rows } = await client.query<{
      migration_name: string;
      checksum: string;
      finished_at: Date | null;
      rolled_back_at: Date | null;
    }>(
      'SELECT migration_name, checksum, finished_at, rolled_back_at FROM "_prisma_migrations" ORDER BY started_at',
    );

    // A failed migration must be looked at by a person first (Prisma refuses the same way, P3009).
    const failed = rows.filter((r) => r.finished_at === null && r.rolled_back_at === null);
    if (failed.length > 0) {
      throw new MigrationError(
        `Migration ${failed.map((f) => f.migration_name).join(', ')} failed earlier. ` +
          'Fix the database, then mark it resolved (see docs/19_RUNBOOK.md) before deploying again.',
      );
    }

    const done = new Map(
      rows.filter((r) => r.finished_at).map((r) => [r.migration_name, r.checksum]),
    );
    const result: MigrationResult = { applied: [], alreadyApplied: 0, modified: [] };
    for (const m of migrations) {
      const recorded = done.get(m.name);
      if (recorded !== undefined) {
        result.alreadyApplied += 1;
        if (recorded !== m.checksum) result.modified.push(m.name);
        continue;
      }
      const id = randomUUID();
      await client.query(
        'INSERT INTO "_prisma_migrations" (id, checksum, migration_name, started_at) VALUES ($1, $2, $3, now())',
        [id, m.checksum, m.name],
      );
      try {
        // One transaction per migration: a failure leaves the schema exactly as it was.
        await client.query('BEGIN');
        await client.query(m.sql);
        await client.query('COMMIT');
      } catch (err) {
        await client.query('ROLLBACK');
        const message = err instanceof Error ? err.message : String(err);
        await client.query('UPDATE "_prisma_migrations" SET logs = $2 WHERE id = $1', [
          id,
          message.slice(0, 4000),
        ]);
        throw new MigrationError(`Migration ${m.name} failed and was rolled back: ${message}`);
      }
      await client.query(
        'UPDATE "_prisma_migrations" SET finished_at = now(), applied_steps_count = 1 WHERE id = $1',
        [id],
      );
      result.applied.push(m.name);
      log(`applied ${m.name}`);
    }
    for (const name of result.modified) {
      log(`WARNING ${name} was changed after it was applied`);
    }
    return result;
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [PRISMA_MIGRATE_LOCK]).catch(() => {});
    await client.end();
  }
}
