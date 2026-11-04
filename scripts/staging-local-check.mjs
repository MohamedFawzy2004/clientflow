// Runs scripts/staging-check.mjs against LOCAL staging (docker-compose.staging.yml, ADR-071).
// Caddy signs the HTTPS certificate with its own local authority, so its root certificate is
// copied out of the container once and trusted for this run only (NODE_EXTRA_CA_CERTS): nothing
// is added to the machine's certificate store.
//
//   npm run staging:check -- --email you@agency.test [--password-file f] [--code 123456]
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ca = 'deploy/staging/caddy-root.crt'; // gitignored (*.crt)
const compose = [
  'compose',
  '-f',
  'docker-compose.staging.yml',
  '--env-file',
  'deploy/staging/.env.staging',
];

if (!existsSync(`${root}${ca}`)) {
  const cp = spawnSync(
    'docker',
    [...compose, 'cp', 'caddy:/data/caddy/pki/authorities/local/root.crt', ca],
    { cwd: root, stdio: 'inherit' },
  );
  if (cp.status !== 0) {
    console.error('Could not copy the Caddy root certificate. Is local staging running?');
    process.exit(2);
  }
}

const run = spawnSync(
  process.execPath,
  [
    'scripts/staging-check.mjs',
    '--base',
    'https://127.0.0.1:8443',
    '--http-base',
    'http://127.0.0.1:8080',
    ...process.argv.slice(2),
  ],
  { cwd: root, stdio: 'inherit', env: { ...process.env, NODE_EXTRA_CA_CERTS: `${root}${ca}` } },
);
process.exit(run.status ?? 1);
