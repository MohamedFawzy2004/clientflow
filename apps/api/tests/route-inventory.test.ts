// QA release suite: every API route registered in app.ts must be in the permission matrix
// (permission-matrix.test.ts), or be listed below as public with a reason. The security audit
// (F13) found 7 routes missing from the matrix by reading the code; this makes the next one fail
// CI instead. Static: it reads the source, so it needs no database.
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const SRC = fileURLToPath(new URL('../src/', import.meta.url));
const MATRIX = fileURLToPath(new URL('./permission-matrix.test.ts', import.meta.url));

/**
 * Routes that are reachable without a session or only with a one-time token, by design, and
 * own-account routes that need fresh proof (a role cannot make them succeed in the matrix).
 * Each names the tests that cover it.
 */
const OUTSIDE_MATRIX: Record<string, string> = {
  'POST /auth/mfa/enable': 'own account, needs a fresh code (mfa.test.ts, incl. 401 signed out)',
  'POST /auth/mfa/recovery-codes': 'own account, password + code (mfa.test.ts QA block)',
  'POST /auth/mfa/disable': 'own account, password + code (mfa.test.ts)',
  'GET /auth/csrf': 'pre-session CSRF token (auth.test.ts)',
  'POST /auth/login': 'sign-in (auth.test.ts, hardening.test.ts)',
  'POST /auth/mfa/verify': 'second sign-in step, challenge-bound (mfa.test.ts)',
  'POST /auth/logout': 'ends the caller’s own session (auth.test.ts)',
  'POST /auth/password-reset/request': 'public, enumeration-safe (password-reset.test.ts)',
  'POST /auth/password-reset/confirm': 'one-time token (password-reset.test.ts)',
  'POST /invitations/preview': 'one-time token (invitations.test.ts)',
  'POST /invitations/accept': 'one-time token (invitations.test.ts)',
  'GET /files/download/:p': 'short-lived token bound to one user (delivery-portal.test.ts)',
  // Mounted only when DEMO_MODE=true (the matrix app is not a demo), so they are 404s there.
  'GET /demo/accounts': 'public demo only: role + name of isDemo people (demo-hosting.test.ts)',
  'POST /demo/sessions': 'public demo only: sign-in as a demo role (demo-hosting.test.ts)',
};

const norm = (route: string) =>
  route
    .replace(/\s+\(.*\)$/, '') // matrix names may add a case, e.g. "(own)"
    .replace(/:\w+/g, ':p')
    .replace(/(.)\/$/, '$1');

function registeredRoutes() {
  const app = readFileSync(join(SRC, 'app.ts'), 'utf8');
  const files = Object.fromEntries(
    [...app.matchAll(/import \{ (\w+Router) \} from '(\.\/modules\/[^']+)\.js'/g)].map((m) => [
      m[1],
      resolve(SRC, `${m[2]}.ts`),
    ]),
  );
  const mounts = [
    ...app.matchAll(/api\.use\(\s*(?:'([^']+)',\s*)?(?:requireAuth,\s*)?(\w+Router)\(/g),
  ].map((m) => ({ prefix: m[1] ?? '', factory: m[2]! }));
  const routes: string[] = [];
  const unreadable: string[] = [];
  for (const { prefix, factory } of mounts) {
    const file = files[factory];
    if (!file) {
      unreadable.push(`${factory}: import not found in app.ts`);
      continue;
    }
    const src = readFileSync(file, 'utf8');
    const calls = [...src.matchAll(/\brouter\.(get|post|put|patch|delete)\(\s*([^,\s]+)/g)];
    for (const call of calls) {
      const [, method, pathArg] = call;
      const add = (path: string) => routes.push(`${method!.toUpperCase()} ${prefix}${path}`);
      const literal = /^'([^']+)'$/.exec(pathArg!);
      if (literal) {
        add(literal[1]!);
        continue;
      }
      // `/x/:id/${action}` inside `for (const [action, …] of [['a', …], ['b', …]])`.
      const template = /^`([^`$]*)\$\{(\w+)\}([^`]*)`$/.exec(pathArg!);
      const loop = template
        ? [
            ...src
              .slice(0, call.index)
              .matchAll(new RegExp(`for \\(const \\[${template[2]}\\b`, 'g')),
          ].at(-1)
        : undefined;
      if (template && loop) {
        const list = src.slice(loop.index, call.index);
        const values = [...list.matchAll(/\[\s*'([\w-]+)',/g)].map((m) => m[1]!);
        if (values.length) {
          for (const v of values) add(`${template[1]}${v}${template[3]}`);
          continue;
        }
      }
      // A local helper such as `const mfaRoute = (path: string, …) => router.post(path, …)`.
      const helper = [...src.slice(0, call.index).matchAll(/const (\w+) = \(\s*path: string/g)].at(
        -1,
      );
      if (pathArg === 'path' && helper) {
        const uses = [...src.matchAll(new RegExp(`\\b${helper[1]}\\(\\s*'([^']+)'`, 'g'))];
        if (uses.length) {
          for (const u of uses) add(u[1]!);
          continue;
        }
      }
      unreadable.push(`${factory}: ${method} with non-literal path ${pathArg}`);
    }
  }
  return { mounts, routes, unreadable };
}

describe('route inventory (SEC-01, FR-I11, F13)', () => {
  const { mounts, routes, unreadable } = registeredRoutes();
  const matrix = new Set(
    [...readFileSync(MATRIX, 'utf8').matchAll(/name: '([A-Z]+ \/[^']*)'/g)].map((m) => norm(m[1]!)),
  );

  it('finds the routers and routes it is meant to check', () => {
    expect(mounts.length).toBeGreaterThan(20);
    expect(routes.length).toBeGreaterThan(150);
    // A route registered in a way this scan cannot read would escape the check.
    expect(unreadable).toEqual([]);
  });

  it('every route is in the permission matrix or is a documented public/token route', () => {
    const outside = new Set(Object.keys(OUTSIDE_MATRIX).map(norm));
    const missing = routes.filter((r) => !matrix.has(norm(r)) && !outside.has(norm(r)));
    expect(missing).toEqual([]);
  });

  it('the public list holds no route that is in the matrix or no longer exists', () => {
    const all = new Set(routes.map(norm));
    for (const route of Object.keys(OUTSIDE_MATRIX)) {
      expect(all.has(norm(route)), `${route} still exists`).toBe(true);
      expect(matrix.has(norm(route)), `${route} is not also in the matrix`).toBe(false);
    }
  });
});
