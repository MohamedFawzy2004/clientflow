// Short-lived download links (SEC-13, US-20). A link names one file and one user and expires
// after five minutes. Using it still needs that user's session, and access is checked again.
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DOWNLOAD_LINK_TTL_MS = 5 * 60_000;

interface LinkPayload {
  /** File ID. */
  f: string;
  /** User the link was made for. */
  u: string;
  /** Expiry, epoch milliseconds. */
  e: number;
}

/** A key of its own, derived from the app secret, so these MACs never double as CSRF tokens. */
function linkKey(secret: string) {
  return createHmac('sha256', secret).update('clientflow:file-download-link:v1').digest();
}

function mac(secret: string, payload: string) {
  return createHmac('sha256', linkKey(secret)).update(payload).digest('base64url');
}

export function signDownloadLink(secret: string, fileId: string, userId: string, now = Date.now()) {
  const expiresAt = now + DOWNLOAD_LINK_TTL_MS;
  const payload = Buffer.from(JSON.stringify({ f: fileId, u: userId, e: expiresAt })).toString(
    'base64url',
  );
  return { token: `${payload}.${mac(secret, payload)}`, expiresAt: new Date(expiresAt) };
}

/** The payload of a valid, unexpired token, else null (all failures look the same). */
export function verifyDownloadLink(secret: string, token: string, now = Date.now()) {
  const [payload, sig, extra] = token.split('.');
  if (!payload || !sig || extra !== undefined || token.length > 512) return null;
  const expected = Buffer.from(mac(secret, payload));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !timingSafeEqual(expected, given)) return null;
  try {
    const p = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as LinkPayload;
    if (typeof p.f !== 'string' || typeof p.u !== 'string' || typeof p.e !== 'number') return null;
    if (p.e <= now) return null;
    return { fileId: p.f, userId: p.u };
  } catch {
    return null;
  }
}
