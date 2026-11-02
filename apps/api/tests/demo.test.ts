// M12 — demo workspace and its safe reset (FR-A08, spec §21, ADR-066).
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDemo, type DemoResetResult } from '../src/demo/reset.js';
import {
  DemoRefused,
  checkAgencies,
  checkDatabaseName,
  checkDemoTarget,
} from '../src/demo/guard.js';
import { DemoClient } from '../src/demo/client.js';
import { DEMO_DOMAIN, type DemoCredential } from '../src/demo/seed.js';
import { wipeDemo } from '../src/demo/wipe.js';
import { loadEnv } from '../src/config/env.js';
import {
  CSRF_SECRET,
  makeApp,
  ORIGIN,
  resetDb,
  seedAgency,
  storage,
  TEST_FILE_MAX_BYTES,
  testDb,
} from './helpers.js';

const db = testDb();

describe('demo reset guard', () => {
  it('refuses without DEMO_MODE, before reading anything', async () => {
    await expect(checkDemoTarget(db, { demoMode: false, confirm: 'x' })).rejects.toThrow(
      /DEMO_MODE is not true/,
    );
  });

  it('refuses a database whose name has no "demo" (the test database)', async () => {
    const [{ name }] = await db.$queryRaw<[{ name: string }]>`SELECT current_database() AS name`;
    await expect(checkDemoTarget(db, { demoMode: true, confirm: name })).rejects.toThrow(
      /not a demo database/,
    );
  });

  it('needs the database name typed back exactly', () => {
    expect(() => checkDatabaseName('clientflow_demo', undefined)).toThrow(DemoRefused);
    expect(() => checkDatabaseName('clientflow_demo', 'clientflow')).toThrow(/--confirm/);
    expect(() => checkDatabaseName('clientflow_demo', 'clientflow_demo')).not.toThrow();
  });

  it('refuses any workspace that is not marked as a demo', async () => {
    await resetDb();
    await seedAgency();
    const agencies = await db.agency.findMany({ select: { isDemo: true } });
    expect(agencies).toEqual([{ isDemo: false }]);
    expect(() => checkAgencies(agencies)).toThrow(/not a demo/);
    expect(() => checkAgencies([{ isDemo: true }])).not.toThrow();
    expect(() => checkAgencies([])).not.toThrow();
  });

  it('DEMO_MODE refuses a mail transport that could deliver', () => {
    const base = {
      DATABASE_URL: 'postgresql://u:p@localhost:5432/clientflow_demo',
      APP_ORIGINS: 'http://localhost:5173',
      CSRF_SECRET: 'x'.repeat(40),
      FILE_ENCRYPTION_KEY: 'ab'.repeat(32),
      DEMO_MODE: 'true',
    };
    expect(loadEnv({ ...base, MAIL_TRANSPORT: 'disabled' }).DEMO_MODE).toBe(true);
    expect(() => loadEnv({ ...base, MAIL_TRANSPORT: 'smtp' as never })).toThrow();
  });
});

