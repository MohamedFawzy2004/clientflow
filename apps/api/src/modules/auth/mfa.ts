// Two-step sign-in with an authenticator app (ADR-069). Secrets are encrypted at rest, recovery
// codes and challenge tokens are stored as SHA-256 hashes, and every change is audited.
import type { Request, Response } from 'express';
import type { MfaRecoveryCodes, MfaSetupStart, MfaVerifyInput, Role } from '@clientflow/contracts';
import type { AppConfig, AppDeps } from '../../app.js';
import type { Db } from '../../db/client.js';
import { writeAudit } from '../../lib/audit.js';
import { AppError, conflict, forbidden, notFound, validationFailed } from '../../lib/errors.js';
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

const wrongCode = () => validationFailed({ code: ['That code is not right. Try the next one.'] });
const wrongPassword = () => validationFailed({ password: ['Your password is not right.'] });

async function checkPassword(db: Db, actor: AuthUser, password: string) {
  const user = await db.user.findUniqueOrThrow({ where: { id: actor.id } });
  if (!(await verifyPassword(user.passwordHash, password))) throw wrongPassword();
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
  const user = await checkPassword(db, auth.user, password);
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

async function confirmEnabled(deps: AppDeps, auth: AuthContext, password: string, code: string) {
  const { db, config } = deps;
  const user = await checkPassword(db, auth.user, password);
  if (!user.mfaEnabledAt || !user.mfaSecretEnc) throw conflict('Two-step sign-in is off.');
  const secret = openSecret(config.mfa.key, user.mfaSecretEnc);
  if (!(await acceptCode(db, user.id, secret, code, user.mfaLastStep))) throw wrongCode();
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
  const user = await confirmEnabled(deps, auth, input.password, input.code);
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
  const user = await confirmEnabled(deps, auth, input.password, input.code);
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
 * Checks the second step. Returns the user to sign in, or throws. Five wrong tries end the
 * challenge; a used recovery code can never be used again.
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

  let ok = false;
  let method: 'totp' | 'recovery_code' = 'totp';
  if ('code' in input) {
    const secret = openSecret(config.mfa.key, user.mfaSecretEnc!);
    ok = await acceptCode(db, user.id, secret, input.code, user.mfaLastStep);
  } else {
    method = 'recovery_code';
    const used = await db.mfaRecoveryCode.updateMany({
      where: {
        userId: user.id,
        codeHash: sha256Hex(normalizeRecoveryCode(input.recoveryCode)),
        usedAt: null,
      },
      data: { usedAt: now },
    });
    ok = used.count === 1;
  }

  if (!ok) {
    const after = await db.mfaChallenge.update({
      where: { id: challenge.id },
      data: { attempts: { increment: 1 } },
    });
    await writeAudit(db, {
      agencyId: user.agencyId,
      actorId: null,
      action: 'auth.mfa_verify',
      outcome: 'FAILURE',
      targetType: 'user',
      targetId: user.id,
      requestId: req.requestId,
      metadata: { method, attempts: after.attempts },
    });
    if (after.attempts >= MFA_MAX_ATTEMPTS) throw challengeExpired();
    throw 'code' in input
      ? wrongCode()
      : validationFailed({ recoveryCode: ['That recovery code is not right or was used before.'] });
  }

  await db.mfaChallenge.update({ where: { id: challenge.id }, data: { usedAt: now } });
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
