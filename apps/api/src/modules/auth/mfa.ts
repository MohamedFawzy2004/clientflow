// Two-step sign-in with an authenticator app (ADR-069). Secrets are encrypted at rest, recovery
// codes and challenge tokens are stored as SHA-256 hashes, and every change is audited.
import type { Request, Response } from 'express';
import type { MfaRecoveryCodes, MfaSetupStart, MfaVerifyInput, Role } from '@clientflow/contracts';
import type { AppConfig, AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import type { User } from '../../generated/prisma/client.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict, forbidden, notFound, validationFailed } from '../../lib/errors.js';
import { sendOrReport } from '../../lib/mailer.js';
import { verifyPassword } from '../../lib/password.js';
import { generateToken, sha256Hex } from '../../lib/tokens.js';
import {
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  normalizeRecoveryCode,
  openSecret,
  otpauthUrl,
  sealSecret,
  verifyTotp,
} from '../../lib/totp.js';
import type { AuthContext, AuthUser } from '../../types/express.js';
import { cookieSettings } from './session.js';

export const MFA_CHALLENGE_TTL_MS = 5 * 60 * 1000;
export const MFA_MAX_ATTEMPTS = 5;

export const mfaStatus = (config: AppConfig, role: Role, enabled: boolean) => ({
  enabled,
  required: config.mfa.requiredRoles.includes(role),
});

export const mfaCookieName = (isProduction: boolean) => (isProduction ? '__Host-cf_mfa' : 'cf_mfa');

/**
 * Wrong codes and step-up passwords one account may get within the window, across every
 * challenge and session (security audit F1–F3; NIST SP 800-63B-4 asks for at most 100).
 */
export const MFA_ACCOUNT_MAX_FAILURES = 10;
export const MFA_FAILURE_WINDOW_MS = 15 * 60 * 1000;

const wrongCode = () => validationFailed({ code: ['That code is not right. Try the next one.'] });
const wrongPassword = () => validationFailed({ password: ['Your password is not right.'] });
const accountLocked = () =>
  new AppError(
    429,
    'RATE_LIMITED',
    'Too many wrong codes or passwords for this account. Wait 15 minutes, then try again.',
  );

type BudgetUser = Pick<User, 'id' | 'agencyId' | 'name' | 'emailNorm'>;

/**
 * Takes one check from the account's budget BEFORE a code or password is compared, so parallel
 * requests cannot go past it. Returns the count so far, or null while the budget is spent.
 */
async function reserveCheck(db: Db, userId: string): Promise<number | null> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - MFA_FAILURE_WINDOW_MS);
  const lockUntil = new Date(now.getTime() + MFA_FAILURE_WINDOW_MS);
  const max = MFA_ACCOUNT_MAX_FAILURES;
  const rows = await db.$queryRaw<Array<{ n: number }>>`
    WITH p AS (
      SELECT CAST(${now} AS timestamptz) AS now, CAST(${windowStart} AS timestamptz) AS since,
        CAST(${lockUntil} AS timestamptz) AS lock_until, CAST(${max} AS integer) AS max
    )
    UPDATE users u SET
      mfa_failed_attempts = CASE
        WHEN u.mfa_failure_window_at IS NULL OR u.mfa_failure_window_at <= p.since THEN 1
        ELSE u.mfa_failed_attempts + 1 END,
      mfa_failure_window_at = CASE
        WHEN u.mfa_failure_window_at IS NULL OR u.mfa_failure_window_at <= p.since THEN p.now
        ELSE u.mfa_failure_window_at END,
      mfa_locked_until = CASE
        WHEN u.mfa_failure_window_at > p.since AND u.mfa_failed_attempts + 1 >= p.max
          THEN p.lock_until
        ELSE NULL END
    FROM p
    WHERE u.id = CAST(${userId} AS uuid)
      AND (u.mfa_locked_until IS NULL OR u.mfa_locked_until <= p.now)
      AND (u.mfa_failure_window_at IS NULL OR u.mfa_failure_window_at <= p.since
        OR u.mfa_failed_attempts < p.max)
    RETURNING u.mfa_failed_attempts AS n`;
  return rows[0]?.n ?? null;
}

/**
 * Runs one code or password check against the account budget. A success clears the budget; the
 * failure that spends it is audited and the person is emailed once (someone has the password).
 */
