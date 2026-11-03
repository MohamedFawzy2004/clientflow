// QA release suite: browser-level negative and edge cases that the milestone specs do not cover.
// Expired sessions, Back after sign-out, refresh on a deep link, failed and slow API requests,
// a double-clicked save, and a responsive sweep of the main staff and portal screens at every
// spec width. Runs against the real API + PostgreSQL like the other specs and needs only the
// users from global setup (it creates its own client organisation).
import { randomBytes } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import pg from 'pg';
import 'dotenv/config';
import { acceptInvite, api, asUser, creds, noOverflow, signIn } from './support';

const WIDTHS = [360, 390, 768, 1024, 1280, 1440, 1920] as const;
// Random per run, like global setup's passwords: no fixture passphrase in the repository.
const CLIENT = {
  email: 'qa.client@river.test',
  name: 'Qamar Saad',
  password: `Qa-${randomBytes(12).toString('base64url')}-7`,
};

/** Ends every live session of a user in the database, as an idle or absolute timeout would. */
async function expireSessions(email: string) {
  const db = new pg.Client({ connectionString: process.env.E2E_DATABASE_URL });
  await db.connect();
  try {
    const res = await db.query(
      `UPDATE sessions SET expires_at = now() - interval '1 second'
        WHERE revoked_at IS NULL AND user_id IN (SELECT id FROM users WHERE email_norm = lower($1))`,
      [email],
    );
    expect(res.rowCount, 'the user had a live session').toBeGreaterThan(0);
  } finally {
    await db.end();
  }
}

async function leadsPageReady(page: Page) {
  await expect(page.getByRole('heading', { level: 1, name: /Leads/ })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
}

test.describe('QA: sessions and navigation', () => {
  test('a session that expires mid-use sends the user to sign in, then back to the same page', async ({
    page,
  }) => {
    const who = creds().salesA;
    await signIn(page, who);
    await page.goto('/app/leads');
    await leadsPageReady(page);

    await expireSessions(who.email);
    // In-app navigation: the next API call answers 401, and the app must say why instead of
    // showing stale data or a raw error.
    await page
      .getByRole('navigation', { name: 'Main' })
      .getByRole('link', { name: 'Deals' })
      .first()
      .click();
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fdeals.*expired=1/);
    await expect(page.getByText('Your session ended.')).toBeVisible();

    await page.getByLabel(/^Email/).fill(who.email);
    await page.getByLabel(/^Password/).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app\/deals$/);
  });

  test('a full reload with an expired session goes to sign in and keeps the page to return to', async ({
    page,
  }) => {
    const who = creds().salesA;
    await signIn(page, who);
    await page.goto('/app/leads');
    await leadsPageReady(page);
    await expireSessions(who.email);
    await page.goto('/app/deals');
    // On a fresh load the app cannot tell "expired" from "never signed in", so no banner here.
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fdeals/);
    await expect(page.getByRole('heading', { level: 1, name: /Deals/ })).toHaveCount(0);
  });

  test('after sign-out, Back and refresh never show the signed-in screens again', async ({
    page,
  }) => {
    await signIn(page, creds().salesA);
    await page.goto('/app/leads');
    await leadsPageReady(page);
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(page).toHaveURL(/\/login/);

    await page.goBack();
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { level: 1, name: /Leads/ })).toHaveCount(0);
    await page.reload();
    await expect(page).toHaveURL(/\/login/);
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(401);
  });

  test('refresh on a deep link keeps the user on that page; unknown routes say not found', async ({
    page,
  }) => {
    await signIn(page, creds().owner);
    await page.goto('/app/deals');
    await page.reload();
    await expect(page).toHaveURL(/\/app\/deals$/);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();

    await page.goto('/app/no-such-screen');
    await expect(page.getByText(/not found|doesn.t exist|could not find/i).first()).toBeVisible();
  });
});

