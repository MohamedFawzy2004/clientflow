// Runs a command with DATABASE_URL pointed at TEST_DATABASE_URL (or E2E_DATABASE_URL with --e2e).
// Usage: node scripts/with-test-db.mjs [--e2e] <command> [...args]
import { spawnSync } from 'node:child_process';
import 'dotenv/config';

const args = process.argv.slice(2);
const useE2e = args[0] === '--e2e';
if (useE2e) args.shift();

const key = useE2e ? 'E2E_DATABASE_URL' : 'TEST_DATABASE_URL';
const url = process.env[key];
if (!url) {
  console.error(`${key} is not set (see .env.example).`);
  process.exit(1);
}
if (url === process.env.DATABASE_URL) {
  console.error(`${key} must differ from DATABASE_URL so development data is never reset.`);
  process.exit(1);
}

const [cmd, ...rest] = args;
const result = spawnSync(cmd, rest, {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, DATABASE_URL: url, NODE_ENV: 'test' },
});
process.exit(result.status ?? 1);
