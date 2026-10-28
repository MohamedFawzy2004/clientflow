// A rate-limit store in PostgreSQL (ADR-062): sign-in and one-time-link limits hold across
// restarts and across every API instance. One atomic upsert per counted request.
import type { ClientRateLimitInfo, Options, Store } from 'express-rate-limit';
import type { Db } from '../db/client.js';

export class PostgresRateLimitStore implements Store {
  /** Counters live in the database, so every instance sees the same hits. */
  readonly localKeys = false;
  private windowMs = 60_000;

  constructor(
    private readonly db: Db,
    readonly prefix: string,
  ) {}

  init(options: Options) {
    this.windowMs = options.windowMs;
  }

  private k(key: string) {
    return `${this.prefix}:${key}`.slice(0, 200);
  }

  async get(key: string): Promise<ClientRateLimitInfo | undefined> {
    const row = await this.db.rateLimitCounter.findUnique({ where: { key: this.k(key) } });
    if (!row || row.resetAt <= new Date()) return undefined;
    return { totalHits: row.hits, resetTime: row.resetAt };
  }

  /** Starts a new window when the old one has ended; otherwise adds one hit. */
  async increment(key: string): Promise<ClientRateLimitInfo> {
    const reset = new Date(Date.now() + this.windowMs);
    const [row] = await this.db.$queryRaw<Array<{ hits: number; reset_at: Date }>>`
      INSERT INTO rate_limit_counters (key, hits, reset_at) VALUES (${this.k(key)}, 1, ${reset})
      ON CONFLICT (key) DO UPDATE SET
        hits = CASE WHEN rate_limit_counters.reset_at <= now() THEN 1 ELSE rate_limit_counters.hits + 1 END,
        reset_at = CASE WHEN rate_limit_counters.reset_at <= now() THEN EXCLUDED.reset_at ELSE rate_limit_counters.reset_at END
      RETURNING hits, reset_at`;
    return { totalHits: row!.hits, resetTime: row!.reset_at };
  }

  async decrement(key: string) {
    await this.db.$executeRaw`
      UPDATE rate_limit_counters SET hits = GREATEST(hits - 1, 0)
      WHERE key = ${this.k(key)} AND reset_at > now()`;
  }

  async resetKey(key: string) {
    await this.db.rateLimitCounter.deleteMany({ where: { key: this.k(key) } });
  }
}

/** Expired counters are temporary records; the worker removes them (hourly). */
export async function pruneRateLimits(db: Db, now = new Date()) {
  const res = await db.rateLimitCounter.deleteMany({ where: { resetAt: { lt: now } } });
  return res.count;
}