test.describe('QA: failed and slow requests', () => {
  test('a failing list shows a retryable error with a reference, and Try again recovers', async ({
    page,
  }) => {
    await signIn(page, creds().salesA);
    let failed = 0;
    await page.route('**/api/v1/contacts?**', async (route) => {
      failed++;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        headers: { 'x-request-id': 'qa-req-503' },
        body: JSON.stringify({
          error: {
            code: 'SERVICE_UNAVAILABLE',
            message: 'The service is temporarily unavailable.',
            fieldErrors: {},
            requestId: 'qa-req-503',
          },
        }),
      });
    });
    await page.goto('/app/leads');
    const alert = page.getByRole('alert').filter({ hasText: 'qa-req-503' });
    await expect(alert).toBeVisible({ timeout: 20_000 });
    // Queries retry 5xx twice (providers.tsx), then stop: no endless polling of a failing API.
    // (The dev server's React StrictMode can add one more mount, so count bounds, not exact.)
    const atError = failed;
    expect(atError).toBeGreaterThanOrEqual(3);
    expect(atError).toBeLessThanOrEqual(4);
    await page.waitForTimeout(4_000);
    expect(failed, 'no retries after the error is shown').toBe(atError);

    await page.unroute('**/api/v1/contacts?**');
    await alert.getByRole('button', { name: 'Try again' }).click();
    await leadsPageReady(page);
  });

  test('a slow API (3 s) never shows an error, then shows the data', async ({ page }) => {
    await signIn(page, creds().salesA);
    await page.route('**/api/v1/contacts?**', async (route) => {
      await new Promise((r) => setTimeout(r, 3_000));
      await route.continue();
    });
    await page.goto('/app/leads');
    await expect(page.getByRole('heading', { level: 1, name: /Leads/ })).toBeVisible();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await leadsPageReady(page);
  });

  test('a lost connection while saving keeps the form and creates nothing', async ({ page }) => {
    await signIn(page, creds().salesA);
    await page.goto('/app/leads');
    await leadsPageReady(page);
    const name = `QA Offline ${Date.now()}`;
    await page.getByRole('button', { name: 'Add lead' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add lead' });
    await dialog.getByLabel(/^Full name/).fill(name);
    await page.route('**/api/v1/contacts', (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.continue(),
    );
    await dialog.getByRole('button', { name: 'Save lead' }).click();
    await expect(dialog.getByText(/could not reach ClientFlow/i)).toBeVisible();
    await expect(dialog.getByLabel(/^Full name/)).toHaveValue(name);

    await page.unroute('**/api/v1/contacts');
    const found = await api(page, 'GET', `/api/v1/contacts?q=${encodeURIComponent(name)}`);
    expect(found).toHaveLength(0);
  });

  test('a double-clicked Save lead creates exactly one lead', async ({ page }) => {
    await signIn(page, creds().salesA);
    await page.goto('/app/leads');
    await leadsPageReady(page);
    const name = `QA Double ${Date.now()}`;
    await page.getByRole('button', { name: 'Add lead' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add lead' });
    await dialog.getByLabel(/^Full name/).fill(name);
    // Slow the create down so the second click lands while the first is still in flight.
    await page.route('**/api/v1/contacts', async (route) => {
      if (route.request().method() === 'POST') await new Promise((r) => setTimeout(r, 1_000));
      await route.continue();
    });
    await dialog.getByRole('button', { name: 'Save lead' }).dblclick();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();
    await page.unroute('**/api/v1/contacts');
    const found = await api(page, 'GET', `/api/v1/contacts?q=${encodeURIComponent(name)}`);
    expect(found).toHaveLength(1);
  });
});

test.describe.serial('QA: responsive sweep at every spec width', () => {
  const STAFF: Record<'owner' | 'pm' | 'finance' | 'salesA' | 'member', string[]> = {
    owner: [
      '/app/dashboard',
      '/app/leads',
      '/app/deals',
      '/app/follow-ups',
      '/app/proposals',
      '/app/projects',
      '/app/invoices',
      '/app/reports/finance',
      '/app/team',
      '/app/services',
      '/app/settings',
      '/app/notifications',
      '/app/imports',
    ],
    salesA: ['/app/dashboard', '/app/leads', '/app/deals'],
    pm: ['/app/dashboard', '/app/projects'],
    member: ['/app/dashboard', '/app/projects'],
    finance: ['/app/invoices', '/app/reports/finance', '/app/finance/cost-rates'],
  };

  for (const [who, paths] of Object.entries(STAFF) as [keyof typeof STAFF, string[]][]) {
    test(`${who}: no page-level horizontal scroll on main screens`, async ({ browser }) => {
      const user = await asUser(browser, creds()[who]);
      const failures: string[] = [];
      for (const path of paths) {
        await user.page.goto(path);
        await expect(user.page.getByRole('heading', { level: 1 }).first()).toBeVisible();
        for (const width of WIDTHS) {
          await user.page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
          const { sw, iw } = await user.page.evaluate(() => ({
            sw: document.documentElement.scrollWidth,
            iw: innerWidth,
          }));
          if (sw > iw) failures.push(`${path} @${width}px: scrollWidth ${sw} > ${iw}`);
        }
      }
      await user.close();
      expect(failures).toEqual([]);
    });
  }

  test('portal: a client user’s screens fit every width', async ({ browser }) => {
    const owner = await asUser(browser, creds().owner);
    const contact = await api(owner.page, 'POST', '/api/v1/contacts', {
      fullName: CLIENT.name,
      companyName: 'River QA Co',
    });
    const org = await api(owner.page, 'POST', `/api/v1/contacts/${contact.id}/client-org`, {
      name: 'River QA Co',
    });
    const invite = await api(owner.page, 'POST', `/api/v1/client-orgs/${org.id}/invitations`, {
      email: CLIENT.email,
    });
    await owner.close();
    // Portal invitations are queued for the worker, so the link is returned (as in m8/m9).
    expect(invite.acceptUrl, 'invitation link').toBeTruthy();
    const client = await acceptInvite(browser, invite.acceptUrl, CLIENT);
    const failures: string[] = [];
    for (const path of ['/portal', '/portal/projects', '/portal/invoices']) {
      await client.page.goto(path);
      await expect(client.page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      for (const width of WIDTHS) {
        await client.page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
        try {
          await noOverflow(client.page);
        } catch {
          failures.push(`${path} @${width}px`);
        }
      }
    }
    await client.close();
    expect(failures).toEqual([]);
  });
});
