import { type RequestHandler, Router } from 'express';
import {
  loginRequestSchema,
  passwordResetConfirmSchema,
  passwordResetRequestSchema,
  type SessionUser,
} from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError } from '../../lib/errors.js';
import { normalizeEmail } from '../../lib/normalize.js';
import { getDummyHash, verifyPassword } from '../../lib/password.js';
import { parseOrThrow } from '../../lib/validation.js';
import { requireAuth, requireFormCsrf } from '../../middleware/auth.js';
import { confirmReset, processResetRequest } from './password-reset.js';
import {
  cookieSettings,
  issuePreSessionCsrf,
  preCsrfCookieOptions,
  revokeSession,
  sessionCsrfToken,
} from './session.js';
import { signIn } from './sign-in.js';
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
    clientOrg: auth.clientOrg,
  };
}

export interface AuthLimiters {
  loginPerIp: RequestHandler;
  loginFailuresPerEmail: RequestHandler;
  tokenPerIp: RequestHandler;
  resetRequestsPerEmail: RequestHandler;
}

export function authRouter(deps: AppDeps, limiters: AuthLimiters) {
  const { db, config, logger } = deps;
  const cookies = cookieSettings(config.isProduction);
  const formCsrf = requireFormCsrf(config.csrfSecret, cookies);
  const router = Router();

  // Returns a CSRF token: session-bound when signed in, otherwise a pre-session token for forms.
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

  router.post(
    '/login',
    limiters.loginPerIp,
    limiters.loginFailuresPerEmail,
    formCsrf,
    async (req, res, next) => {
      try {
        const input = parseOrThrow(loginRequestSchema, req.body);
        const emailNorm = normalizeEmail(input.email);

        // Single agency in v1 (spec §0.2), so the email identifies the account.
        const user = await db.user.findFirst({ where: { emailNorm }, include: { agency: true } });
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

        const body = await signIn(deps, req, res, user, 'auth.login');
        res.json({ data: body, meta: { requestId: req.requestId } });
      } catch (err) {
        next(err);
      }
    },
  );

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

  // Always the same 202, whether or not the account exists (no enumeration). The work runs after
  // the response is sent, so timing does not reveal it either.
  router.post(
    '/password-reset/request',
    limiters.tokenPerIp,
    limiters.resetRequestsPerEmail,
    formCsrf,
    (req, res, next) => {
      try {
        const { email } = parseOrThrow(passwordResetRequestSchema, req.body);
        res.status(202).json({
          data: { message: 'If an active account uses that email, a reset link is on its way.' },
          meta: { requestId: req.requestId },
        });
        const work = processResetRequest(deps, email, req.requestId).catch((err: unknown) =>
          logger.error({ err, requestId: req.requestId }, 'Password reset request failed'),
        );
        deps.background?.(work);
      } catch (err) {
        next(err);
      }
    },
  );

  router.post('/password-reset/confirm', limiters.tokenPerIp, formCsrf, async (req, res, next) => {
    try {
      const input = parseOrThrow(passwordResetConfirmSchema, req.body);
      await confirmReset(deps, input, req.requestId);
      res.json({ data: { passwordReset: true }, meta: { requestId: req.requestId } });
    } catch (err) {
      next(err);
    }
  });

  return router;
}
