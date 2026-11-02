// Idempotency-Key for create requests (O31, SEC-15; backend audit F15a/F17). A retried or doubled
// request with the same key returns the first result instead of creating a second record.
//
//   const once = idempotent(actor, 'deal.create', key, input, 'deal');
//   const earlier = await once?.earlier(db);          // replay before doing any work
//   ... inside the create transaction: await once?.remember(tx, created.id);
//   ... on a unique violation: const raced = await once?.afterRace(db, err);
//
// The key's unique index decides a race between two identical requests: the second insert waits
// for the first to commit, fails, and that request then replays the first result.
import { createHash } from 'node:crypto';
import { idempotencyKeySchema } from '@clientflow/contracts';
import type { Db } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { isUniqueViolation } from './db-errors.js';
import { conflict, validationFailed } from './errors.js';

type Tx = Prisma.TransactionClient;

export interface Idempotent {
  /** The result of an earlier request with this key, or null. Refuses a reused key. */
  earlier(db: Db | Tx): Promise<string | null>;
  /** Records the new result in the create transaction. */
  remember(tx: Tx, resultId: string): Promise<void>;
  /** After the create transaction failed: the winner's result when it lost a race, else null. */
  afterRace(db: Db, err: unknown): Promise<string | null>;
}

/**
 * Reads an optional Idempotency-Key header. Absent: undefined (the request works as before, so
 * older clients keep working). Present but not a UUID: refused, never silently ignored.
 */
export function optionalIdempotencyKey(header: string | undefined): string | undefined {
  if (header === undefined) return undefined;
  const parsed = idempotencyKeySchema.safeParse(header);
  if (!parsed.success) {
    throw validationFailed({ 'Idempotency-Key': ['Send the Idempotency-Key header as a UUID.'] });
  }
  return parsed.data;
}

export function requestHash(request: unknown): string {
  return createHash('sha256').update(JSON.stringify(request)).digest('hex');
}

/** Null when no key was sent: the request then behaves as it always did. */
export function idempotent(
  actor: { id: string; agencyId: string },
  scope: string,
  key: string | undefined,
  request: unknown,
  what: string,
): Idempotent | null {
  if (key === undefined) return null;
  const hash = requestHash(request);
  const where = { agencyId_scope_key: { agencyId: actor.agencyId, scope, key } };
  const earlier = async (db: Db | Tx) => {
    const rec = await db.idempotencyRecord.findUnique({ where });
    if (!rec) return null;
    // Another person's key, or the same key for other values, is a client bug: never replay it.
    if (rec.requestHash !== hash || rec.actorId !== actor.id) {
      throw conflict(`This Idempotency-Key was already used for a different ${what}.`);
    }
    return rec.resultId;
  };
  return {
    earlier,
    async remember(tx, resultId) {
      await tx.idempotencyRecord.create({
        data: {
          agencyId: actor.agencyId,
          actorId: actor.id,
          scope,
          key,
          requestHash: hash,
          resultId,
        },
      });
    },
    async afterRace(db, err) {
      return isUniqueViolation(err) ? earlier(db) : null;
    },
  };
}
