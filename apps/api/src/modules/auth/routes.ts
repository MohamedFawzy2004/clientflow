import { type RequestHandler, Router } from 'express';
import { loginRequestSchema, type LoginResponse, type SessionUser } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, csrfInvalid } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/normalize.js';
import { getDummyHash, verifyPassword } from '../../lib/password.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requireAuth } from '../../middleware/auth.js';
import {
  cookieSettings,
  createSession,
  issuePreSessionCsrf,
  preCsrfCookieOptions,
  revokeSession,
  sessionCookieOptions,
  sessionCsrfToken,
  verifyPreSessionCsrf,
  verifySessionCsrf,
} from './session.js';
import type { AuthContext } from '../../types/express.js';

const INVALID_CREDENTIALS = () =>
  new AppError(401, 'UNAUTHENTICATED', 'Email or password is incorrect.');

function toSessionUser(auth: AuthContext): SessionUser {
  return {
    id: auth.user.id,
    name: auth.user.name,
    email: auth.user.emailNorm,
    role: auth.user.role,
    agency: auth.agency,
  };
}

export function authRouter(
  deps: AppDeps,
  limiters: { loginPerIp: RequestHandler; loginFailuresPerEmail: RequestHandler },
) {
  const { db, config } = deps;
  const cookies = cookieSettings(config.isProduction);
  const router = Router();

  // Returns a CSRF token: session-bound when signed in, otherwise a pre-session token for login.
  router.get('/csrf', (req, res) => {
    if (req.auth) {
      res.json({
        data: { csrfToken: sessionCsrfToken(config.csrfSecret, req.auth.sessionTokenHash) },
        meta: { requestId: req.requestId },
      });
      return;
    }
    const token = issuePreSessionCsrf(config.csrfSecret);
    res.cookie(cookies.preCsrfName, token, preCsrfCookieOptions(cookies));
    res.json({ data: { csrfToken: token }, meta: { requestId: req.requestId } });
  });

  router.post('/login', limiters.loginPerIp, limiters.loginFailuresPerEmail, async (req, res, next) => {
    try {
      // Signed-out browsers use the pre-session token. A signed-in browser that logs in again
      // (session rotation) may present its session-bound token instead.
      const preCookie = req.cookies?.[cookies.preCsrfName] as string | undefined;
      const header = req.get('x-csrf-token');
      const csrfOk =
        verifyPreSessionCsrf(config.csrfSecret, preCookie, header) ||
        (req.auth !== undefined &&
          header !== undefined &&
          verifySessionCsrf(config.csrfSecret, req.auth.sessionTokenHash, header));
      if (!csrfOk) throw csrfInvalid();
      const input = parseOrThrow(loginRequestSchema, req.body);
      const emailNorm = normalizeEmail(input.email);

      // Single agency in v1 (spec §0.2), so the email identifies the account.
      const user = await db.user.findFirst({
        where: { emailNorm },
        include: { agency: true },
      });
      const passwordOk = user
        ? await verifyPassword(user.passwordHash, input.password)
        : await verifyPassword(await getDummyHash(), input.password).then(() => false);

      if (!user || !passwordOk || !user.active) {
        await writeAudit(db, {
          agencyId: user?.agencyId ?? null,
          actorId: null,
          action: 'auth.login',
          outcome: 'FAILURE',
          requestId: req.requestId,
          metadata: { reason: user && !user.active ? 'inactive' : 'invalid_credentials' },
        });
        throw INVALID_CREDENTIALS();
      }

      // Rotation: an existing session on this browser is revoked before a new one is issued.
      if (req.auth) await revokeSession(db, req.auth.sessionId);

      const { token, tokenHash } = await createSession(db, user.id);
      await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
      await writeAudit(db, {
        agencyId: user.agencyId,
        actorId: user.id,
        action: 'auth.login',
        outcome: 'SUCCESS',
        requestId: req.requestId,
      });

      res.clearCookie(cookies.preCsrfName, { path: '/', secure: cookies.secure });
      res.cookie(cookies.sessionName, token, sessionCookieOptions(cookies));
      const body: LoginResponse = {
        user: {
          id: user.id,
          name: user.name,
          email: user.emailNorm,
          role: user.role,
          agency: {
            id: user.agency.id,
            name: user.agency.name,
            defaultCurrency: user.agency.defaultCurrency,
            timezone: user.agency.timezone,
          },
        },
        csrfToken: sessionCsrfToken(config.csrfSecret, tokenHash),
      };
      res.json({ data: body, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/logout', requireAuth, async (req, res, next) => {
    try {
      const auth = req.auth!;
      await revokeSession(db, auth.sessionId);
      await writeAudit(db, {
        agencyId: auth.user.agencyId,
        actorId: auth.user.id,
        action: 'auth.logout',
        outcome: 'SUCCESS',
        requestId: req.requestId,
      });
      res.clearCookie(cookies.sessionName, { path: '/', secure: cookies.secure });
      res.json({ data: { signedOut: true }, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', requireAuth, (req, res) => {
    res.json({ data: toSessionUser(req.auth!), meta: { requestId: req.requestId } });
  });

  return router;
}
