import type { CookieOptions } from 'express';
import type { Db } from '../../db/client.js';
import { generateToken, hmacBase64Url, safeEqual, sha256Hex } from '../../lib/tokens.js';
import type { AuthContext } from '../../types/express.js';

export const SESSION_ABSOLUTE_MS = 7 * 24 * 60 * 60 * 1000;
export const SESSION_IDLE_MS = 12 * 60 * 60 * 1000;
const TOUCH_INTERVAL_MS = 5 * 60 * 1000;
const PRE_SESSION_CSRF_MAX_AGE_MS = 2 * 60 * 60 * 1000;

export interface CookieSettings {
  sessionName: string;
  preCsrfName: string;
  secure: boolean;
}

/** `__Host-` prefix in production pins the cookie to this origin, HTTPS and path / (SEC-05). */
export function cookieSettings(isProduction: boolean): CookieSettings {
  return {
    sessionName: isProduction ? '__Host-cf_session' : 'cf_session',
    preCsrfName: isProduction ? '__Host-cf_csrf_pre' : 'cf_csrf_pre',
    secure: isProduction,
  };
}

export function sessionCookieOptions(settings: CookieSettings): CookieOptions {
  return {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_ABSOLUTE_MS,
  };
}

export function preCsrfCookieOptions(settings: CookieSettings): CookieOptions {
  return {
    httpOnly: true,
    secure: settings.secure,
    sameSite: 'strict',
    path: '/',
    maxAge: PRE_SESSION_CSRF_MAX_AGE_MS,
  };
}

export async function createSession(db: Db, userId: string, now = new Date()) {
  const token = generateToken(32);
  const tokenHash = sha256Hex(token);
  const session = await db.session.create({
    data: {
      userId,
      tokenHash,
      expiresAt: new Date(now.getTime() + SESSION_ABSOLUTE_MS),
      lastSeenAt: now,
    },
  });
  return { token, tokenHash, session };
}

/**
 * Resolves a raw cookie token to an active session. Expired, idle, revoked or deactivated-user
 * sessions return null and are revoked so they can never be used again.
 */
export async function resolveSession(
  db: Db,
  rawToken: string,
  now = new Date(),
): Promise<AuthContext | null> {
  if (!/^[A-Za-z0-9_-]{40,64}$/.test(rawToken)) return null;
  const tokenHash = sha256Hex(rawToken);
  const session = await db.session.findUnique({
    where: { tokenHash },
    include: { user: { include: { agency: true, clientOrg: true } } },
  });
  if (!session || session.revokedAt) return null;

  const idleExpired = now.getTime() - session.lastSeenAt.getTime() > SESSION_IDLE_MS;
  // A portal user whose organization was archived loses access like a deactivated user.
  const orgClosed = Boolean(session.user.clientOrg?.archivedAt);
  if (session.expiresAt <= now || idleExpired || !session.user.active || orgClosed) {
    await db.session.update({ where: { id: session.id }, data: { revokedAt: now } });
    return null;
  }

  if (now.getTime() - session.lastSeenAt.getTime() > TOUCH_INTERVAL_MS) {
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: now } });
  }

  const { user } = session;
  return {
    sessionId: session.id,
    sessionTokenHash: tokenHash,
    user: {
      id: user.id,
      agencyId: user.agencyId,
      name: user.name,
      emailNorm: user.emailNorm,
      role: user.role,
      clientOrgId: user.clientOrgId,
    },
    agency: {
      id: user.agency.id,
      name: user.agency.name,
      defaultCurrency: user.agency.defaultCurrency,
      timezone: user.agency.timezone,
      isDemo: user.agency.isDemo,
    },
    clientOrg: user.clientOrg ? { id: user.clientOrg.id, name: user.clientOrg.name } : null,
  };
}

export async function revokeSession(db: Db, sessionId: string, now = new Date()) {
  await db.session.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: now },
  });
}

// ---------------------------------------------------------------------------
// CSRF tokens (ADR-004)
// ---------------------------------------------------------------------------

/** Session-bound token: an HMAC of the session's token hash. It is never stored. */
export function sessionCsrfToken(secret: string, sessionTokenHash: string): string {
  return hmacBase64Url(secret, `session:${sessionTokenHash}`);
}

export function verifySessionCsrf(secret: string, sessionTokenHash: string, provided: string) {
  return safeEqual(sessionCsrfToken(secret, sessionTokenHash), provided);
}

/** Pre-session (login) token: nonce + HMAC, sent both as a cookie and a header. */
export function issuePreSessionCsrf(secret: string): string {
  const nonce = generateToken(16);
  return `${nonce}.${hmacBase64Url(secret, `pre:${nonce}`)}`;
}

export function verifyPreSessionCsrf(
  secret: string,
  cookieValue: string | undefined,
  headerValue: string | undefined,
): boolean {
  if (!cookieValue || !headerValue || !safeEqual(cookieValue, headerValue)) return false;
  const [nonce, mac, ...rest] = cookieValue.split('.');
  if (!nonce || !mac || rest.length > 0) return false;
  return safeEqual(hmacBase64Url(secret, `pre:${nonce}`), mac);
}
