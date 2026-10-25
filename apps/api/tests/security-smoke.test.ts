// M5 security smoke gate: headers, cookies, origin checks, error envelopes and the production
// single-origin web serving, checked on the running app against the real database.
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import {
  getPreCsrf,
  login,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  testDb,
  type SeededAgency,
} from './helpers.js';

const db = testDb();
let seeded: SeededAgency;
let webDir: string;

beforeAll(async () => {
  await resetDb();
  seeded = await seedAgency();
  webDir = mkdtempSync(join(tmpdir(), 'cf-web-'));
  mkdirSync(join(webDir, 'assets'));
  writeFileSync(join(webDir, 'index.html'), '<!doctype html><div id="root"></div>');
  writeFileSync(join(webDir, 'assets', 'index-abc123.js'), 'console.log(1)');
});
afterAll(() => db.$disconnect());

describe('API responses', () => {
  it('carry strict headers, no framework banner and no caching', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/api/v1/auth/me');
    expect(res.status).toBe(401);
    expect(res.headers['content-security-policy']).toBe(
      "default-src 'none';frame-ancestors 'none';base-uri 'none'",
    );
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['referrer-policy']).toBe('no-referrer');
    expect(res.headers['cache-control']).toMatch(/no-store/);
    expect(res.headers['x-powered-by']).toBeUndefined();
    expect(res.headers['strict-transport-security']).toBeUndefined(); // only in production
    expect(res.body).toEqual({
      error: expect.objectContaining({ code: 'UNAUTHENTICATED', requestId: expect.any(String) }),
    });
  });

  it('send HSTS in production', async () => {
    const { app } = makeApp({ isProduction: true, appOrigins: ['https://app.example.test'] });
    const res = await request(app).get('/health/live');
    expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+; includeSubDomains/);
  });

  it('issue HttpOnly, SameSite session cookies (Secure in production)', async () => {
    const { app } = makeApp();
    const { res } = await login(app, seeded.users.owner!.email);
    const cookie = ([] as string[])
      .concat(res.headers['set-cookie'] ?? [])
      .find((c) => c.startsWith('cf_session'))!;
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=(Lax|Strict)/i);
    expect(cookie).toMatch(/Path=\//);
    expect(cookie).not.toMatch(/Secure/i); // http://localhost in tests

    const prod = makeApp({ isProduction: true, appOrigins: ['https://app.example.test'] });
    const agent = request.agent(prod.app);
    const pre = await agent.get('/api/v1/auth/csrf').expect(200);
    const preCookie = ([] as string[]).concat(pre.headers['set-cookie'] ?? []).join(';');
    expect(preCookie).toMatch(/Secure/i);
  });

  it('allow no cross-origin reads and refuse cross-origin writes', async () => {
    const { app } = makeApp();
    const read = await request(app).get('/api/v1/auth/csrf').set('Origin', 'https://evil.example');
    expect(read.headers['access-control-allow-origin']).toBeUndefined();
    const { agent, csrf } = await login(app, seeded.users.owner!.email);
    const write = await agent
      .post('/api/v1/contacts')
      .set('Origin', 'https://evil.example')
      .set('X-CSRF-Token', csrf)
      .send({ fullName: 'Cross-site' });
    expect(write.status).toBe(403);
    const noOrigin = await agent
      .post('/api/v1/contacts')
      .set('X-CSRF-Token', csrf)
      .send({ fullName: 'x' });
    expect(noOrigin.status).toBe(403);
    expect(await db.contact.count()).toBe(0);
  });

  it('answer oversized and malformed bodies with the typed envelope, never a stack trace', async () => {
    const { app } = makeApp();
    const agent = request.agent(app);
    const pre = await getPreCsrf(agent);
    const big = await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ email: 'a@b.test', password: 'x'.repeat(40_000) }));
    expect(big.status).toBe(413);
    const bad = await agent
      .post('/api/v1/auth/login')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .set('Content-Type', 'application/json')
      .send('{"email": ');
    expect(bad.status).toBe(400);
    for (const r of [big, bad]) {
      expect(JSON.stringify(r.body)).not.toMatch(/at \w+ \(|node_modules|SyntaxError/);
      expect(r.body.error.requestId).toEqual(expect.any(String));
    }
  });

  it('refuse unsafe production configuration at startup', () => {
    const base = {
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://u:p@db:5432/clientflow',
      CSRF_SECRET: 'a-long-random-value-that-is-not-a-placeholder-123',
      MAIL_TRANSPORT: 'disabled',
    };
    expect(() => loadEnv({ ...base, APP_ORIGINS: 'http://app.example.test' })).toThrow(/https/);
    expect(() =>
      loadEnv({ ...base, APP_ORIGINS: 'https://app.example.test', MAIL_TRANSPORT: 'dev-sink' }),
    ).toThrow(/dev-sink/);
    expect(() =>
      loadEnv({ ...base, APP_ORIGINS: 'https://app.example.test', CSRF_SECRET: 'short' }),
    ).toThrow();
    expect(loadEnv({ ...base, APP_ORIGINS: 'https://app.example.test' }).HOST).toBe('127.0.0.1');
  });
});

describe('production web serving (one origin, ADR-034)', () => {
  it('serves the app with a strict same-origin CSP and no inline scripts', async () => {
    const { app } = makeApp({ webDistDir: webDir });
    const res = await request(app).get('/app/deals/123');
    expect(res.status).toBe(200);
    expect(res.text).toContain('<div id="root">');
    expect(res.headers['cache-control']).toBe('no-cache');
    const csp = res.headers['content-security-policy'];
    expect(csp).toContain("script-src 'self'");
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
  });

  it('caches hashed assets for a year and 404s missing ones', async () => {
    const { app } = makeApp({ webDistDir: webDir });
    const asset = await request(app).get('/assets/index-abc123.js');
    expect(asset.status).toBe(200);
    expect(asset.headers['cache-control']).toMatch(/max-age=31536000, immutable/);
    expect((await request(app).get('/assets/missing.js')).status).toBe(404);
  });

  it('keeps JSON 404s for API and health paths, and does not serve files outside the build', async () => {
    const { app } = makeApp({ webDistDir: webDir });
    const api = await request(app).get('/api/v1/nope');
    expect(api.status).toBe(404);
    expect(api.body.error.code).toBe('NOT_FOUND');
    expect((await request(app).get('/health/nope')).status).toBe(404);
    const traversal = await request(app).get('/..%2f..%2fpackage.json');
    expect(traversal.text).not.toContain('"dependencies"');
  });
});
