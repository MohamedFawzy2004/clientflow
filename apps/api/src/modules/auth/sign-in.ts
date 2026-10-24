import type { Request, Response } from 'express';
import type { LoginResponse } from '@clientflow/contracts';
import type { AppDeps } from '../../app.js';
import type { Agency, User } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import {
  cookieSettings,
  createSession,
  revokeSession,
  sessionCookieOptions,
  sessionCsrfToken,
} from './session.js';

/**
 * Issues a fresh session for `user` (login and invitation acceptance). Any session this browser
 * already had is revoked first (rotation, FR-I03), and the pre-session CSRF cookie is cleared.
 */
export async function signIn(
  deps: AppDeps,
  req: Request,
  res: Response,
  user: User & { agency: Agency },
  action: 'auth.login' | 'invitation.accept',
): Promise<LoginResponse> {
  const { db, config } = deps;
  const cookies = cookieSettings(config.isProduction);
  if (req.auth) await revokeSession(db, req.auth.sessionId);

  const { token, tokenHash } = await createSession(db, user.id);
  await db.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  if (action === 'auth.login') {
    await writeAudit(db, {
      agencyId: user.agencyId,
      actorId: user.id,
      action,
      outcome: 'SUCCESS',
      requestId: req.requestId,
    });
  }

  res.clearCookie(cookies.preCsrfName, { path: '/', secure: cookies.secure });
  res.cookie(cookies.sessionName, token, sessionCookieOptions(cookies));
  return {
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
}
