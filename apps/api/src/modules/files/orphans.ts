// Stored objects without a file row, and file rows without a stored object (backend audit, F13).
// An upload writes the object before its row, so a crash between the two leaves an orphan; so
// does a crash between deleting a row and removing its object. This finds both kinds and, only
// when asked, removes orphans old enough that no upload can still be finishing them.
import type { Db } from '../../db/client.js';
import type { LocalEncryptedStorage, StoredObjectEntry } from './storage.js';

/** An upload in progress is never this old; anything younger is left alone. */
export const ORPHAN_MIN_AGE_MS = 24 * 3_600_000;

export interface OrphanReport {
  objects: number;
  rows: number;
  /** Objects (and `.part` leftovers) no row points to, old enough to remove. */
  orphans: StoredObjectEntry[];
  /** Orphans younger than the minimum age: possibly an upload still running. Left alone. */
  recent: number;
  /** Rows whose object is missing: those files cannot be downloaded. Reported, never changed. */
  missing: Array<{ fileId: string; storageKey: string }>;
}

export async function findOrphans(
  db: Db,
  storage: Pick<LocalEncryptedStorage, 'list'>,
  { now = new Date(), minAgeMs = ORPHAN_MIN_AGE_MS } = {},
): Promise<OrphanReport> {
  const rows = await db.storedFile.findMany({ select: { id: true, storageKey: true } });
  const keys = new Set(rows.map((r) => r.storageKey));
  const present = new Set<string>();
  const orphans: StoredObjectEntry[] = [];
  let objects = 0;
  let recent = 0;
  for await (const entry of storage.list()) {
    if (!entry.partial) {
      objects += 1;
      present.add(entry.key);
    }
    // A finished object with a row is in use. A `.part` never is, row or not.
    if (!entry.partial && keys.has(entry.key)) continue;
    if (now.getTime() - entry.modifiedAt.getTime() < minAgeMs) recent += 1;
    else orphans.push(entry);
  }
  const missing = rows
    .filter((r) => !present.has(r.storageKey))
    .map((r) => ({ fileId: r.id, storageKey: r.storageKey }));
  return { objects, rows: rows.length, orphans, recent, missing };
}

/**
 * Why removing would be unsafe, or null. Most often the storage folder and the database do not
 * belong together (a restored or empty database, another environment's folder): then nearly
 * every object looks orphaned, and removing them would destroy real files.
 */
export function unsafeToRemove(r: OrphanReport): string | null {
  if (r.objects > 0 && r.rows === 0) {
    return 'The database has no file rows but the storage folder has objects. Is this the right database?';
  }
  const finished = r.orphans.filter((o) => !o.partial).length;
  if (finished > 0 && finished * 2 > r.objects) {
    return `${finished} of ${r.objects} objects have no row. That looks like a mismatched database or folder, not crash leftovers.`;
  }
  return null;
}
