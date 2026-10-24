import { hash, verify } from '@node-rs/argon2';
import { ZxcvbnFactory } from '@zxcvbn-ts/core';
import * as zxcvbnCommonPackage from '@zxcvbn-ts/language-common';
import * as zxcvbnEnPackage from '@zxcvbn-ts/language-en';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@clientflow/contracts';

// The language packages are CommonJS with a default export.
const zxcvbnCommon =
  (zxcvbnCommonPackage as unknown as { default: typeof zxcvbnCommonPackage }).default ??
  zxcvbnCommonPackage;
const zxcvbnEn =
  (zxcvbnEnPackage as unknown as { default: typeof zxcvbnEnPackage }).default ?? zxcvbnEnPackage;

// `Algorithm` is an ambient const enum, which verbatimModuleSyntax cannot import; 2 = Argon2id.
const ARGON2ID = 2;

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1 (ADR-003).
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Product-specific words that breach lists do not know about.
const PRODUCT_WORDS = ['clientflow', 'client flow'];

// zxcvbn-ts (MIT) ships ~49k passwords from public breach corpora plus common-pattern matchers.
// It runs fully offline: no password ever leaves the server (SEC-03).
let factory: ZxcvbnFactory | undefined;
function strengthChecker(): ZxcvbnFactory {
  factory ??= new ZxcvbnFactory({
    graphs: zxcvbnCommon.adjacencyGraphs,
    dictionary: { ...zxcvbnCommon.dictionary, ...zxcvbnEn.dictionary },
    translations: zxcvbnEn.translations,
  });
  return factory;
}

/** Minimum zxcvbn score (0–4). 3 = "safely unguessable: moderate protection from offline attack". */
const MIN_SCORE = 3;

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common' | 'contains_personal_info';

export const PASSWORD_PROBLEM_MESSAGES: Record<PasswordProblem, string> = {
  too_short: `Use at least ${PASSWORD_MIN_LENGTH} characters.`,
  too_long: `Use at most ${PASSWORD_MAX_LENGTH} characters.`,
  too_common:
    'This password is too common or easy to guess. Try a longer phrase of unrelated words.',
  contains_personal_info: 'Do not use your name or email address in your password.',
};

/**
 * Policy for every new password (bootstrap, invite acceptance, reset). Login only checks length,
 * so a policy change never locks existing users out.
 */
export function checkPasswordPolicy(
  password: string,
  personal: { email?: string; name?: string } = {},
): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';

  const lower = password.toLowerCase();
  const personalParts = [personal.email?.split('@')[0], ...(personal.name?.split(/\s+/) ?? [])]
    .map((p) => p?.toLowerCase().trim())
    .filter((p): p is string => Boolean(p && p.length >= 4));
  if (personalParts.some((p) => lower.includes(p))) return 'contains_personal_info';

  if (PRODUCT_WORDS.some((w) => lower.includes(w))) return 'too_common';
  const result = strengthChecker().check(password, personalParts);
  if (result.score < MIN_SCORE) return 'too_common';
  return null;
}

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTIONS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

let dummyHash: Promise<string> | undefined;

/** Hash used when the account does not exist, so response timing does not reveal emails. */
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword('dummy-password-for-timing-equalisation');
  return dummyHash;
}
