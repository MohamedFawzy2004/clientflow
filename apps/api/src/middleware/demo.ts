// Public demo protection (ADR-071). On a demo deployment (DEMO_MODE=true) anyone on the internet
// can sign in, so the actions that would lock the next visitor out, mint accounts, or bring in
// content nobody has checked are refused on the server, whatever the UI shows.
import type { RequestHandler } from 'express';
import { ipKeyGenerator, rateLimit } from 'express-rate-limit';
import type { ApiErrorBody } from '@clientflow/contracts';

interface Rule {
  method: 'POST' | 'PATCH' | 'PUT' | 'DELETE';
  path: RegExp;
}

const ID = '[^/]+';

/** Paths are relative to /api/v1. Anything not listed works as usual in the demo. */
export const DEMO_RESTRICTED_ROUTES: readonly Rule[] = [
  // Passwords and two-step sign-in: a visitor could otherwise lock a shared demo person out.
  { method: 'POST', path: /^\/auth\/password-reset\/(request|confirm)$/ },
  { method: 'POST', path: /^\/auth\/mfa\/(setup|enable|recovery-codes|disable)$/ },
  // People: role changes, deactivation and session or two-step resets.
  { method: 'PATCH', path: new RegExp(`^/users/${ID}$`) },
  {
    method: 'POST',
    path: new RegExp(`^/users/${ID}/(deactivate|reactivate|revoke-sessions|mfa-reset)$`),
  },
  // Invitations return an accept link, so they would let visitors create accounts.
  { method: 'POST', path: /^\/invitations$/ },
  { method: 'POST', path: /^\/invitations\/(preview|accept)$/ },
  { method: 'POST', path: new RegExp(`^/invitations/${ID}/(revoke|resend)$`) },
  { method: 'POST', path: new RegExp(`^/client-orgs/${ID}/invitations(/${ID}/revoke)?$`) },
  // Client portal people: deactivating one would remove the Client journey for later visitors.
  { method: 'POST', path: new RegExp(`^/client-orgs/${ID}/users/${ID}/(deactivate|reactivate)$`) },
  // Workspace settings (name, currency, time zone) shape every page of the demo.
  { method: 'PATCH', path: /^\/agency$/ },
  // Files: no unchecked uploads on a public host, and the seeded files stay for the next visitor.
  { method: 'POST', path: new RegExp(`^/projects/${ID}/files$`) },
  { method: 'POST', path: new RegExp(`^/files/${ID}/delete$`) },
  // Bulk CSV imports.
  { method: 'POST', path: /^\/imports(\/preview)?$/ },
];

export const DEMO_RESTRICTED_MESSAGE =
  'This action is turned off in the public demo, so the demo stays the same for every visitor.';

/**
 * Express routes match without regard to letter case and with an optional trailing slash, so
 * `/AGENCY` and `/users/1/deactivate/` reach the same handlers as the listed paths. Compare the
 * same way, or the guard could be stepped around (Strix review of PR #140).
 */
function routeKey(path: string): string {
  const trimmed = path.replace(/\/+$/, '');
  return (trimmed === '' ? '/' : trimmed).toLowerCase();
}

export function isDemoRestricted(method: string, path: string): boolean {
  const key = routeKey(path);
  const verb = method.toUpperCase();
  return DEMO_RESTRICTED_ROUTES.some((r) => r.method === verb && r.path.test(key));
}

/** Refuses the restricted actions with 403 DEMO_RESTRICTED. Mounted only when DEMO_MODE=true. */
export const demoGuard: RequestHandler = (req, res, next) => {
  if (!isDemoRestricted(req.method, req.path)) {
    next();
    return;
  }
  const body: ApiErrorBody = {
    error: {
      code: 'DEMO_RESTRICTED',
      message: DEMO_RESTRICTED_MESSAGE,
      fieldErrors: {},
      requestId: req.requestId,
    },
  };
  res.status(403).json(body);
};

const READS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * A demo-only cap on changes per address (default 120 per 15 minutes), on top of the general API
 * limit: enough to try every journey, too few to flood the shared workspace. In memory, because a
 * demo runs as one instance (ADR-071).
 */
export function demoWriteLimiter(config: { windowMs: number; limit: number }): RequestHandler {
  return rateLimit({
    windowMs: config.windowMs,
    limit: config.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    skip: (req) => READS.has(req.method),
    keyGenerator: (req) => ipKeyGenerator(req.ip ?? 'unknown'),
    handler: (req, res) => {
      const body: ApiErrorBody = {
        error: {
          code: 'RATE_LIMITED',
          message: 'The demo allows a limited number of changes. Please wait a few minutes.',
          fieldErrors: {},
          requestId: req.requestId,
        },
      };
      res.status(429).json(body);
    },
  });
}