async function guarded(
  deps: AppDeps,
  user: BudgetUser,
  requestId: string,
  check: () => Promise<boolean>,
): Promise<boolean> {
  const { db } = deps;
  const used = await reserveCheck(db, user.id);
  if (used === null) {
    await writeAudit(db, {
      agencyId: user.agencyId,
      action: 'mfa.check_refused',
      outcome: 'DENIED',
      targetType: 'user',
      targetId: user.id,
      requestId,
      metadata: { reason: 'account_locked' },
    });
    throw accountLocked();
  }
  const ok = await check();
  if (ok) {
    await db.user.update({
      where: { id: user.id },
      data: { mfaFailedAttempts: 0, mfaFailureWindowAt: null, mfaLockedUntil: null },
    });
  } else if (used === MFA_ACCOUNT_MAX_FAILURES) {
    await writeAudit(db, {
      agencyId: user.agencyId,
      action: 'mfa.account_locked',
      outcome: 'DENIED',
      targetType: 'user',
      targetId: user.id,
      requestId,
      metadata: { failures: used },
    });
    await sendOrReport(deps.mailer, deps.logger, {
      kind: 'mfa_locked',
      to: user.emailNorm,
      subject: 'Wrong sign-in codes on your ClientFlow account',
      text: [
        `Hi ${user.name},`,
        '',
        `${MFA_ACCOUNT_MAX_FAILURES} wrong two-step codes or passwords were entered for your ClientFlow account,`,
        'so code entry is paused for 15 minutes.',
        '',
        'If this was not you, someone may know your password: reset it now and tell your agency owner.',
      ].join('\n'),
    });
  }
  return ok;
}

async function checkPassword(deps: AppDeps, actor: AuthUser, password: string, requestId: string) {
  const user = await deps.db.user.findUniqueOrThrow({ where: { id: actor.id } });
  const ok = await guarded(deps, user, requestId, () =>
    verifyPassword(user.passwordHash, password),
  );
  if (!ok) throw wrongPassword();
  return user;
}

/** Codes that are valid now and newer than the last one used; records the step on success. */
async function acceptCode(
  db: Db,
  userId: string,
  secret: Buffer,
  code: string,
  lastStep: bigint | null,
) {
  const step = verifyTotp(secret, code, Date.now(), lastStep === null ? null : Number(lastStep));
  if (step === null) return false;
  // The condition makes two concurrent requests with the same code impossible to both pass.
  const updated = await db.user.updateMany({
    where: { id: userId, OR: [{ mfaLastStep: null }, { mfaLastStep: { lt: BigInt(step) } }] },
    data: { mfaLastStep: BigInt(step) },
  });
  return updated.count === 1;
}

async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.$transaction([
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    db.mfaRecoveryCode.createMany({
      data: codes.map((c) => ({ userId, codeHash: sha256Hex(normalizeRecoveryCode(c)) })),
    }),
  ]);
  return codes;
}

/** Step 1 of setup: after the password, a new secret is stored as pending and shown once. */
export async function startSetup(
  deps: AppDeps,
  auth: AuthContext,
  password: string,
  requestId: string,
): Promise<MfaSetupStart> {
  const { db, config } = deps;
  const user = await checkPassword(deps, auth.user, password, requestId);
  if (user.mfaEnabledAt) throw conflict('Two-step sign-in is already on.');
  const secret = generateTotpSecret();
  await db.user.update({
    where: { id: user.id },
    data: { mfaPendingSecretEnc: new Uint8Array(sealSecret(config.mfa.key, secret)) },
  });
  await writeAudit(db, {
    agencyId: user.agencyId,
    actorId: user.id,
    action: 'mfa.setup_started',
    outcome: 'SUCCESS',
    requestId,
  });
  return {
    secret: base32Encode(secret)
      .replace(/(.{4})/g, '$1 ')
      .trim(),
    otpauthUrl: otpauthUrl('ClientFlow', user.emailNorm, secret),
  };
}

/**
 * Step 2: a code from the pending secret turns two-step sign-in on. Every other session of this
 * person ends, since they were signed in without it.
 */
