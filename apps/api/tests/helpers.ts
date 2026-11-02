import { Writable } from 'node:stream';
import request from 'supertest';
import type { Express } from 'express';
import type { Role } from '@clientflow/contracts';
import { createApp, type AppConfig } from '../src/app.js';
import { createDb, type Db } from '../src/db/client.js';
import { createLogger } from '../src/middleware/logger.js';
import { bootstrapOwner } from '../src/modules/auth/bootstrap.js';
import { hashPassword } from '../src/lib/password.js';
import { MemoryMailer } from '../src/lib/mailer.js';

export const ORIGIN = 'http://localhost:5173';
export const CSRF_SECRET = 'test-csrf-secret-that-is-long-enough-1234567890';
export const PASSWORD = 'correct horse battery staple';

let sharedDb: Db | undefined;
export function testDb(): Db {
  sharedDb ??= createDb(process.env.DATABASE_URL!);
  return sharedDb;
}

/** TRUNCATE skips row-level triggers, so the append-only audit table can still be reset. */
export async function resetDb(db = testDb()) {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE audit_events, activities, proposal_reviews, proposal_items, proposal_versions, proposals, service_catalog, deals, pipeline_stages, pipelines, contacts, sessions, password_reset_tokens, invitations, users, client_organizations, agencies RESTART IDENTITY CASCADE',
  );
}

export interface TestApp {
  app: Express;
  logs: string[];
  mailer: MemoryMailer;
  /** Resolves once work started after a response (e.g. reset emails) has finished. */
  settled: () => Promise<void>;
}

export function makeApp(overrides: Partial<AppConfig> = {}, db: Db = testDb()): TestApp {
  const logs: string[] = [];
  const sink = new Writable({
    write(chunk, _enc, cb) {
      logs.push(chunk.toString());
      cb();
    },
  });
  const mailer = new MemoryMailer();
  const pending: Promise<unknown>[] = [];
  const app = createApp({
    db,
    logger: createLogger('info', sink),
    mailer,
    background: (work) => pending.push(work),
    config: {
      isProduction: false,
      appOrigins: [ORIGIN],
      csrfSecret: CSRF_SECRET,
      trustProxy: 0,
      publicUrl: ORIGIN,
      ...overrides,
    },
  });
  const settled = async () => {
    await Promise.all(pending.splice(0));
  };
  return { app, logs, mailer, settled };
}

export interface SeededAgency {
  agencyId: string;
  users: Record<string, { id: string; email: string; role: Role }>;
}

/** Owner via the real bootstrap, plus one user per role. All share PASSWORD. */
export async function seedAgency(db = testDb()): Promise<SeededAgency> {
  const { agencyId, ownerId } = await bootstrapOwner(db, {
    agencyName: 'Test Agency',
    ownerName: 'Olivia Owner',
    ownerEmail: 'owner@agency.test',
    password: PASSWORD,
  });
  const passwordHash = await hashPassword(PASSWORD);
  const users: SeededAgency['users'] = {
    owner: { id: ownerId, email: 'owner@agency.test', role: 'OWNER' },
  };
  const others: Array<[string, Role]> = [
    ['admin', 'ADMIN'],
    ['manager', 'SALES_MANAGER'],
    ['salesA', 'SALES'],
    ['salesB', 'SALES'],
    ['pm', 'PM'],
    ['member', 'MEMBER'],
    ['finance', 'FINANCE'],
  ];
  for (const [key, role] of others) {
    const email = `${key.toLowerCase()}@agency.test`;
    const user = await db.user.create({
      data: { agencyId, emailNorm: email, name: `${key} user`, role, passwordHash },
    });
    users[key] = { id: user.id, email, role };
  }
  return { agencyId, users };
}

export async function getPreCsrf(agent: ReturnType<typeof request.agent>) {
  const res = await agent.get('/api/v1/auth/csrf').expect(200);
  return res.body.data.csrfToken as string;
}

/** Logs in through the real endpoints and returns a cookie-carrying agent plus its CSRF token. */
export async function login(app: Express, email: string, password = PASSWORD) {
  const agent = request.agent(app);
  const pre = await getPreCsrf(agent);
  const res = await agent
    .post('/api/v1/auth/login')
    .set('Origin', ORIGIN)
    .set('X-CSRF-Token', pre)
    .send({ email, password });
  if (res.status !== 200)
    throw new Error(`login failed: ${res.status} ${JSON.stringify(res.body)}`);
  return { agent, csrf: res.body.data.csrfToken as string, res };
}
