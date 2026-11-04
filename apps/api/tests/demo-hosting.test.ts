// Public demo hosting (ADR-071): restricted actions, the demo write cap, "Explore as …" sign-in
// and the boot-time reset settings. Every check runs against the real app and PostgreSQL.
import request from 'supertest';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { DEMO_RESTRICTED_ROUTES, isDemoRestricted } from '../src/middleware/demo.js';
import { getPreCsrf, login, makeApp, ORIGIN, resetDb, seedAgency, testDb } from './helpers.js';

const db = testDb();
const DEMO = { demo: { writesPerWindow: 1000 } };

/** One request per restricted rule, with made-up ids (the guard answers before any lookup). */
const RESTRICTED: Array<[method: 'post' | 'patch', path: string]> = [
  ['post', '/auth/password-reset/request'],
  ['post', '/auth/password-reset/confirm'],
  ['post', '/auth/mfa/setup'],
  ['post', '/auth/mfa/enable'],
  ['post', '/auth/mfa/recovery-codes'],
  ['post', '/auth/mfa/disable'],
  ['patch', '/users/00000000-0000-4000-8000-000000000001'],
  ['post', '/users/00000000-0000-4000-8000-000000000001/deactivate'],
  ['post', '/users/00000000-0000-4000-8000-000000000001/reactivate'],
  ['post', '/users/00000000-0000-4000-8000-000000000001/revoke-sessions'],
  ['post', '/users/00000000-0000-4000-8000-000000000001/mfa-reset'],
  ['post', '/invitations'],
  ['post', '/invitations/preview'],
  ['post', '/invitations/accept'],
  ['post', '/invitations/00000000-0000-4000-8000-000000000001/revoke'],
  ['post', '/invitations/00000000-0000-4000-8000-000000000001/resend'],
  ['post', '/client-orgs/00000000-0000-4000-8000-000000000001/invitations'],
  [
    'post',
    '/client-orgs/00000000-0000-4000-8000-000000000001/invitations/00000000-0000-4000-8000-000000000002/revoke',
  ],
  [
    'post',
    '/client-orgs/00000000-0000-4000-8000-000000000001/users/00000000-0000-4000-8000-000000000002/deactivate',
  ],
  [
    'post',
    '/client-orgs/00000000-0000-4000-8000-000000000001/users/00000000-0000-4000-8000-000000000002/reactivate',
  ],
  ['patch', '/agency'],
  ['post', '/projects/00000000-0000-4000-8000-000000000001/files'],
  ['post', '/files/00000000-0000-4000-8000-000000000001/delete'],
  ['post', '/imports'],
  ['post', '/imports/preview'],
];

describe('demo route rules', () => {
  it('cover every listed rule exactly once', () => {
    for (const rule of DEMO_RESTRICTED_ROUTES) {
      const hits = RESTRICTED.filter(
        ([m, p]) => m.toUpperCase() === rule.method && rule.path.test(p),
      );
      expect(hits.length, String(rule.path)).toBeGreaterThan(0);
    }
  });

  it('leave everyday work open', () => {
    expect(isDemoRestricted('POST', '/contacts')).toBe(false);
    expect(isDemoRestricted('PATCH', '/deals/abc')).toBe(false);
    expect(isDemoRestricted('POST', '/auth/login')).toBe(false);
    expect(isDemoRestricted('POST', '/auth/logout')).toBe(false);
    expect(isDemoRestricted('GET', '/users')).toBe(false);
    expect(isDemoRestricted('POST', '/files/abc/download-url')).toBe(false);
    expect(isDemoRestricted('POST', '/imports/abc/undo')).toBe(false);
    // A look-alike path is not a match.
    expect(isDemoRestricted('POST', '/invitations-x')).toBe(false);
    expect(isDemoRestricted('PATCH', '/users/abc/extra')).toBe(false);
  });

  it('match the way Express routes do: any letter case, optional trailing slash', () => {
    expect(isDemoRestricted('PATCH', '/AGENCY')).toBe(true);
    expect(isDemoRestricted('PATCH', '/agency/')).toBe(true);
    expect(isDemoRestricted('POST', '/Invitations/')).toBe(true);
    expect(isDemoRestricted('POST', '/users/abc/Deactivate/')).toBe(true);
    expect(isDemoRestricted('post', '/files/abc/delete')).toBe(true);
    expect(isDemoRestricted('POST', '/contacts/')).toBe(false);
  });
});

