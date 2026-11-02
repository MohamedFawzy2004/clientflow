// One place that knows how database errors arrive through Prisma and @prisma/adapter-pg, and
// which of them a person can act on. Checked against PostgreSQL 17 with Prisma 7 and
// adapter-pg (backend audit, batch 3): the SQLSTATE is in meta.driverAdapterError.cause.
import { Prisma } from '../generated/prisma/client.js';
import { AppError } from './errors.js';

interface AdapterCause {
  originalCode?: string;
  kind?: string;
}

/** The PostgreSQL SQLSTATE behind a Prisma error, when there is one (e.g. '23505'). */
export function sqlState(err: unknown): string | undefined {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return undefined;
  const meta = err.meta as { driverAdapterError?: { cause?: AdapterCause } } | undefined;
  return meta?.driverAdapterError?.cause?.originalCode;
}

/** A unique constraint said no: from a model query (P2002) or a raw query (P2010 + 23505). */
export function isUniqueViolation(err: unknown): boolean {
  if (!(err instanceof Prisma.PrismaClientKnownRequestError)) return false;
  return err.code === 'P2002' || sqlState(err) === '23505';
}

/** Why a database error happened, in the terms the API answers with. */
export type DbErrorKind =
  /** Another request got there first, or the data changed meanwhile (409). */
  | 'conflict'
  /** The record is gone (404). */
  | 'not_found'
  /** Busy or briefly unreachable; the same request can succeed in a moment (503). */
  | 'retryable';

// SQLSTATEs (PostgreSQL appendix A).
const CONFLICT_STATES = new Set([
  '23505', // unique_violation
  '23503', // foreign_key_violation: refers to a removed row, or a row is still in use
  '23514', // check_violation: a guard in the schema (e.g. a won deal needs a basis)
  '23P01', // exclusion_violation
  'P0001', // raise_exception from a trigger
]);
const RETRYABLE_STATES = new Set([
  '40001', // serialization_failure
  '40P01', // deadlock_detected
  '55P03', // lock_not_available (lock_timeout)
  '57014', // query_canceled (statement_timeout)
  '25P03', // idle_in_transaction_session_timeout
  '53300', // too_many_connections
  '57P01', // admin_shutdown
  '57P03', // cannot_connect_now
]);
// Prisma's own codes (https://www.prisma.io/docs/orm/reference/error-reference).
const CONFLICT_CODES = new Set(['P2002', 'P2003', 'P2004']);
const RETRYABLE_CODES = new Set([
  'P1001', // can't reach the database server
  'P1002', // the server timed out
  'P1008', // operation timed out
  'P1017', // the server closed the connection
  'P2024', // timed out fetching a connection from the pool
  'P2028', // transaction API error: the interactive transaction expired or could not start
  'P2034', // write conflict or deadlock, please retry
]);

const POOL_TIMEOUT_MESSAGE = 'timeout exceeded when trying to connect';

/** Sorts a database error into what the client can do about it; undefined for anything else. */
export function classifyDbError(err: unknown): DbErrorKind | undefined {
  if (err instanceof Prisma.PrismaClientInitializationError) return 'retryable';
  // pg-pool's own error when every connection stays busy for connectionTimeoutMillis. A model
  // query outside a transaction gets it unwrapped (a transaction gets P2028 instead).
  if (err instanceof Error && err.message === POOL_TIMEOUT_MESSAGE) return 'retryable';
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    const state = sqlState(err);
    if (state) {
      if (CONFLICT_STATES.has(state)) return 'conflict';
      if (RETRYABLE_STATES.has(state) || state.startsWith('08')) return 'retryable';
    }
    if (err.code === 'P2025') return 'not_found';
    if (CONFLICT_CODES.has(err.code)) return 'conflict';
    if (RETRYABLE_CODES.has(err.code)) return 'retryable';
  }
  return undefined;
}

/** Seconds a client should wait before repeating a request that failed as 'retryable'. */
export const RETRY_AFTER_SECONDS = 2;

/**
 * The safe answer for a database error, or null if it is a bug (left to the 500 path). Never
 * includes the database message: constraint and column names stay in the server log.
 */
export function dbErrorToAppError(err: unknown): AppError | null {
  switch (classifyDbError(err)) {
    case 'conflict':
      return new AppError(
        409,
        'CONFLICT',
        'This could not be saved because the data changed meanwhile. Refresh and try again.',
      );
    case 'not_found':
      return new AppError(404, 'NOT_FOUND', 'We could not find that record.');
    case 'retryable':
      return new AppError(
        503,
        'SERVICE_UNAVAILABLE',
        'The system is busy right now. Please try again in a moment.',
      );
    default:
      return null;
  }
}
