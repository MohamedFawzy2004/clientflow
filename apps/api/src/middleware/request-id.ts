import { randomUUID } from 'node:crypto';
import type { RequestHandler } from 'express';

const SAFE_INCOMING_ID = /^[A-Za-z0-9-]{8,64}$/;

/** Correlation ID for logs, audit rows and error bodies. Returned as X-Request-Id. */
export const requestId: RequestHandler = (req, res, next) => {
  const incoming = req.get('x-request-id');
  req.requestId = incoming && SAFE_INCOMING_ID.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
};
