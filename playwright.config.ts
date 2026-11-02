import { fileURLToPath } from 'node:url';
import { defineConfig } from '@playwright/test';
import 'dotenv/config';

// E2E runs against its own database (E2E_DATABASE_URL) and its own ports, so it never touches
// development data or a dev server that is already running.
const API_PORT = 4100;
const WEB_PORT = 5174;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const E2E_MAIL_SINK = fileURLToPath(new URL('./e2e/.mail-sink', import.meta.url));
export const E2E_STORAGE = fileURLToPath(new URL('./e2e/.storage', import.meta.url));

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
    // Windows: the installed Edge (no download). CI sets PLAYWRIGHT_CHANNEL=chromium.
    channel:
      process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  webServer: [
    {
      // Plain tsx: `tsx watch` stalls when spawned without a terminal (seen on Windows).
      command: 'npm run dev:once -w @clientflow/api',
      // Liveness, not readiness: Playwright starts servers before global setup migrates the
      // database, and readiness checks tables that do not exist yet on a fresh CI database.
      url: `http://127.0.0.1:${API_PORT}/health/live`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
        API_PORT: String(API_PORT),
        APP_ORIGINS: WEB_ORIGIN,
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        MAIL_TRANSPORT: 'dev-sink',
        // The suite signs in ~50 times from 127.0.0.1 within one 15-minute window. Per-email
        // failure limits stay at their defaults; production refuses these overrides.
        LOGIN_RATE_LIMIT_PER_IP: '500',
        TOKEN_RATE_LIMIT_PER_IP: '200',
        API_RATE_LIMIT_PER_IP: '20000',
        // Separate sink so E2E never reads or deletes development emails.
        MAIL_SINK_DIR: E2E_MAIL_SINK,
        // Separate encrypted file store for E2E uploads.
        FILE_STORAGE_DIR: E2E_STORAGE,
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
