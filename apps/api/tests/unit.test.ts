import { describe, expect, it } from 'vitest';
import { contactCreateSchema, contactListQuerySchema } from '@clientflow/contracts';
import { loadEnv } from '../src/config/env.js';
import { normalizeEmail, normalizePhone, slugify } from '../src/lib/normalize.js';
import { checkPasswordPolicy, hashPassword, verifyPassword } from '../src/lib/password.js';
import { generateToken, safeEqual, sha256Hex } from '../src/lib/tokens.js';
import { zodFieldErrors } from '../src/lib/validation.js';
import { contactReadScope } from '../src/modules/contacts/policy.js';
import {
  issuePreSessionCsrf,
  sessionCsrfToken,
  verifyPreSessionCsrf,
  verifySessionCsrf,
} from '../src/modules/auth/session.js';
import type { AuthUser } from '../src/types/express.js';

const SECRET = 'unit-test-secret-unit-test-secret-123';

describe('normalization', () => {
  it('lowercases and trims email without stripping dots or plus aliases', () => {
    expect(normalizeEmail('  John.Doe+Leads@Example.COM ')).toBe('john.doe+leads@example.com');
  });

  it('normalizes phone numbers to digits with an optional leading +', () => {
    expect(normalizePhone('+20 (100) 555-0101')).toBe('+201005550101');
    expect(normalizePhone('0100 555 0101')).toBe('01005550101');
    expect(normalizePhone('123')).toBeNull();
  });

  it('builds URL-safe slugs', () => {
    expect(slugify('  Lumen Digital Studio!  ')).toBe('lumen-digital-studio');
    expect(slugify('***')).toBe('agency');
  });
});

describe('tokens', () => {
  it('generates 256-bit base64url tokens that differ every time', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
  });

  it('hashes tokens as SHA-256 hex', () => {
    expect(sha256Hex('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('compares safely across different lengths', () => {
    expect(safeEqual('abc', 'abc')).toBe(true);
    expect(safeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('CSRF tokens', () => {
  it('binds session tokens to the session hash', () => {
    const token = sessionCsrfToken(SECRET, 'a'.repeat(64));
    expect(verifySessionCsrf(SECRET, 'a'.repeat(64), token)).toBe(true);
    expect(verifySessionCsrf(SECRET, 'b'.repeat(64), token)).toBe(false);
  });

  it('requires matching cookie and header for pre-session tokens', () => {
    const token = issuePreSessionCsrf(SECRET);
    expect(verifyPreSessionCsrf(SECRET, token, token)).toBe(true);
    expect(verifyPreSessionCsrf(SECRET, token, undefined)).toBe(false);
    expect(verifyPreSessionCsrf(SECRET, undefined, token)).toBe(false);
    const forged = `${token.split('.')[0]}.forged`;
    expect(verifyPreSessionCsrf(SECRET, forged, forged)).toBe(false);
    expect(verifyPreSessionCsrf('another-secret-another-secret-12345', token, token)).toBe(false);
  });
});

describe('password policy and hashing', () => {
  it('rejects short, long and common passwords', () => {
    expect(checkPasswordPolicy('short')).toBe('too_short');
    expect(checkPasswordPolicy('x'.repeat(129))).toBe('too_long');
    expect(checkPasswordPolicy('Password1234')).toBe('too_common');
    expect(checkPasswordPolicy('aaaaaaaaaaaaaa')).toBe('too_common');
    expect(checkPasswordPolicy('violet-lantern-meadow-42')).toBeNull();
  });

  it('hashes with Argon2id and verifies', async () => {
    const hash = await hashPassword('violet-lantern-meadow-42');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'violet-lantern-meadow-42')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password-123')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('contact policy', () => {
  const user = (role: AuthUser['role']): AuthUser => ({
    id: 'u1',
    agencyId: 'a1',
    name: 'n',
    emailNorm: 'e@x.test',
    role,
  });

  it('scopes SALES to owned contacts and managers to the agency', () => {
    expect(contactReadScope(user('SALES'))).toEqual({
      agencyId: 'a1',
      archivedAt: null,
      ownerId: 'u1',
    });
    expect(contactReadScope(user('SALES_MANAGER'))).toEqual({ agencyId: 'a1', archivedAt: null });
    expect(contactReadScope(user('OWNER'))).toEqual({ agencyId: 'a1', archivedAt: null });
  });

  it.each(['PM', 'MEMBER', 'FINANCE', 'CLIENT'] as const)('denies %s', (role) => {
    expect(() => contactReadScope(user(role))).toThrow(/access to leads/);
  });
});

describe('contact DTOs', () => {
  it('rejects unknown keys such as ownerId (mass assignment)', () => {
    const result = contactCreateSchema.safeParse({ fullName: 'A', ownerId: 'x', agencyId: 'y' });
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(zodFieldErrors(result.error)).toMatchObject({
        ownerId: ['This field is not allowed.'],
        agencyId: ['This field is not allowed.'],
      });
    }
  });

  it('treats empty optional strings as absent', () => {
    const result = contactCreateSchema.parse({
      fullName: '  Mona  ',
      email: '',
      phone: '',
      notes: '',
    });
    expect(result).toEqual({ fullName: 'Mona' });
  });

  it('validates phone digits and email format', () => {
    const result = contactCreateSchema.safeParse({ fullName: 'A', email: 'nope', phone: '12' });
    expect(result.success).toBe(false);
    if (!result.success) {
      const errors = zodFieldErrors(result.error);
      expect(errors.email).toBeDefined();
      expect(errors.phone).toBeDefined();
    }
  });

  it('bounds page size to 100', () => {
    expect(contactListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
    expect(contactListQuerySchema.parse({})).toEqual({ page: 1, limit: 25 });
  });
});

describe('environment validation', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@127.0.0.1:5433/db',
    APP_ORIGINS: 'http://localhost:5173',
    CSRF_SECRET: 'x'.repeat(40),
  };

  it('accepts a valid configuration', () => {
    expect(loadEnv(base).APP_ORIGINS).toEqual(['http://localhost:5173']);
  });

  it('fails closed on short or placeholder secrets', () => {
    expect(() => loadEnv({ ...base, CSRF_SECRET: 'short' })).toThrow(/CSRF_SECRET/);
    expect(() =>
      loadEnv({ ...base, CSRF_SECRET: 'replace-with-at-least-32-random-characters' }),
    ).toThrow(/placeholder/);
  });

  it('requires https origins in production', () => {
    expect(() => loadEnv({ ...base, NODE_ENV: 'production' })).toThrow(/https/);
  });
});
