// Transactional outbox (FR-A02, spec §8.1 job_outbox, ADR-058). A job row is written in the same
// transaction as the change that needs it, so a rolled-back change never sends anything and a
// committed one is never forgotten. The worker (worker.ts) runs the jobs.
import { z } from 'zod';
import type { Db } from '../db/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { Tx } from '../modules/projects/access.js';

/** Payloads hold IDs only, never addresses, names or tokens: the worker loads the rest. */
export const JOB_PAYLOADS = {
  /** Email a staff user that a notification is waiting (link only, SEC-24). */
  'email.notification': z.object({ notificationId: z.uuid() }).strict(),
  /** Email a portal user that something was shared with them (link only). */
  'email.portal': z
    .object({
      template: z.enum(['change_sent', 'proposal_sent']),
      userId: z.uuid(),
      entityId: z.uuid(),
    })
    .strict(),
  /** Create due reminders for one agency (FR-A01). Scheduled every few minutes by the worker. */
  'reminders.scan': z.object({ agencyId: z.uuid() }).strict(),
} as const;
export type JobKind = keyof typeof JOB_PAYLOADS;
export type JobPayload<K extends JobKind> = z.infer<(typeof JOB_PAYLOADS)[K]>;

export interface EnqueueInput<K extends JobKind> {
  agencyId: string;
  kind: K;
  payload: JobPayload<K>;
  /** Same key = same job: enqueueing twice is a no-op. */
  dedupeKey?: string;
  availableAt?: Date;
  maxAttempts?: number;
}

export async function enqueue<K extends JobKind>(db: Db | Tx, jobs: EnqueueInput<K>[]) {
  if (jobs.length === 0) return;
  await db.outboxJob.createMany({
    data: jobs.map((j) => ({
      agencyId: j.agencyId,
      kind: j.kind,
      payload: JOB_PAYLOADS[j.kind].parse(j.payload) as Prisma.InputJsonValue,
      dedupeKey: j.dedupeKey ?? null,
      availableAt: j.availableAt ?? new Date(),
      ...(j.maxAttempts ? { maxAttempts: j.maxAttempts } : {}),
    })),
    skipDuplicates: true,
  });
}

export interface ClaimedJob {
  id: string;
  kind: string;
  payload: unknown;
  attempts: number;
  maxAttempts: number;
}

/** How long a claim lasts. A worker that dies mid-job loses it after this and another retries. */
export const CLAIM_SECONDS = 120;

/**
 * Claims up to `limit` due jobs. SKIP LOCKED lets several workers run at once without taking the
 * same job; a RUNNING job whose claim expired (its worker crashed) is due again. Claiming counts
 * the attempt, so a job that keeps crashing its worker still reaches the dead letter.
 */
export async function claimJobs(db: Db, limit: number, now = new Date()): Promise<ClaimedJob[]> {
  const lockedUntil = new Date(now.getTime() + CLAIM_SECONDS * 1000);
  return db.$queryRaw<ClaimedJob[]>`
    UPDATE outbox_jobs SET state = 'RUNNING', locked_until = ${lockedUntil}, attempts = attempts + 1
    WHERE id IN (
      SELECT id FROM outbox_jobs
      WHERE (state = 'PENDING' AND available_at <= ${now})
         OR (state = 'RUNNING' AND locked_until < ${now} AND attempts < max_attempts)
      ORDER BY available_at
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, kind, payload, attempts, max_attempts AS "maxAttempts"`;
}

/** Retry delay after the n-th failed attempt: 30 s, 1 min, 2 min, … capped at 1 hour, ±20%. */
export function backoffMs(attempt: number, random = Math.random): number {
  const base = Math.min(30_000 * 2 ** Math.max(0, attempt - 1), 3_600_000);
  return Math.round(base * (0.8 + 0.4 * random()));
}

export async function completeJob(db: Db, id: string) {
  await db.outboxJob.updateMany({
    where: { id, state: 'RUNNING' },
    data: { state: 'DONE', lockedUntil: null, finishedAt: new Date(), lastError: null },
  });
}

/** A short, safe description of a failure: the error class and the first line of its message. */
export function describeError(err: unknown): string {
  const name = err instanceof Error ? err.name : 'Error';
  const message = err instanceof Error ? err.message : String(err);
  // Addresses are not kept even when a provider puts them in its message.
  const line = (message.split('\n')[0] ?? '').replace(/[^\s@]+@[^\s@]+/g, '[address]');
  return `${name}: ${line}`.slice(0, 300);
}

/** Schedules a retry, or moves the job to the dead letter once it used all its attempts. */
export async function failJob(db: Db, job: ClaimedJob, err: unknown, now = new Date()) {
  const dead = job.attempts >= job.maxAttempts;
  await db.outboxJob.updateMany({
    where: { id: job.id, state: 'RUNNING' },
    data: dead
      ? { state: 'DEAD', lockedUntil: null, finishedAt: now, lastError: describeError(err) }
      : {
          state: 'PENDING',
          lockedUntil: null,
          availableAt: new Date(now.getTime() + backoffMs(job.attempts)),
          lastError: describeError(err),
        },
  });
  return dead;
}

/** Jobs whose claim expired after their last attempt: nobody will run them again. */
export async function buryAbandoned(db: Db, now = new Date()) {
  const res = await db.outboxJob.updateMany({
    where: {
      state: 'RUNNING',
      lockedUntil: { lt: now },
      attempts: { gte: db.outboxJob.fields.maxAttempts },
    },
    data: {
      state: 'DEAD',
      lockedUntil: null,
      finishedAt: now,
      lastError: 'Abandoned: the worker stopped during the last attempt.',
    },
  });
  return res.count;
}
