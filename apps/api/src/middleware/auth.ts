import type { RequestHandler } from 'express';
import type { Role } from '@clientflow/contracts';
import type { Db } from '../db/client.js';
import { csrfInvalid, forbidden, unauthenticated } from '../lib/errors.js';
import {
  type CookieSettings,
  resolveSession,
  verifySessionCsrf,
} from '../modules/auth/session.js';
import { isSafeMethod } from './security.js';

/** Attaches req.auth when a valid session cookie is present. Never rejects by itself. */
export function loadSession(db: Db, cookies: CookieSettings): RequestHandler {
  return async (req, res, next) => {
    try {
      const raw = req.cookies?.[cookies.sessionName] as string | undefined;
      if (raw) {
        const auth = await resolveSession(db, raw);
        if (auth) req.auth = auth;
        else res.clearCookie(cookies.sessionName, { path: '/', secure: cookies.secure });
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

/**
 * Session-bound CSRF check for state-changing requests by signed-in users (SEC-06).
 * Requests without a session cannot change state, and requireAuth answers them with 401.
 * Login has its own pre-session check in the auth routes.
 */
export function csrfProtection(secret: string): RequestHandler {
  return (req, _res, next) => {
    if (isSafeMethod(req.method) || !req.auth) return next();
    const provided = req.get('x-csrf-token');
    if (!provided || !verifySessionCsrf(secret, req.auth.sessionTokenHash, provided)) {
      return next(csrfInvalid());
    }
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  next();
};

export function requireRole(...roles: Role[]): RequestHandler {
  const allowed = new Set<Role>(roles);
  return (req, _res, next) => {
    if (!req.auth) return next(unauthenticated());
    if (!allowed.has(req.auth.user.role)) return next(forbidden());
    next();
  };
}
