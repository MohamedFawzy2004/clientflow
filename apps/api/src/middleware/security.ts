import type { RequestHandler } from 'express';
import helmet from 'helmet';
import { AppError } from '../lib/errors.js';

/**
 * Security headers (SEC-09). The API only serves JSON, so its CSP forbids everything. The built
 * web app (served by the same process in production) gets a strict same-origin policy: no inline
 * scripts, no third-party hosts. Inline style attributes stay allowed for component libraries.
 */
export function securityHeaders(
  isProduction: boolean,
  kind: 'api' | 'web' = 'api',
): RequestHandler {
  const directives: Record<string, string[]> =
    kind === 'api'
      ? { defaultSrc: ["'none'"], frameAncestors: ["'none'"], baseUri: ["'none'"] }
      : {
          defaultSrc: ["'self'"],
          scriptSrc: ["'self'"],
          styleSrc: ["'self'", "'unsafe-inline'"],
          imgSrc: ["'self'", 'data:'],
          fontSrc: ["'self'"],
          connectSrc: ["'self'"],
          objectSrc: ["'none'"],
          frameAncestors: ["'none'"],
          baseUri: ["'none'"],
          formAction: ["'self'"],
        };
  return helmet({
    contentSecurityPolicy: { useDefaults: false, directives },
    crossOriginResourcePolicy: { policy: 'same-origin' },
    referrerPolicy: { policy: 'no-referrer' },
    // HSTS only after HTTPS is verified in production (SEC-08).
    strictTransportSecurity: isProduction ? { maxAge: 15_552_000, includeSubDomains: true } : false,
  });
}

/** Authenticated API responses must never be cached by browsers or proxies. */
export const noStore: RequestHandler = (_req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Pragma', 'no-cache');
  next();
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * State-changing requests must come from an allowlisted browser origin (ADR-004).
 * Falls back to Referer when Origin is absent. Rejects when both are absent.
 */
export function originCheck(allowedOrigins: string[]): RequestHandler {
  const allowed = new Set(allowedOrigins);
  return (req, _res, next) => {
    if (SAFE_METHODS.has(req.method)) return next();
    let origin = req.get('origin');
    if (!origin) {
      const referer = req.get('referer');
      if (referer) {
        try {
          origin = new URL(referer).origin;
        } catch {
          origin = undefined;
        }
      }
    }
    if (!origin || !allowed.has(origin)) {
      return next(
        new AppError(403, 'FORBIDDEN', 'This request was blocked because of its origin.'),
      );
    }
    next();
  };
}

export function isSafeMethod(method: string): boolean {
  return SAFE_METHODS.has(method);
}
