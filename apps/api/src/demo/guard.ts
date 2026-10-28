// Safety checks before a demo reset wipes a database (FR-A08, ADR-066). Every check must pass;
// the first failure stops the reset before anything is deleted.
import type { Db } from '../db/client.js';

export class DemoRefused extends Error {}

export interface DemoTarget {
  database: string;
  /** True when the database has no agency yet (first demo setup). */
  empty: boolean;
}

/** The database must be named as a demo and typed back exactly. */
export function checkDatabaseName(database: string, confirm: string | undefined) {
  if (!/demo/i.test(database)) {
    throw new DemoRefused(
      `Database "${database}" is not a demo database (its name has no "demo").`,
    );
  }
  if (confirm !== database) {
    throw new DemoRefused(`Confirm with --confirm ${database} (the database this would wipe).`);
  }
}

/** Any agency without the demo flag means real data: refuse. */
export function checkAgencies(agencies: Array<{ isDemo: boolean }>) {
  if (agencies.some((a) => !a.isDemo)) {
    throw new DemoRefused(
      'This database holds a workspace that is not a demo. Nothing was deleted.',
    );
  }
}

export async function checkDemoTarget(
  db: Db,
  opts: { demoMode: boolean; confirm: string | undefined },
): Promise<DemoTarget> {
  if (!opts.demoMode) {
    throw new DemoRefused('DEMO_MODE is not true. A demo reset only runs on a demo deployment.');
  }
  const [{ database }] = await db.$queryRaw<
    [{ database: string }]
  >`SELECT current_database() AS database`;
  checkDatabaseName(database, opts.confirm);
  const agencies = await db.agency.findMany({ select: { isDemo: true } });
  checkAgencies(agencies);
  return { database, empty: agencies.length === 0 };
}
