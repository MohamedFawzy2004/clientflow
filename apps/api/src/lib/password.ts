import { hash, verify } from '@node-rs/argon2';
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from '@clientflow/contracts';

// `Algorithm` is an ambient const enum, which verbatimModuleSyntax cannot import; 2 = Argon2id.
const ARGON2ID = 2;

// OWASP Password Storage Cheat Sheet minimum for Argon2id: m=19 MiB, t=2, p=1 (ADR-003).
const ARGON2_OPTIONS = {
  algorithm: ARGON2ID,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

// Small denylist of the most common passwords that satisfy the length rule. Not a substitute
// for a breached-password check, which is planned for M2.
const COMMON_PASSWORDS = new Set([
  'password1234',
  'password12345',
  'password123456',
  '123456789012',
  '1234567890123',
  'qwertyuiop12',
  'qwerty123456',
  'iloveyou1234',
  'admin1234567',
  'administrator',
  'letmein12345',
  'welcome12345',
  'passw0rd1234',
  'changeme1234',
  'abcdefghijkl',
  'aaaaaaaaaaaa',
  '111111111111',
  'clientflow123',
  'clientflow1234',
]);

export type PasswordProblem = 'too_short' | 'too_long' | 'too_common';

export function checkPasswordPolicy(password: string): PasswordProblem | null {
  if (password.length < PASSWORD_MIN_LENGTH) return 'too_short';
  if (password.length > PASSWORD_MAX_LENGTH) return 'too_long';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'too_common';
  if (new Set(password).size < 4) return 'too_common';
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
