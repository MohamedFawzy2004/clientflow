import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createDb } from '../src/db/client.js';
import { makeApp, resetDb, seedAgency, testDb } from './helpers.js';

const db = testDb();

beforeEach(() => resetDb());
afterAll(() => db.$disconnect());

describe('migration and schema constraints', () => {
  it('has applied every migration to the test database', async () => {
    const rows = await db.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at FROM _prisma_migrations`;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => r.finished_at !== null)).toBe(true);
  });

  it('rejects contacts whose owner belongs to another agency (composite FK)', async () => {
    const { agencyId } = await seedAgency();
    const otherAgency = await db.agency.create({ data: { name: 'Other', slug: 'other' } });
    const outsider = await db.user.create({
      data: {
        agencyId: otherAgency.id,
        emailNorm: 'outsider@other.test',
        name: 'Outsider',
        role: 'SALES',
        passwordHash: 'x',
      },
    });
    await expect(
      db.contact.create({ data: { agencyId, ownerId: outsider.id, fullName: 'Cross agency' } }),
    ).rejects.toThrow();
  });

  it('enforces check constraints for blank names and unnormalized emails', async () => {
    const { agencyId, users } = await seedAgency();
    await expect(
      db.contact.create({ data: { agencyId, ownerId: users.owner!.id, fullName: '   ' } }),
    ).rejects.toThrow();
    await expect(
      db.contact.create({
        data: { agencyId, ownerId: users.owner!.id, fullName: 'Ok', emailNorm: 'Upper@Case.test' },
      }),
    ).rejects.toThrow();
  });

  it('keeps audit events append-only', async () => {
    await seedAgency();
    const event = await db.auditEvent.findFirstOrThrow();
    await expect(
      db.auditEvent.update({ where: { id: event.id }, data: { action: 'tampered' } }),
    ).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.delete({ where: { id: event.id } })).rejects.toThrow(/append-only/);
  });
});

describe('health endpoints', () => {
  it('reports liveness and database readiness without internal details', async () => {
    const { app } = makeApp();
    const live = await request(app).get('/health/live').expect(200);
    expect(live.body).toEqual({ status: 'ok' });
    const ready = await request(app).get('/health/ready').expect(200);
    expect(ready.body).toEqual({ status: 'ok', checks: { database: 'ok', jobs: 'ok' } });
    expect(JSON.stringify(ready.body)).not.toMatch(/postgres|5433|password/i);
  });

  it('returns 503 when the database is unreachable', async () => {
    const broken = createDb('postgresql://nobody:nothing@127.0.0.1:1/none');
    const { app } = makeApp({}, broken);
    const res = await request(app).get('/health/ready').expect(503);
    expect(res.body).toEqual({ status: 'unavailable', checks: { database: 'unavailable' } });
    await broken.$disconnect();
  });

  it('sets security headers and a request id', async () => {
    const { app } = makeApp();
    const res = await request(app).get('/health/live');
    expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-powered-by']).toBeUndefined();
  });
});
