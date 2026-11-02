import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';

export type Db = PrismaClient;

/**
 * Connection pool and server-side limits (backend audit, batch 3). Every limit turns "waits
 * forever" into an error the API answers with 503 + Retry-After (lib/db-errors.ts).
 */
export interface DbOptions {
  /** Connections in this process's pool. */
  poolMax?: number;
  /** Longest a single SQL statement may run. */
  statementTimeoutMs?: number;
  /**
   * Longest a statement waits for a row or advisory lock. Kept below Prisma's 5 s default
   * transaction timeout, so a blocked request fails as "busy" instead of an expired transaction.
   * A transaction that must wait longer raises it with SET LOCAL (see imports).
   */
  lockTimeoutMs?: number;
  /** A transaction left open and idle this long is ended by the server, releasing its locks. */
  idleInTransactionTimeoutMs?: number;
  /** Longest a request waits for a free connection from the pool. */
  connectTimeoutMs?: number;
}

export const DB_DEFAULTS: Required<DbOptions> = {
  poolMax: 10,
  statementTimeoutMs: 15_000,
  lockTimeoutMs: 3_000,
  idleInTransactionTimeoutMs: 120_000,
  connectTimeoutMs: 5_000,
};

export function createDb(databaseUrl: string, options: DbOptions = {}): Db {
  const o = { ...DB_DEFAULTS, ...definedOnly(options) };
  const adapter = new PrismaPg({
    connectionString: databaseUrl,
    max: o.poolMax,
    connectionTimeoutMillis: o.connectTimeoutMs,
    statement_timeout: o.statementTimeoutMs,
    lock_timeout: o.lockTimeoutMs,
    idle_in_transaction_session_timeout: o.idleInTransactionTimeoutMs,
  });
  return new PrismaClient({ adapter });
}

/** Options as read from the environment (see config/env.ts). */
export function dbOptionsFromEnv(env: {
  DB_POOL_MAX?: number;
  DB_STATEMENT_TIMEOUT_MS?: number;
  DB_LOCK_TIMEOUT_MS?: number;
  DB_IDLE_IN_TRANSACTION_TIMEOUT_MS?: number;
  DB_CONNECT_TIMEOUT_MS?: number;
}): DbOptions {
  return {
    poolMax: env.DB_POOL_MAX,
    statementTimeoutMs: env.DB_STATEMENT_TIMEOUT_MS,
    lockTimeoutMs: env.DB_LOCK_TIMEOUT_MS,
    idleInTransactionTimeoutMs: env.DB_IDLE_IN_TRANSACTION_TIMEOUT_MS,
    connectTimeoutMs: env.DB_CONNECT_TIMEOUT_MS,
  };
}

function definedOnly<T extends object>(o: T): Partial<T> {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Partial<T>;
}
