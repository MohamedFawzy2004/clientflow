// The background worker (FR-A02, ADR-058). It runs inside the API process by default, and as many
// copies as you like can run at once: claims use SKIP LOCKED and every job is idempotent.
import { handleJob, type WorkerDeps } from './handlers.js';
import { pruneRateLimits } from '../middleware/rate-limit-store.js';
import { buryAbandoned, claimJobs, completeJob, enqueue, failJob } from './outbox.js';

export type { WorkerDeps } from './handlers.js';

export interface RunResult {
  done: number;
  retried: number;
  dead: number;
}

/** Runs due jobs until none are left or `max` have run. Tests and the CLI call it directly. */
export async function runDueJobs(deps: WorkerDeps, max = 200): Promise<RunResult> {
  const result: RunResult = { done: 0, retried: 0, dead: 0 };
  while (result.done + result.retried + result.dead < max) {
    const batch = await claimJobs(
      deps.db,
      Math.min(20, max - result.done - result.retried - result.dead),
    );
    if (batch.length === 0) break;
    for (const job of batch) {
      try {
        await handleJob(deps, job);
        await completeJob(deps.db, job.id);
        result.done += 1;
      } catch (err) {
        const dead = await failJob(deps.db, job, err);
        if (dead) result.dead += 1;
        else result.retried += 1;
        deps.logger.warn(
          { jobId: job.id, kind: job.kind, attempt: job.attempts, dead },
          dead ? 'Job failed for good (dead letter)' : 'Job failed; retry scheduled',
        );
      }
    }
  }
  result.dead += await buryAbandoned(deps.db);
  return result;
}

/**
 * Queues one reminder scan per agency for the current time slot. The dedupe key names the slot,
 * so several servers scheduling at once still queue one scan.
 */
export async function scheduleReminderScans(deps: WorkerDeps, slotMs: number, now = new Date()) {
  const slot = Math.floor(now.getTime() / slotMs);
  const agencies = await deps.db.agency.findMany({ select: { id: true } });
  await enqueue(
    deps.db,
    agencies.map((a) => ({
      agencyId: a.id,
      kind: 'reminders.scan' as const,
      payload: { agencyId: a.id },
      dedupeKey: `reminders.scan:${a.id}:${slot}`,
      maxAttempts: 3,
    })),
  );
}

/** Finished jobs are temporary records: they are removed after 30 days (dead ones are kept). */
export async function pruneFinishedJobs(deps: WorkerDeps, now = new Date()) {
  const res = await deps.db.outboxJob.deleteMany({
    where: { state: 'DONE', finishedAt: { lt: new Date(now.getTime() - 30 * 86_400_000) } },
  });
  return res.count;
}

export interface WorkerOptions {
  /** How often to look for due jobs. */
  pollMs: number;
  /** How often reminders are scanned. */
  scanMs: number;
}

/** Starts the polling loop. `stop()` waits for the current round to finish. */
export function startWorker(deps: WorkerDeps, options: WorkerOptions) {
  let stopped = false;
  let current: Promise<void> = Promise.resolve();
  let timer: NodeJS.Timeout | undefined;
  let lastScheduled = 0;
  let lastPruned = 0;

  const tick = async () => {
    const now = Date.now();
    if (now - lastScheduled >= options.scanMs) {
      await scheduleReminderScans(deps, options.scanMs);
      lastScheduled = now;
    }
    if (now - lastPruned >= 3_600_000) {
      await pruneFinishedJobs(deps);
      await pruneRateLimits(deps.db);
      lastPruned = now;
    }
    await runDueJobs(deps);
  };
  const loop = () => {
    if (stopped) return;
    current = tick()
      .catch((err: unknown) => {
        // A database outage must not kill the process: log and try again next round.
        deps.logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          'Worker round failed',
        );
      })
      .finally(() => {
        if (!stopped) timer = setTimeout(loop, options.pollMs);
      });
  };
  loop();
  deps.logger.info({ pollMs: options.pollMs, scanMs: options.scanMs }, 'Background worker started');
  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await current;
    },
  };
}
