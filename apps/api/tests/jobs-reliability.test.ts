// Background jobs under load and overlap (backend audit, batch 2): reminder scans reach every due
// candidate over successive runs, and a worker whose claim expired cannot record an outcome.
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import {
  claimJobs,
  CLAIM_SECONDS,
  completeJob,
  enqueue,
  failJob,
  renewClaim,
} from '../src/jobs/outbox.js';
import { runReminderScan } from '../src/jobs/reminders.js';
import { resetDb, seedAgency, testDb, type SeededAgency } from './helpers.js';

const db = testDb();
let seeded: SeededAgency;

beforeEach(async () => {
  await resetDb();
  seeded = await seedAgency();
});
afterAll(() => db.$disconnect());

const overdue = (ownerId: string, count: number, now: Date, name: string) =>
  db.contact.createMany({
    data: Array.from({ length: count }, (_, i) => ({
      agencyId: seeded.agencyId,
      ownerId,
      fullName: `${name} ${i}`,
      nextActionAt: new Date(now.getTime() - (i + 1) * 60_000),
    })),
  });
const reminded = (where: object = {}) =>
  db.notification.count({ where: { type: 'reminder.follow_up_overdue', ...where } });

describe('reminder scan (FR-A01)', () => {
  it('a backlog larger than one run is reminded over the next runs, each once', async () => {
    const now = new Date();
    await overdue(seeded.users.salesA!.id, 1200, now, 'Lead');
    const created: number[] = [];
    for (let i = 0; i < 4; i++) {
      created.push((await runReminderScan(db, seeded.agencyId, now)).created);
    }
    expect(created).toEqual([500, 500, 200, 0]);
    expect(await reminded()).toBe(1200);
  });

  it('candidates nobody will be reminded about do not use up the run', async () => {
    const now = new Date();
    // salesA turned follow-up reminders off; their 600 overdue leads must not hide salesB's.
    await db.notificationPreference.create({
      data: { userId: seeded.users.salesA!.id, category: 'FOLLOW_UPS', inApp: false, email: false },
    });
    await db.notificationPreference.create({
      data: { userId: seeded.users.salesB!.id, category: 'FOLLOW_UPS', inApp: true, email: true },
    });
    await overdue(seeded.users.salesA!.id, 600, now, 'Muted');
    await overdue(seeded.users.salesB!.id, 10, now, 'Wanted');

    const r = await runReminderScan(db, seeded.agencyId, now);
    expect(r.created).toBe(10);
    expect(await reminded({ recipientId: seeded.users.salesB!.id })).toBe(10);
    expect(await reminded({ recipientId: seeded.users.salesA!.id })).toBe(0);
    // salesB asked for email too: one email job per reminder, none for in-app-only users.
    expect(await db.outboxJob.count({ where: { kind: 'email.notification' } })).toBe(10);
    expect((await runReminderScan(db, seeded.agencyId, now)).created).toBe(0);
  });
});

describe('job claims (FR-A02)', () => {
  async function takenOver() {
    await enqueue(db, [
      { agencyId: seeded.agencyId, kind: 'reminders.scan', payload: { agencyId: seeded.agencyId } },
    ]);
    const t0 = new Date();
    const [stale] = await claimJobs(db, 1, t0);
    // The first claim expired (its worker stalled) and a second worker took the job.
    const [current] = await claimJobs(db, 1, new Date(t0.getTime() + (CLAIM_SECONDS + 1) * 1000));
    expect(current!.id).toBe(stale!.id);
    return { stale: stale!, current: current! };
  }

  it('a worker whose claim was taken over cannot complete, fail or renew the job', async () => {
    const { stale, current } = await takenOver();
    expect(await completeJob(db, stale)).toBe(false);
    expect(await failJob(db, stale, new Error('late timeout'))).toBe('lost');
    expect(await renewClaim(db, stale)).toBe(false);
    const job = await db.outboxJob.findUniqueOrThrow({ where: { id: current.id } });
    expect(job).toMatchObject({ state: 'RUNNING', attempts: 2, lastError: null });

    // The worker that holds the claim records the outcome.
    expect(await completeJob(db, current)).toBe(true);
    expect((await db.outboxJob.findUniqueOrThrow({ where: { id: current.id } })).state).toBe(
      'DONE',
    );
  });

  it('renewing restarts the claim, so a long batch does not lose its later jobs', async () => {
    await enqueue(db, [
      { agencyId: seeded.agencyId, kind: 'reminders.scan', payload: { agencyId: seeded.agencyId } },
    ]);
    const t0 = new Date();
    const [job] = await claimJobs(db, 1, t0);
    const later = new Date(t0.getTime() + (CLAIM_SECONDS - 10) * 1000);
    expect(await renewClaim(db, job!, later)).toBe(true);
    // Just past the first claim: still held, nobody else can take it.
    expect(await claimJobs(db, 1, new Date(t0.getTime() + (CLAIM_SECONDS + 1) * 1000))).toEqual([]);
    expect(await completeJob(db, job!)).toBe(true);
  });
});
