import type { ErrorRequestHandler, RequestHandler } from 'express';
import type { ApiErrorBody } from '@clientflow/contracts';
import { ZodError } from 'zod';
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
  const appError = toAppError(err);
  if (!appError) {
    req.log?.error({ err, requestId: req.requestId }, 'Unhandled error');
  }
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