export async function enableMfa(
  deps: AppDeps,
  auth: AuthContext,
  code: string,
  requestId: string,
): Promise<MfaRecoveryCodes> {
  const { db, config } = deps;
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (user.mfaEnabledAt) throw conflict('Two-step sign-in is already on.');
  if (!user.mfaPendingSecretEnc) throw conflict('Start the setup again: no code is waiting.');
  const secret = openSecret(config.mfa.key, user.mfaPendingSecretEnc);
  if (!(await acceptCode(db, user.id, secret, code, user.mfaLastStep))) throw wrongCode();
  await db.$transaction([
    db.user.update({
      where: { id: user.id },
      data: {
        mfaSecretEnc: user.mfaPendingSecretEnc,
        mfaPendingSecretEnc: null,
        mfaEnabledAt: new Date(),
        version: { increment: 1 },
      },
    }),
    db.session.updateMany({
      where: { userId: user.id, revokedAt: null, id: { not: auth.sessionId } },
      data: { revokedAt: new Date() },
    }),
  ]);
  const recoveryCodes = await replaceRecoveryCodes(db, user.id);
  await writeAudit(db, {
    agencyId: user.agencyId,
    actorId: user.id,
    action: 'mfa.enabled',
    outcome: 'SUCCESS',
    requestId,
  });
  return { recoveryCodes };
}

/** Password and a current code, as one check against the account budget (F3). */
async function confirmEnabled(
  deps: AppDeps,
  auth: AuthContext,
  password: string,
  code: string,
  requestId: string,
) {
  const { db, config } = deps;
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.user.id } });
  if (!user.mfaEnabledAt || !user.mfaSecretEnc) throw conflict('Two-step sign-in is off.');
  const secretEnc = user.mfaSecretEnc;
  let failed = wrongCode;
  const ok = await guarded(deps, user, requestId, async () => {
    if (!(await verifyPassword(user.passwordHash, password))) {
      failed = wrongPassword;
      return false;
    }
    return acceptCode(db, user.id, openSecret(config.mfa.key, secretEnc), code, user.mfaLastStep);
  });
  if (!ok) throw failed();
  return user;
}

export async function disableMfa(
  deps: AppDeps,
  auth: AuthContext,
  input: { password: string; code: string },
  requestId: string,
) {
  if (deps.config.mfa.requiredRoles.includes(auth.user.role)) {
    throw forbidden('Your role must use two-step sign-in, so it cannot be turned off.');
  }
  const user = await confirmEnabled(deps, auth, input.password, input.code, requestId);
  await clearMfa(deps.db, user.id);
  await writeAudit(deps.db, {
    agencyId: user.agencyId,
    actorId: user.id,
    action: 'mfa.disabled',
    outcome: 'SUCCESS',
    requestId,
  });
}

export async function regenerateRecoveryCodes(
  deps: AppDeps,
  auth: AuthContext,
  input: { password: string; code: string },
  requestId: string,
): Promise<MfaRecoveryCodes> {
  const user = await confirmEnabled(deps, auth, input.password, input.code, requestId);
  const recoveryCodes = await replaceRecoveryCodes(deps.db, user.id);
  await writeAudit(deps.db, {
    agencyId: user.agencyId,
    actorId: user.id,
    action: 'mfa.recovery_codes_replaced',
    outcome: 'SUCCESS',
    requestId,
  });
  return { recoveryCodes };
}

/** Turns two-step sign-in off and deletes its codes and challenges (resets and the CLI). */
export async function clearMfa(db: Db, userId: string) {
  await db.$transaction([
    db.user.update({
      where: { id: userId },
      data: {
        mfaSecretEnc: null,
        mfaPendingSecretEnc: null,
        mfaEnabledAt: null,
        mfaLastStep: null,
        mfaFailedAttempts: 0,
        mfaFailureWindowAt: null,
        mfaLockedUntil: null,
        version: { increment: 1 },
      },
    }),
    db.mfaRecoveryCode.deleteMany({ where: { userId } }),
    db.mfaChallenge.deleteMany({ where: { userId } }),
  ]);
}

/**
 * An Owner resets another person's two-step sign-in (lost phone and codes). Their sessions end;
 * if their role requires it, they set it up again at the next sign-in.
 */