describe('demo guard on the real app', () => {
  beforeEach(async () => {
    await resetDb();
    await seedAgency();
  });

  it('refuses every restricted action for a signed-in owner, with DEMO_RESTRICTED', async () => {
    const { app } = makeApp(DEMO);
    const { agent, csrf } = await login(app, 'owner@agency.test');
    for (const [method, path] of RESTRICTED) {
      const res = await agent[method](`/api/v1${path}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code, `${method} ${path}`).toBe('DEMO_RESTRICTED');
    }
  });

  it('cannot be stepped around with letter case or a trailing slash', async () => {
    const { app } = makeApp(DEMO);
    const { agent, csrf } = await login(app, 'owner@agency.test');
    const variants = RESTRICTED.flatMap(([method, path]) => [
      [method, path.toUpperCase()],
      [method, `${path}/`],
    ]) as Array<[(typeof RESTRICTED)[number][0], string]>;
    for (const [method, path] of variants) {
      const res = await agent[method](`/api/v1${path}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({});
      expect(res.status, `${method} ${path}`).toBe(403);
      expect(res.body.error.code, `${method} ${path}`).toBe('DEMO_RESTRICTED');
    }
    // And the real handler is reachable with those spellings, so the guard is what stops them.
    const { app: plain } = makeApp();
    const owner = await login(plain, 'owner@agency.test');
    const res = await owner.agent
      .patch('/api/v1/AGENCY/')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', owner.csrf)
      .send({});
    expect(res.status).not.toBe(404);
  });

  it('refuses them signed out too (password reset is reachable without a session)', async () => {
    const { app } = makeApp(DEMO);
    const agent = request.agent(app);
    const pre = await getPreCsrf(agent);
    const res = await agent
      .post('/api/v1/auth/password-reset/request')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ email: 'owner@agency.test' });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('DEMO_RESTRICTED');
  });

  it('does nothing outside a demo deployment', async () => {
    const { app } = makeApp();
    const { agent, csrf } = await login(app, 'owner@agency.test');
    for (const [method, path] of RESTRICTED) {
      const res = await agent[method](`/api/v1${path}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({});
      expect(res.body.error?.code, `${method} ${path}`).not.toBe('DEMO_RESTRICTED');
    }
  });

  it('still lets a demo visitor do everyday work', async () => {
    const { app } = makeApp(DEMO);
    const { agent, csrf } = await login(app, 'owner@agency.test');
    const res = await agent
      .post('/api/v1/contacts')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ fullName: 'Nadia Hassan', companyName: 'Fictional Co' });
    expect(res.status).toBe(201);
  });

  it('caps changes per address, but not reads', async () => {
    const { app } = makeApp({ demo: { writesPerWindow: 3 } });
    const { agent, csrf } = await login(app, 'owner@agency.test'); // login itself is one change
    const add = () =>
      agent
        .post('/api/v1/contacts')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', csrf)
        .send({ fullName: 'Capped Contact' });
    expect((await add()).status).toBe(201);
    expect((await add()).status).toBe(201);
    const capped = await add();
    expect(capped.status).toBe(429);
    expect(capped.body.error.code).toBe('RATE_LIMITED');
    for (let i = 0; i < 5; i++) await agent.get('/api/v1/contacts').expect(200);
  });
});

describe('"Explore as …" demo sign-in', () => {
  beforeEach(async () => {
    await resetDb();
    await seedAgency();
  });

  const markDemo = () => db.agency.updateMany({ data: { isDemo: true } });

  it('does not exist outside a demo deployment', async () => {
    await markDemo();
    const { app } = makeApp();
    await request(app).get('/api/v1/demo/accounts').expect(404);
    const agent = request.agent(app);
    const pre = await getPreCsrf(agent);
    await agent
      .post('/api/v1/demo/sessions')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ role: 'OWNER' })
      .expect(404);
  });

  it('never signs anyone in to a workspace that is not marked as a demo', async () => {
    const { app } = makeApp(DEMO);
    const list = await request(app).get('/api/v1/demo/accounts').expect(200);
    expect(list.body.data).toEqual([]);
    const agent = request.agent(app);
    const pre = await getPreCsrf(agent);
    const res = await agent
      .post('/api/v1/demo/sessions')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ role: 'OWNER' });
    expect(res.status).toBe(404);
    expect(String(res.headers['set-cookie'] ?? '')).not.toMatch(/session/i);
  });

  it('lists one person per role and signs in as them, without a password', async () => {
    await markDemo();
    const { app } = makeApp(DEMO);
    const list = await request(app).get('/api/v1/demo/accounts').expect(200);
    const roles = list.body.data.map((a: { role: string }) => a.role);
    expect(roles).toEqual(['OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER', 'FINANCE']);
    // Names only: no email, id or password reaches the public list.
    expect(Object.keys(list.body.data[0]).sort()).toEqual(['name', 'role']);

    const agent = request.agent(app);
    const pre = await getPreCsrf(agent);
    const res = await agent
      .post('/api/v1/demo/sessions')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ role: 'PM' })
      .expect(200);
    expect(res.body.data.user.role).toBe('PM');
    expect(res.body.data.user.agency.isDemo).toBe(true);
    const me = await agent.get('/api/v1/auth/me').expect(200);
    expect(me.body.data.role).toBe('PM');
  });

  it('needs the sign-in form token and a known role', async () => {
    await markDemo();
    const { app } = makeApp(DEMO);
    const agent = request.agent(app);
    await agent
      .post('/api/v1/demo/sessions')
      .set('Origin', ORIGIN)
      .send({ role: 'OWNER' })
      .expect(403);
    const pre = await getPreCsrf(agent);
    const bad = await agent
      .post('/api/v1/demo/sessions')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ role: 'ROOT' });
    expect(bad.status).toBe(422);
    // A role nobody holds in this demo.
    const none = await agent
      .post('/api/v1/demo/sessions')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', pre)
      .send({ role: 'CLIENT' });
    expect(none.status).toBe(404);
  });

  it('skips deactivated people', async () => {
    await markDemo();
    await db.user.updateMany({ where: { role: 'FINANCE' }, data: { active: false } });
    const { app } = makeApp(DEMO);
    const list = await request(app).get('/api/v1/demo/accounts').expect(200);
    expect(list.body.data.map((a: { role: string }) => a.role)).not.toContain('FINANCE');
  });

  it('is rate-limited like password sign-in', async () => {
    await markDemo();
    const { app } = makeApp({ ...DEMO, rateLimits: { loginPerIp: 2 } });
    // A fresh visitor each time (same address), as a script would do.
    const send = async () => {
      const agent = request.agent(app);
      const pre = await getPreCsrf(agent);
      return agent
        .post('/api/v1/demo/sessions')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', pre)
        .send({ role: 'OWNER' });
    };
    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    const third = await send();
    expect(third.status).toBe(429);
    expect(third.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('demo boot settings', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/clientflow_demo',
    APP_ORIGINS: 'http://localhost:5173',
    CSRF_SECRET: 'x'.repeat(40),
    FILE_ENCRYPTION_KEY: 'ab'.repeat(32),
    MAIL_TRANSPORT: 'disabled',
  };

  it('refuse a boot-time reset outside demo mode', () => {
    expect(() => loadEnv({ ...base, DEMO_RESET_ON_BOOT: 'clientflow_demo' })).toThrow(
      /DEMO_RESET_ON_BOOT needs DEMO_MODE=true/,
    );
    const env = loadEnv({ ...base, DEMO_MODE: 'true', DEMO_RESET_ON_BOOT: 'clientflow_demo' });
    expect(env.DEMO_RESET_ON_BOOT).toBe('clientflow_demo');
    expect(env.DEMO_WRITE_LIMIT_PER_IP).toBe(120);
  });
});
