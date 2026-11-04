// File storage hardening (backend audit, batch 5, F13): the project quota holds when uploads run
// at once, and the orphan report finds crash leftovers without touching anything in use.
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readdirSync, statSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findOrphans, unsafeToRemove } from '../src/modules/files/orphans.js';
import { LocalEncryptedStorage } from '../src/modules/files/storage.js';
import {
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  STORAGE_DIR,
  TEST_FILE_MAX_BYTES,
  testDb,
  type SeededAgency,
} from './helpers.js';
import { makeProject } from './proposal-fixtures.js';

const db = testDb();
let seeded: SeededAgency;
let projectId: string;
const open: pg.Client[] = [];

const PDF = Buffer.from(
  '%PDF-1.4\n% ClientFlow fixture\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n',
);

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
  ({ projectId } = await makeProject(db, {
    agencyId: seeded.agencyId,
    managerId: seeded.users.pm!.id,
    createdById: seeded.users.pm!.id,
    memberIds: [seeded.users.member!.id],
  }));
});
afterEach(async () => {
  for (const c of open.splice(0)) await c.end().catch(() => undefined);
});
afterAll(() => db.$disconnect());

function objectsIn(dir: string) {
  let n = 0;
  for (const d of readdirSync(dir)) {
    const p = join(dir, d);
    if (statSync(p).isDirectory()) n += readdirSync(p).filter((f) => f.endsWith('.bin')).length;
  }
  return n;
}

/** True once `n` transactions wait on a lock; false after ~4 s (the old code never waits). */
async function waitForWaiters(n: number) {
  for (let i = 0; i < 160; i++) {
    const [row] = await db.$queryRaw<Array<{ n: bigint }>>`
      SELECT count(*)::bigint AS n FROM pg_stat_activity
      WHERE datname = current_database() AND wait_event_type = 'Lock'`;
    if (Number(row!.n) >= n) return true;
    await new Promise((r) => setTimeout(r, 25));
  }
  return false;
}

describe('project file quota under simultaneous uploads (F13)', () => {
  it('two uploads that each fit but not together: one is kept, the other refused and removed', async () => {
    // Room for one fixture PDF and a half.
    const { app } = makeApp({
      files: { maxBytes: TEST_FILE_MAX_BYTES, projectQuotaBytes: Math.floor(PDF.length * 1.5) },
    });
    const member = await login(app, seeded.users.member!.email);
    const upload = (name: string) =>
      member.agent
        .post(`/api/v1/projects/${projectId}/files`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', member.csrf)
        .set('X-File-Name', encodeURIComponent(name))
        .set('Content-Type', 'application/octet-stream')
        .send(PDF)
        .then((r) => r);
    const before = objectsIn(STORAGE_DIR);

    // Hold the quota lock, so both uploads pass the early check before either commits.
    const hold = new pg.Client({ connectionString: process.env.DATABASE_URL });
    await hold.connect();
    open.push(hold);
    await hold.query('BEGIN');
    await hold.query(
      `SELECT pg_advisory_xact_lock(hashtext('clientflow.file-quota'), hashtext($1))`,
      [projectId],
    );
    const both = Promise.all([upload('a.pdf'), upload('b.pdf')]);
    const bothWaited = await waitForWaiters(2);
    await hold.query('COMMIT');
    const results = await both;

    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    expect(results.find((r) => r.status === 409)!.body.error.message).toMatch(/file storage/);
    const used = await db.storedFile.aggregate({ where: { projectId }, _sum: { sizeBytes: true } });
    expect(used._sum.sizeBytes).toBe(PDF.length);
    // The refused upload's object was removed again: one new object, not two.
    expect(objectsIn(STORAGE_DIR)).toBe(before + 1);
    // Both passed the early check and met at the lock, so this was a real race, not two turns.
    expect(bothWaited).toBe(true);
  });
});

describe('orphan report (F13)', () => {
  const day = 86_400_000;
  const old = new Date(Date.now() - 3 * day);
  const dir = () => mkdtempSync(join(tmpdir(), 'cf-orphans-'));
  const put = async (storage: LocalEncryptedStorage, key = randomUUID()) => {
    const meta = await storage.put(
      key,
      (async function* () {
        yield randomBytes(64);
      })(),
    );
    return { key, meta };
  };
  const age = (root: string, key: string, when: Date, suffix = '') =>
    utimesSync(join(root, key.slice(0, 2), `${key}.bin${suffix}`), when, when);
  const row = (storageKey: string) =>
    db.storedFile.create({
      data: {
        agencyId: seeded.agencyId,
        projectId,
        uploadedById: seeded.users.member!.id,
        storageKey,
        originalName: 'x.pdf',
        extension: 'pdf',
        mimeType: 'application/pdf',
        sizeBytes: 64,
        sha256: 'c'.repeat(64),
        scanStatus: 'CLEAN',
        scannedAt: new Date(),
      },
    });

  it('finds old orphans and unfinished writes, leaves young ones and files in use alone', async () => {
    const root = dir();
    const storage = new LocalEncryptedStorage(root, randomBytes(32));
    const inUse = await put(storage);
    await row(inUse.key);
    age(root, inUse.key, old);
    const inUse2 = await put(storage);
    await row(inUse2.key);
    const orphan = await put(storage);
    age(root, orphan.key, old);
    const young = await put(storage); // an upload whose row is not written yet
    const partialKey = randomUUID();
    mkdirSync(join(root, partialKey.slice(0, 2)), { recursive: true });
    writeFileSync(join(root, partialKey.slice(0, 2), `${partialKey}.bin.part`), 'half');
    age(root, partialKey, old, '.part');
    const gone = await row(randomUUID()); // its object was lost

    const r = await findOrphans(db, storage);
    expect(r.objects).toBe(4);
    expect(r.rows).toBe(3);
    expect(r.orphans.map((o) => [o.key, o.partial]).sort()).toEqual(
      [
        [orphan.key, false],
        [partialKey, true],
      ].sort(),
    );
    expect(r.recent).toBe(1);
    expect(r.orphans.map((o) => o.key)).not.toContain(young.key);
    expect(r.missing).toEqual([{ fileId: gone.id, storageKey: gone.storageKey }]);
    expect(unsafeToRemove(r)).toBeNull();
  });

  it('refuses to delete when the database and the folder do not look like a pair', async () => {
    const root = dir();
    const storage = new LocalEncryptedStorage(root, randomBytes(32));
    for (let i = 0; i < 3; i++) age(root, (await put(storage)).key, old);
    // No file rows at all: an empty or wrong database.
    expect(unsafeToRemove(await findOrphans(db, storage))).toMatch(/no file rows/);
    // Most objects without rows: also a mismatch, not crash leftovers.
    const kept = await put(storage);
    await row(kept.key);
    expect(unsafeToRemove(await findOrphans(db, storage))).toMatch(/3 of 4 objects have no row/);
  });
});
