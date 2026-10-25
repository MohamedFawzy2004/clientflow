import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { ApiErrorBody } from '@clientflow/contracts';
import { normalizeEmail } from '../lib/normalize.js';
import { sha256Hex } from '../lib/tokens.js';

export interface RateLimitConfig {
  windowMs: number;
  loginPerIp: number;
  loginFailuresPerEmail: number;
  /** Invitation preview/accept and password reset endpoints. */
  tokenPerIp: number;
  resetRequestsPerEmail: number;
  apiPerIp: number;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  windowMs: 15 * 60 * 1000,
  loginPerIp: 30,
  loginFailuresPerEmail: 5,
  tokenPerIp: 30,
  resetRequestsPerEmail: 3,
  apiPerIp: 1000,
};

const rateLimited: RequestHandler = (req, res) => {
  const body: ApiErrorBody = {
    error: {
      code: 'RATE_LIMITED',
      message: 'Too many attempts. Please wait a few minutes and try again.',
      fieldErrors: {},
      requestId: req.requestId,
    },
  };
  res.status(429).json(body);
};

const ipKey = (req: Parameters<RequestHandler>[0]) => ipKeyGenerator(req.ip ?? 'unknown');

// In-memory stores: valid for a single API instance only (ADR-007).
export function createRateLimiters(config: RateLimitConfig) {
  const loginPerIp = rateLimit({
    windowMs: config.windowMs,
    limit: config.loginPerIp,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: rateLimited,
  });

  // Counts failed logins per account, so a distributed attack on one email is throttled
  // too (FR-I02). The key is hashed so the store never holds raw email addresses.
  const loginFailuresPerEmail = rateLimit({
    windowMs: config.windowMs,
    limit: config.loginFailuresPerEmail,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skipSuccessfulRequests: true,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
      return `email:${sha256Hex(email)}`;
    },
    handler: rateLimited,
  });

  const tokenPerIp = rateLimit({
    windowMs: config.windowMs,
    limit: config.tokenPerIp,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: rateLimited,
  });

  // Every reset request counts (the response is always 202), so one inbox cannot be flooded.
  const resetRequestsPerEmail = rateLimit({
    windowMs: config.windowMs,
    limit: config.resetRequestsPerEmail,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: (req) => {
      const email = typeof req.body?.email === 'string' ? normalizeEmail(req.body.email) : '';
      return `reset:${sha256Hex(email)}`;
    },
    handler: rateLimited,
  });

  const api = rateLimit({
    windowMs: config.windowMs,
    limit: config.apiPerIp,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    keyGenerator: ipKey,
    handler: rateLimited,
  });

  return { loginPerIp, loginFailuresPerEmail, tokenPerIp, resetRequestsPerEmail, api };
}
