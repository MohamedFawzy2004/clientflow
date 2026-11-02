import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@clientflow/contracts';
import { ZodError } from 'zod';
import {
  classifyDbError,
  dbErrorToAppError,
  RETRY_AFTER_SECONDS,
  sqlState,
} from '../lib/db-errors.js';
import { AppError, notFound } from '../lib/errors.js';
import { zodFieldErrors } from '../lib/validation.js';

export const notFoundHandler: RequestHandler = (_req, _res, next) => next(notFound());

interface BodyParserError extends Error {
  type?: string;
  status?: number;
}

function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    return new AppError(
      422,
      'VALIDATION_FAILED',
      'Some fields need your attention.',
      zodFieldErrors(err),
    );
  }
  const bp = err as BodyParserError;
  if (bp?.type === 'entity.too.large') {
    return new AppError(413, 'PAYLOAD_TOO_LARGE', 'The request is too large.');
  }
  if (bp?.type === 'entity.parse.failed' || bp?.type === 'encoding.unsupported') {
    return new AppError(400, 'MALFORMED_REQUEST', 'The request body could not be read.');
  }
  return null;
}

/** Typed error envelope (spec §10.1). Never leaks stack traces or internal messages (US-21). */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const known = toAppError(err);
  const dbError = known ? null : dbErrorToAppError(err);
  const appError = known ?? dbError;
  if (dbError) {
    // Expected under load or races, but worth seeing: which code, and where.
    const e = err as { code?: string };
    req.log?.warn(
      {
        requestId: req.requestId,
        kind: classifyDbError(err),
        code: e.code,
        sqlState: sqlState(err),
      },
      'Database error answered as %d',
      dbError.status,
    );
  } else if (!appError) {
    req.log?.error({ err, requestId: req.requestId }, 'Unhandled error');
  }
  if (appError?.status === 503) res.setHeader('Retry-After', String(RETRY_AFTER_SECONDS));
  const safe =
    appError ??
    new AppError(500, 'INTERNAL_ERROR', 'Something went wrong on our side. Please try again.');
  const body: ApiErrorBody = {
    error: {
      code: safe.code,
      message: safe.message,
      fieldErrors: safe.fieldErrors,
      requestId: req.requestId,
    },
  };
  res.status(safe.status).json(body);
};
