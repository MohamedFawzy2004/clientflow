import { fileURLToPath } from 'node:url';
import { defineConfig, devices } from '@playwright/test';
import 'dotenv/config';

// Demo tour (M12): the main journey of each role on the fictional demo workspace, in Chromium
// (Edge on Windows), Firefox and WebKit. Global setup rebuilds the demo with the real
// `demo:reset`, so it needs DEMO_DATABASE_URL: a database whose name contains "demo".
//
//   npm run demo:tour                      all three engines
//   npm run demo:tour -- --project=firefox one engine
//   CAPTURE_SCREENSHOTS=1 npm run demo:tour -- --project=chromium   also saves screenshots
const API_PORT = 4200;
const WEB_PORT = 5175;
const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;
export const DEMO_STORAGE = fileURLToPath(new URL('./e2e/.demo-storage', import.meta.url));

const desktop = { viewport: { width: 1280, height: 800 } };

export default defineConfig({
  testDir: 'e2e/demo',
  globalSetup: './e2e/demo/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  timeout: 60_000,
  use: { baseURL: WEB_ORIGIN, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...desktop,
        channel:
          process.env.PLAYWRIGHT_CHANNEL ?? (process.platform === 'win32' ? 'msedge' : 'chromium'),
      },
    },
    { name: 'firefox', use: { ...devices['Desktop Firefox'], ...desktop } },
    { name: 'webkit', use: { ...devices['Desktop Safari'], ...desktop } },
  ],
  webServer: [
    {
      command: 'npm run dev:once -w @clientflow/api',
      url: `http://127.0.0.1:${API_PORT}/health/live`,
      reuseExistingServer: false,
      timeout: 60_000,
      env: {
        DATABASE_URL: process.env.DEMO_DATABASE_URL ?? '',
        API_PORT: String(API_PORT),
        APP_ORIGINS: WEB_ORIGIN,
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        DEMO_MODE: 'true',
        MAIL_TRANSPORT: 'disabled',
        // Three engines sign in as each role from one address.
        LOGIN_RATE_LIMIT_PER_IP: '500',
        FILE_STORAGE_DIR: DEMO_STORAGE,
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
