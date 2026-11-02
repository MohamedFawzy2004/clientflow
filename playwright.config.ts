import { defineConfig } from '@playwright/test';
import 'dotenv/config';

// E2E runs against its own database (E2E_DATABASE_URL) and its own ports, so it never touches
// development data or a dev server that is already running.
const API_PORT = 4100;
const WEB_PORT = 5174;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

export default defineConfig({
  testDir: 'e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  use: {
    baseURL: WEB_ORIGIN,
    // Uses the Microsoft Edge already installed on Windows. No browser download needed.
    channel: process.env.PLAYWRIGHT_CHANNEL ?? 'msedge',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Plain tsx: `tsx watch` stalls when spawned without a terminal (seen on Windows).
      command: 'npm run dev:once -w @clientflow/api',
      url: `http://127.0.0.1:${API_PORT}/health/ready`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
        API_PORT: String(API_PORT),
        APP_ORIGINS: WEB_ORIGIN,
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
      },
    },
    {
      command: `npm run dev -w @clientflow/web -- --port ${WEB_PORT}`,
      url: WEB_ORIGIN,
      reuseExistingServer: false,
      timeout: 60_000,
      env: { VITE_API_PROXY_TARGET: `http://127.0.0.1:${API_PORT}` },
    },
  ],
});
