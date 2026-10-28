// M12.1 — the in-image migration runner (ADR-067) must leave a database exactly as
// `prisma migrate deploy` would: Prisma itself is asked afterwards.
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MigrationError, applyMigrations } from '../src/db/migrate.js';

const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const MIGRATIONS = join(ROOT, 'prisma', 'migrations');
const base = new URL(process.env.DATABASE_URL!);
const urlFor = (db: string) => Object.assign(new URL(base.href), { pathname: `/${db}` }).href;
const DB = 'clientflow_test_migrate';

async function admin(sql: string) {
  const c = new pg.Client({ connectionString: urlFor('postgres') });
  await c.connect();
  try {
    await c.query(sql);
  } finally {
    await c.end();
  }
}

function prisma(args: string[], url: string) {
  const res = spawnSync('npx', ['prisma', ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: url },
    encoding: 'utf8',
    shell: process.platform === 'win32',
  });
  return { status: res.status, out: `${res.stdout}\n${res.stderr}` };
}

describe('migration runner', () => {
  beforeAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${DB}`);
    await admin(`CREATE DATABASE ${DB}`);
  });
  afterAll(async () => {
    await admin(`DROP DATABASE IF EXISTS ${DB} WITH (FORCE)`);
  });

  it('applies every migration, and Prisma then sees nothing pending or modified', async () => {
    const result = await applyMigrations(urlFor(DB), MIGRATIONS);
    expect(result.applied.length).toBeGreaterThan(10);
    expect(result.modified).toEqual([]);

    const deploy = prisma(['migrate', 'deploy'], urlFor(DB));
    expect(deploy.status).toBe(0);
    expect(deploy.out).toMatch(/No pending migrations to apply/);
    expect(deploy.out).not.toMatch(/modified since they were applied/);
    const status = prisma(['migrate', 'status'], urlFor(DB));
    expect(status.out).toMatch(/Database schema is up to date/);
  }, 120_000);

  it('a second run applies nothing', async () => {
    const again = await applyMigrations(urlFor(DB), MIGRATIONS);
    expect(again.applied).toEqual([]);
    expect(again.alreadyApplied).toBeGreaterThan(10);
  });

  it('a failing migration rolls back, is recorded, and blocks later runs', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-migrations-'));
    cpSync(MIGRATIONS, dir, { recursive: true });
    mkdirSync(join(dir, '29991231000000_broken'));
    writeFileSync(
      join(dir, '29991231000000_broken', 'migration.sql'),
      'CREATE TABLE "half_done" ("id" INT);\nSELECT * FROM "no_such_table";\n',
    );
    await expect(applyMigrations(urlFor(DB), dir)).rejects.toThrow(/rolled back/);

    const c = new pg.Client({ connectionString: urlFor(DB) });
    await c.connect();
    try {
      const table = await c.query(`SELECT to_regclass('public.half_done') AS t`);
      expect(table.rows[0].t).toBeNull(); // the first statement was rolled back too
      const row = await c.query(
        `SELECT finished_at, logs FROM "_prisma_migrations" WHERE migration_name = '29991231000000_broken'`,
      );
      expect(row.rows[0].finished_at).toBeNull();
      expect(row.rows[0].logs).toMatch(/no_such_table/);
    } finally {
      await c.end();
    }
    await expect(applyMigrations(urlFor(DB), MIGRATIONS)).rejects.toThrow(MigrationError);
    await expect(applyMigrations(urlFor(DB), MIGRATIONS)).rejects.toThrow(/failed earlier/);
  });
});