describe('demo seed (through the real API)', () => {
  let server: Server;
  let base: string;
  let result: DemoResetResult;
  let creds: DemoCredential[];

  beforeAll(async () => {
    // Start from a non-empty database: the reset must replace what is there.
    await resetDb();
    await db.agency.create({ data: { name: 'Old demo', slug: 'old-demo', isDemo: true } });
    result = await resetDemo({
      db,
      storage,
      csrfSecret: CSRF_SECRET,
      files: { maxBytes: TEST_FILE_MAX_BYTES },
    });
    creds = result.credentials;
    // A separate app to sign in as the seeded clients and look around.
    const { app } = makeApp({ rateLimits: { loginPerIp: 1000, tokenPerIp: 1000 } });
    server = app.listen(0, '127.0.0.1');
    await new Promise<void>((r) => server.once('listening', () => r()));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  }, 120_000);

  afterAll(() => {
    server?.close();
  });

  it('matches the spec §21 demo set', async () => {
    const roles = await db.user.groupBy({ by: ['role'], _count: true });
    expect(Object.fromEntries(roles.map((r) => [r.role, r._count]))).toEqual({
      OWNER: 1,
      ADMIN: 1,
      SALES_MANAGER: 1,
      SALES: 2,
      PM: 1,
      MEMBER: 2,
      FINANCE: 1,
      CLIENT: 3,
    });
    expect(await db.clientOrganization.count()).toBe(3);
    expect(await db.contact.count()).toBe(20);
    expect(await db.deal.count()).toBe(10);
    expect(await db.proposal.count()).toBe(4);
    expect(await db.proposalVersion.count()).toBeGreaterThan(4); // one proposal has two versions
    expect(await db.project.count()).toBe(3);
    // 25 planned tasks plus the one the accepted change request creates.
    expect(await db.task.count({ where: { scope: 'BASELINE' } })).toBe(25);
    expect(await db.task.count({ where: { scope: 'CHANGE' } })).toBe(1);
    expect(await db.changeRequest.count()).toBe(3);
    const deliverables = await db.deliverable.groupBy({ by: ['status'], _count: true });
    expect(deliverables.map((d) => d.status).sort()).toEqual(
      ['APPROVED', 'PUBLISHED', 'READY', 'REVISION_REQUESTED'].sort(),
    );
    const invoices = await db.invoice.groupBy({ by: ['status'], _count: true });
    expect(Object.fromEntries(invoices.map((i) => [i.status, i._count]))).toEqual({
      PAID: 1,
      PARTIALLY_PAID: 1,
      ISSUED: 2,
      DRAFT: 1,
    });
    const today = new Date(new Date().toISOString().slice(0, 10));
    expect(
      await db.task.count({ where: { dueOn: { lt: today }, status: { not: 'DONE' } } }),
    ).toBeGreaterThan(0);
    const agencies = await db.agency.findMany();
    expect(agencies.map((a) => [a.slug === 'old-demo', a.isDemo])).toEqual([[false, true]]);
  });

  it('uses only fictional .test addresses and strong, unique passwords', async () => {
    const emails = (await db.user.findMany()).map((u) => u.emailNorm);
    expect(
      emails.every((e) => e.endsWith(`.${DEMO_DOMAIN}`) || e.endsWith(`@${DEMO_DOMAIN}`)),
    ).toBe(true);
    const contactEmails = (await db.contact.findMany()).map((c) => c.emailNorm);
    expect(contactEmails.every((e) => e === null || e.endsWith('example.test'))).toBe(true);
    expect(creds).toHaveLength(12);
    expect(new Set(creds.map((c) => c.password)).size).toBe(12);
    expect(creds.every((c) => c.password.length >= 24)).toBe(true);
  });

  it('every record went through the API: activities and audit events exist', async () => {
    expect(await db.auditEvent.count()).toBeGreaterThan(100);
    expect(await db.activity.count({ where: { entityType: 'project' } })).toBeGreaterThan(0);
  });

  it('each client sees only their own organization in the portal', async () => {
    const projects = await db.project.findMany({ select: { id: true, clientOrgId: true } });
    const invoices = await db.invoice.findMany({
      where: { status: { not: 'DRAFT' } },
      select: { id: true, clientOrgId: true },
    });
    for (const cred of creds.filter((c) => c.role === 'CLIENT')) {
      const user = await db.user.findFirstOrThrow({ where: { emailNorm: cred.email } });
      const client = await DemoClient.signIn(base, ORIGIN, cred.email, cred.password);
      const seen = await client.get<Array<{ id: string }>>('/portal/projects');
      const own = projects.filter((p) => p.clientOrgId === user.clientOrgId).map((p) => p.id);
      expect(seen.map((p) => p.id)).toEqual(own);
      for (const other of projects.filter((p) => p.clientOrgId !== user.clientOrgId)) {
        await expect(client.get(`/portal/projects/${other.id}`)).rejects.toThrow(/→ 404/);
      }
      const bills = await client.get<Array<{ id: string }>>('/portal/invoices');
      const ownBills = invoices.filter((i) => i.clientOrgId === user.clientOrgId).map((i) => i.id);
      expect(bills.map((b) => b.id).sort()).toEqual(ownBills.sort());
    }
  });

  it('leaves no queued email behind for the live server to send', async () => {
    expect(result.droppedEmails).toBeGreaterThan(0);
    expect(await db.outboxJob.count({ where: { state: 'PENDING' } })).toBe(0);
  });

  it('wipe removes the stored files and every row, keeping the migrations', async () => {
    const stored = await db.storedFile.findMany();
    expect(stored).toHaveLength(4);
    const wiped = await wipeDemo(db, storage);
    expect(wiped.files).toBe(4);
    for (const f of stored) {
      const read = new Promise((resolve, reject) => {
        storage
          .get(f.storageKey, { iv: f.encIv, tag: f.encTag })
          .on('error', reject)
          .on('data', () => {})
          .on('end', resolve);
      });
      await expect(read).rejects.toThrow();
    }
    expect(await db.agency.count()).toBe(0);
    expect(await db.auditEvent.count()).toBe(0);
    const [{ n }] = await db.$queryRaw<
      [{ n: bigint }]
    >`SELECT count(*) AS n FROM _prisma_migrations`;
    expect(Number(n)).toBeGreaterThan(0);
  });
});
