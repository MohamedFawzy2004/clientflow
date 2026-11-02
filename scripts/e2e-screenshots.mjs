// Runs the E2E suite and saves the review screenshots into docs/milestones/*-screenshots.
import { spawnSync } from 'node:child_process';

const result = spawnSync('npx', ['playwright', 'test', ...process.argv.slice(2)], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
  env: { ...process.env, CAPTURE_SCREENSHOTS: '1' },
});
process.exit(result.status ?? 1);
