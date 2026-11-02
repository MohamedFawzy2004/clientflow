// Prepares the isolated E2E database: applies migrations, empties it, creates the owner with the
// real bootstrap CLI, then adds two salespeople. Passwords are random per run and are written
// to e2e/.auth/credentials.json (gitignored).
import { randomBytes } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hash } from '@node-rs/argon2';
import pg from 'pg';
import 'dotenv/config';

const run = (cmd: string, args: string[], env: NodeJS.ProcessEnv = {}) => {
  // npm needs a shell on Windows, and the shell splits unquoted arguments on spaces.
  const useShell = process.platform === 'win32';
  const quoted = useShell ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
  const res = spawnSync(cmd, quoted, {
    stdio: 'inherit',
    shell: useShell,
    env: { ...process.env, ...env },
  });
  if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${res.status}`);
};

export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL;
  if (!url || url === process.env.DATABASE_URL) {
    throw new Error('E2E_DATABASE_URL must be set and differ from DATABASE_URL.');
  }

  run('node', ['scripts/with-test-db.mjs', '--e2e', 'npx', 'prisma', 'migrate', 'deploy']);

  const client = new pg.Client({ connectionString: url });
  await client.connect();
  await client.query(
    'TRUNCATE TABLE audit_events, activities, contacts, sessions, password_reset_tokens, invitations, users, agencies RESTART IDENTITY CASCADE',
  );

  const password = () => randomBytes(18).toString('base64url');
  const creds = {
    owner: { email: 'owner@e2e.test', password: password() },
    salesA: { email: 'sales.a@e2e.test', password: password() },
    salesB: { email: 'sales.b@e2e.test', password: password() },
  };

  run(
    'npm',
    [
      'run',
      'bootstrap:owner',
      '--',
      '--agency',
      'E2E Studio',
      '--name',
      'Erin Owner',
      '--email',
      creds.owner.email,
    ],
    { DATABASE_URL: url, BOOTSTRAP_OWNER_PASSWORD: creds.owner.password },
  );

  const { rows } = await client.query<{ id: string }>('SELECT id FROM agencies LIMIT 1');
  const agencyId = rows[0]!.id;
  for (const [key, name] of [
    ['salesA', 'Sami Ahmed'],
    ['salesB', 'Basma Nabil'],
  ] as const) {
    const passwordHash = await hash(creds[key].password, {
      algorithm: 2,
      memoryCost: 19_456,
      timeCost: 2,
      parallelism: 1,
    });
    await client.query(
      `INSERT INTO users (id, agency_id, email_norm, name, password_hash, role, updated_at)
       VALUES (gen_random_uuid(), $1, $2, $3, $4, 'SALES', now())`,
      [agencyId, creds[key].email, name, passwordHash],
    );
  }
  await client.end();

  rmSync('e2e/.mail-sink', { recursive: true, force: true });
  mkdirSync('e2e/.auth', { recursive: true });
  writeFileSync('e2e/.auth/credentials.json', JSON.stringify(creds, null, 2));
}