export async function resetMfaFor(
  deps: AppDeps,
  auth: AuthContext,
  targetId: string,
  requestId: string,
) {
  const { db } = deps;
  if (auth.user.role !== 'OWNER') throw forbidden();
  if (targetId === auth.user.id) {
    throw forbidden('You cannot reset your own two-step sign-in. Use a recovery code instead.');
  }
  const target = await db.user.findFirst({
    where: { id: targetId, agencyId: auth.user.agencyId },
  });
  if (!target) throw notFound();
  await clearMfa(db, target.id);
  await db.session.updateMany({
    where: { userId: target.id, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  await writeAudit(db, {
    agencyId: target.agencyId,
    actorId: auth.user.id,
    action: 'mfa.reset',
    outcome: 'SUCCESS',
    targetType: 'user',
    targetId: target.id,
    requestId,
  });
}

/** After a correct password: a single-use challenge in an HttpOnly cookie. */
export async function issueChallenge(deps: AppDeps, res: Response, userId: string) {
  const { db, config } = deps;
  const token = generateToken(32);
  const now = new Date();
  await db.mfaChallenge.deleteMany({
    where: { userId, OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }] },
  });
  await db.mfaChallenge.create({
    data: {
      userId,
      tokenHash: sha256Hex(token),
      createdAt: now,
      expiresAt: new Date(now.getTime() + MFA_CHALLENGE_TTL_MS),
    },
  });
  const secure = cookieSettings(config.isProduction).secure;
  res.cookie(mfaCookieName(config.isProduction), token, {
    httpOnly: true,
    secure,
    sameSite: 'strict',
    path: '/',
    maxAge: MFA_CHALLENGE_TTL_MS,
  });
}

const challengeExpired = () =>
  new AppError(401, 'TOKEN_INVALID', 'Your sign-in took too long. Enter your password again.');

/**
 * Checks the second step. Returns the user to sign in, or throws. Five tries end the challenge,
 * and every try also counts against the account budget, so new challenges do not give new
 * guesses (F1). Tries are reserved before the code is compared, so parallel requests cannot go
 * past either limit (F2). A used recovery code can never be used again.
 */
export async function verifyChallenge(deps: AppDeps, req: Request, input: MfaVerifyInput) {
  const { db, config } = deps;
  const raw = req.cookies?.[mfaCookieName(config.isProduction)] as string | undefined;
  if (!raw || !/^[A-Za-z0-9_-]{40,64}$/.test(raw)) throw challengeExpired();
  const challenge = await db.mfaChallenge.findUnique({
    where: { tokenHash: sha256Hex(raw) },
    include: { user: { include: { agency: true } } },
  });
  const now = new Date();
  if (
    !challenge ||
    challenge.usedAt ||
    challenge.expiresAt <= now ||
    challenge.attempts >= MFA_MAX_ATTEMPTS ||
    !challenge.user.active ||
    !challenge.user.mfaSecretEnc
  ) {
    throw challengeExpired();
  }
  const { user } = challenge;

  const reserved = await db.$queryRaw<Array<{ attempts: number }>>`
    UPDATE mfa_challenges SET attempts = attempts + 1
    WHERE id = CAST(${challenge.id} AS uuid) AND attempts < CAST(${MFA_MAX_ATTEMPTS} AS integer)
      AND used_at IS NULL AND expires_at > CAST(${now} AS timestamptz)
    RETURNING attempts`;
  const attempts = reserved[0]?.attempts;
  if (attempts === undefined) throw challengeExpired();

  const method: 'totp' | 'recovery_code' = 'code' in input ? 'totp' : 'recovery_code';
  const ok = await guarded(deps, user, req.requestId, async () => {
    if ('code' in input) {
      const secret = openSecret(config.mfa.key, user.mfaSecretEnc!);
      return acceptCode(db, user.id, secret, input.code, user.mfaLastStep);
    }
    const used = await db.mfaRecoveryCode.updateMany({
      where: {
        userId: user.id,
        codeHash: sha256Hex(normalizeRecoveryCode(input.recoveryCode)),
        usedAt: null,
      },
      data: { usedAt: now },
    });
    return used.count === 1;
  });

  if (!ok) {
    await writeAudit(db, {
      agencyId: user.agencyId,
      actorId: null,
      action: 'auth.mfa_verify',
      outcome: 'FAILURE',
      targetType: 'user',
      targetId: user.id,
      requestId: req.requestId,
      metadata: { method, attempts },
    });
    if (attempts >= MFA_MAX_ATTEMPTS) throw challengeExpired();
    throw 'code' in input
      ? wrongCode()
      : validationFailed({ recoveryCode: ['That recovery code is not right or was used before.'] });
  }

  // Single use even if two right answers arrive at once.
  const consumed = await db.mfaChallenge.updateMany({
    where: { id: challenge.id, usedAt: null },
    data: { usedAt: now },
  });
  if (consumed.count !== 1) throw challengeExpired();
  if (method === 'recovery_code') {
    const left = await db.mfaRecoveryCode.count({ where: { userId: user.id, usedAt: null } });
    await writeAudit(db, {
      agencyId: user.agencyId,
      actorId: user.id,
      action: 'mfa.recovery_code_used',
      outcome: 'SUCCESS',
      requestId: req.requestId,
      metadata: { remaining: left },
    });
  }
  return user;
}
