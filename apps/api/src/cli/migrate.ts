// Applies pending database migrations (ADR-067). Used as Render's pre-deploy command:
//
//   node apps/api/dist/cli/migrate.js
//
// Reads DATABASE_URL only, so it runs before the rest of the configuration exists. Exits
// non-zero on failure, which stops the deploy and keeps the previous release running.
import { fileURLToPath } from 'node:url';
import { MigrationError, applyMigrations } from '../db/migrate.js';

const url = process.env.DATABASE_URL;
if (!url?.startsWith('postgresql://') && !url?.startsWith('postgres://')) {
  console.error('DATABASE_URL must be a postgresql:// connection string.');
  process.exit(1);
}
// apps/api/dist/cli → repository root → prisma/migrations (also the layout inside the image).
const dir = fileURLToPath(new URL('../../../../prisma/migrations', import.meta.url));

try {
  const result = await applyMigrations(url, dir, (line) => console.log(line));
  console.log(
    `Migrations: ${result.applied.length} applied, ${result.alreadyApplied} already applied` +
      (result.modified.length ? `, ${result.modified.length} changed since applied` : '') +
      '.',
  );
} catch (err) {
  console.error(err instanceof MigrationError ? err.message : err);
  process.exitCode = 1;
}
