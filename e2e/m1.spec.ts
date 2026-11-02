// M1 end-to-end journey on a real API + PostgreSQL: sign in, add a lead, find it, enforce
// isolation between salespeople, sign out. Also captures the spec §7.6 viewport screenshots and
// runs axe accessibility checks.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

const creds = () =>
  JSON.parse(readFileSync('e2e/.auth/credentials.json', 'utf8')) as Record<
    'owner' | 'salesA' | 'salesB',
    { email: string; password: string }
  >;

const VIEWPORTS = [360, 390, 768, 1024, 1280, 1440, 1920] as const;
const SHOTS = 'docs/milestones/m1-screenshots';

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(who.email);
  await page.getByLabel(/^Password/).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

async function expectNoHorizontalOverflow(page: Page) {
  const { scrollWidth, innerWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(scrollWidth, 'page must not scroll horizontally').toBeLessThanOrEqual(innerWidth);
}

async function expectNoSeriousA11yViolations(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help} (${v.nodes.length})`)).toEqual([]);
}

let leadUrl = '';

test.describe.serial('M1 journey', () => {
  test('unauthenticated users are sent to sign in', async ({ page }) => {
    await page.goto('/app/leads');
    await expect(page).toHaveURL(/\/login\?next=%2Fapp%2Fleads/);
    await expect(page.getByRole('heading', { name: 'Sign in' })).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('wrong password shows one generic error', async ({ page }) => {
    await page.goto('/login');
    await page.getByLabel(/^Email/).fill(creds().salesA.email);
    await page.getByLabel(/^Password/).fill('not-the-right-password');
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
  });

  test('sales A adds a lead and finds it again', async ({ page }) => {
    await signIn(page, creds().salesA);
    await page.getByRole('link', { name: 'Leads' }).first().click();
    await expect(page.getByText('No leads yet')).toBeVisible();

    await page.getByRole('button', { name: 'Add lead' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add lead' });
    await expectNoSeriousA11yViolations(page);
    await dialog.getByLabel(/^Full name/).fill('Salma Ibrahim');
    await dialog.getByLabel(/^Email/).fill('Salma@Nile-Bakery.test');
    await dialog.getByLabel(/^Phone/).fill('+20 100 555 0101');
    await dialog.getByLabel(/^Company/).fill('Nile Bakery Co.');
    await dialog.getByLabel(/^Source/).selectOption('REFERRAL');
    await dialog.getByLabel(/^Notes/).fill('Wants online ordering. <img src=x onerror=alert(1)>');
    await dialog.getByRole('button', { name: 'Save lead' }).click();

    await expect(page.getByRole('heading', { level: 1, name: 'Salma Ibrahim' })).toBeVisible();
    await expect(page.getByText('salma@nile-bakery.test')).toBeVisible();
    await expect(page.getByText('Lead added by Sami Ahmed')).toBeVisible();
    await expect(page.getByText('<img src=x onerror=alert(1)>', { exact: false })).toBeVisible();
    expect(await page.locator('main img').count()).toBe(0);
    leadUrl = page.url();

    // Persisted: a full reload reads it back from PostgreSQL.
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Salma Ibrahim' })).toBeVisible();

    await page.goto('/app/leads');
    await page.getByLabel('Search leads').fill('nile');
    await expect(page.getByRole('link', { name: 'Salma Ibrahim' })).toBeVisible();
    await expect(page.getByText('1–1 of 1')).toBeVisible();
    await page.getByLabel('Search leads').fill('no-such-lead');
    await expect(page.getByText('No leads match these filters')).toBeVisible();
    await expectNoSeriousA11yViolations(page);
  });

  test('sales B cannot see or open sales A’s lead', async ({ page }) => {
    expect(leadUrl).toContain('/app/leads/');
    await signIn(page, creds().salesB);
    await page.goto('/app/leads');
    await expect(page.getByText('No leads yet')).toBeVisible();
    await page.goto(leadUrl);
    await expect(page.getByText('Lead not found')).toBeVisible();
    await expect(page.getByText('Salma')).toHaveCount(0);

    // Direct API call with B's session: same 404, no data.
    const res = await page.request.get(leadUrl.replace('/app/leads/', '/api/v1/contacts/'));
    expect(res.status()).toBe(404);
    expect(await res.text()).not.toContain('Salma');
  });

  test('the owner sees every lead; sign-out ends the session', async ({ page }) => {
    await signIn(page, creds().owner);
    await page.goto('/app/leads');
    await expect(page.getByRole('link', { name: 'Salma Ibrahim' })).toBeVisible();
    await page.getByRole('button', { name: 'Sign out' }).first().click();
    await expect(page).toHaveURL(/\/login/);
    const me = await page.request.get('/api/v1/auth/me');
    expect(me.status()).toBe(401);
    await page.goto('/app/leads');
    await expect(page).toHaveURL(/\/login/);
  });

  test('screenshots and overflow checks at spec viewports', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/login');
    await shot(page, `${SHOTS}/login-1440.png`);
    await page.setViewportSize({ width: 360, height: 780 });
    await expectNoHorizontalOverflow(page);
    await shot(page, `${SHOTS}/login-360.png`);

    await signIn(page, creds().salesA);
    for (const width of VIEWPORTS) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await page.goto('/app/leads');
      await expect(page.getByRole('link', { name: 'Salma Ibrahim' }).first()).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shot(page, `${SHOTS}/leads-${width}.png`);
    }
    for (const width of [360, 1440] as const) {
      await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
      await page.goto(leadUrl);
      await expect(page.getByRole('heading', { level: 1, name: 'Salma Ibrahim' })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await shot(page, `${SHOTS}/lead-detail-${width}.png`, { fullPage: true });

      await page.goto('/app/leads');
      await page.getByRole('button', { name: 'Add lead' }).last().click();
      const dialog = page.getByRole('dialog', { name: 'Add lead' });
      await expect(dialog).toBeVisible();
      await page.waitForTimeout(300);
      const box = (await dialog.boundingBox())!;
      const viewport = page.viewportSize()!;
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
      await expect(dialog.getByRole('button', { name: 'Save lead' })).toBeInViewport();
      await shot(page, `${SHOTS}/add-lead-${width}.png`);
      await page.keyboard.press('Escape');
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/app/dashboard');
    await expect(page.getByRole('region', { name: 'Open pipeline' })).toBeVisible();
    await shot(page, `${SHOTS}/dashboard-1440.png`);
  });

  test('keyboard: skip link and dialog focus management', async ({ page, browserName }) => {
    // WebKit (like Safari) skips links on Tab unless the user turns on full keyboard access.
    test.skip(browserName === 'webkit', 'Tab skips links by default in WebKit.');
    await signIn(page, creds().salesA);
    await page.goto('/app/leads');
    // Wait for the shell: before the session check finishes there is nothing to focus.
    await expect(page.getByRole('link', { name: 'Salma Ibrahim' }).first()).toBeVisible();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
    await page.getByRole('button', { name: 'Add lead' }).first().focus();
    await page.keyboard.press('Enter');
    await expect(
      page.getByRole('dialog', { name: 'Add lead' }).getByLabel(/^Full name/),
    ).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add lead' }).first()).toBeFocused();
  });
});
