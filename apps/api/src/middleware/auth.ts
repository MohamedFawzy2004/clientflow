import type { RequestHandler } from 'express';
import { canAny, type Permission, type Role } from '@clientflow/contracts';
import type { Db } from '../db/client.js';
import { AppError, csrfInvalid, forbidden, unauthenticated } from '../lib/errors.js';
import {
  type CookieSettings,
  resolveSession,
  verifyPreSessionCsrf,
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

/**
 * CSRF for forms used while signed out (login, invitation acceptance, password reset).
 * Accepts a valid pre-session token (cookie + matching header), or, when the browser already has
 * a session, that session's token.
 */
export function requireFormCsrf(secret: string, cookies: CookieSettings): RequestHandler {
  return (req, _res, next) => {
    const header = req.get('x-csrf-token');
    const preCookie = req.cookies?.[cookies.preCsrfName] as string | undefined;
    const ok =
      verifyPreSessionCsrf(secret, preCookie, header) ||
      (req.auth !== undefined &&
        header !== undefined &&
        verifySessionCsrf(secret, req.auth.sessionTokenHash, header));
    if (!ok) return next(csrfInvalid());
    next();
  };
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.auth) return next(unauthenticated());
  next();
};

/**
 * Capability gate from the declarative matrix (packages/contracts/src/permissions.ts).
 * Passes when the role holds ANY listed permission. Record scope is still checked in services.
 */
export function requirePermission(...permissions: Permission[]): RequestHandler {
  return (req, _res, next) => {
    if (!req.auth) return next(unauthenticated());
    if (!canAny(req.auth.user.role, permissions)) return next(forbidden());
    next();
  };
}

/** What a person whose role needs two-step sign-in may do before setting it up (ADR-069). */
const MFA_SETUP_ALLOWED = new Set([
  'GET /auth/me',
  'GET /auth/csrf',
  'POST /auth/logout',
  'POST /auth/mfa/setup',
  'POST /auth/mfa/enable',
]);

/**
 * Until a required role has two-step sign-in on, every other API call answers 403
 * MFA_SETUP_REQUIRED. Enforced here, on the server, not only by the screens.
 */
export function requireMfaSetup(requiredRoles: readonly Role[]): RequestHandler {
  return (req, _res, next) => {
    const auth = req.auth;
    if (!auth || auth.mfaEnabled || !requiredRoles.includes(auth.user.role)) return next();
    if (MFA_SETUP_ALLOWED.has(`${req.method} ${req.path}`)) return next();
    next(
      new AppError(
        403,
        'MFA_SETUP_REQUIRED',
        'Turn on two-step sign-in to continue. Your role requires it.',
      ),
    );
  };
}
