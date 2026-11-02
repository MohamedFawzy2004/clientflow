// Rebuilds the demo workspace with the real `demo:reset` command (and its safety checks) before
// the tour. The database must be DEMO_DATABASE_URL, never the development or E2E database.
import { spawnSync } from 'node:child_process';
import 'dotenv/config';
import { DEMO_STORAGE } from '../../playwright.demo.config';

export default function globalSetup() {
  const url = process.env.DEMO_DATABASE_URL;
  if (!url || url === process.env.DATABASE_URL || url === process.env.E2E_DATABASE_URL) {
    throw new Error('Set DEMO_DATABASE_URL to a separate database whose name contains "demo".');
  }
  const database = new URL(url).pathname.slice(1);
  const env = {
    ...process.env,
    DATABASE_URL: url,
    DEMO_MODE: 'true',
    MAIL_TRANSPORT: 'disabled',
    FILE_STORAGE_DIR: DEMO_STORAGE,
  };
  const useShell = process.platform === 'win32';
  const steps: Array<[string, string[]]> = [
    ['npx', ['prisma', 'migrate', 'deploy']],
    ['npm', ['run', 'demo:reset', '--silent', '--', '--confirm', database]],
  ];
  for (const [cmd, args] of steps) {
    const res = spawnSync(cmd, args, { stdio: 'inherit', shell: useShell, env });
    if (res.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed with ${res.status}`);
  }
}
