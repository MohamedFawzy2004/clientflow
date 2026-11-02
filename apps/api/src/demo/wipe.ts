// Empties a demo database that checkDemoTarget accepted: stored files first (only the keys the
// database knows), then every table except the migration history.
import type { Db } from '../db/client.js';
import type { FileStorage } from '../modules/files/storage.js';

export async function wipeDemo(db: Db, storage: FileStorage) {
  const files = await db.storedFile.findMany({ select: { storageKey: true } });
  for (const f of files) await storage.remove(f.storageKey);

  const tables = await db.$queryRaw<Array<{ name: string }>>`
    SELECT tablename AS name FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  if (tables.length > 0) {
    const list = tables.map((t) => `"${t.name.replace(/"/g, '""')}"`).join(', ');
    // TRUNCATE skips row triggers, so the append-only audit table empties too.
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  return { files: files.length, tables: tables.length };
}
