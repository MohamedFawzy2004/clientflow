// M3 gate: lead-to-deal end to end on the real API + PostgreSQL (spec §18 "Lead-to-deal E2E pass"),
// plus axe and 360px checks on the new sales screens.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

const SHOTS = 'docs/milestones/m3-screenshots';
const creds = () =>
  JSON.parse(readFileSync('e2e/.auth/credentials.json', 'utf8')) as Record<
    'owner' | 'salesA' | 'salesB',
    { email: string; password: string }
  >;

async function signIn(page: Page, who: { email: string; password: string }) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(who.email);
  await page.getByLabel(/^Password/).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

async function noSeriousA11y(page: Page) {
  // Audit the settled page: a toast mid-fade has transient, partial-opacity text.
  await page.waitForFunction(() =>
    document.getAnimations().every((a) => a.playState !== 'running'),
  );
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(
    serious.map(
      (v) =>
        `${v.id}: ${v.help} (${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')})`,
    ),
  ).toEqual([]);
}

async function noOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
  }));
  expect(sw).toBeLessThanOrEqual(iw);
}

let dealUrl = '';
let leadUrl = '';

test.describe.serial('M3 lead-to-deal journey', () => {
  test('salesperson creates a lead, logs a call and opens a deal from it', async ({ page }) => {
    await signIn(page, creds().salesA);
    await page.goto('/app/leads');
    await page.getByRole('button', { name: 'Add lead' }).first().click();
    const add = page.getByRole('dialog', { name: 'Add lead' });
    await add.getByLabel(/^Full name/).fill('Karim Nasser');
    await add.getByLabel(/^Company/).fill('Nasser Pharmacies');
    await add.getByRole('button', { name: 'Save lead' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Karim Nasser' })).toBeVisible();
    leadUrl = page.url();

    // Timeline: log a call (stored and shown as plain text).
    await page.getByRole('radio', { name: 'Call' }).click();
    await page
      .getByLabel(/^What happened on the call/)
      .fill('Wants delivery tracking. <b>urgent</b>');
    await page.getByRole('button', { name: 'Save call' }).click();
    await expect(page.getByText('Call logged by Sami Ahmed')).toBeVisible();
    await expect(page.getByText('Wants delivery tracking. <b>urgent</b>')).toBeVisible();
    await noSeriousA11y(page);

    // New deal from the lead page.
    await page.getByRole('button', { name: 'New deal' }).click();
    const form = page.getByRole('dialog', { name: 'New deal' });
    await form.getByLabel(/^Deal name/).fill('Delivery tracking app');
    await form.getByLabel(/^Value/).fill('12.345');
    await form.getByRole('button', { name: 'Create deal' }).click();
    await expect(form.getByText(/at most 2 decimals/)).toBeVisible();
    await form.getByLabel(/^Value/).fill('245,000.50');
    await form.getByLabel(/^Next step(?! due)/).fill('Send discovery questions');
    await form.getByRole('button', { name: 'Create deal' }).click();

    await expect(
      page.getByRole('heading', { level: 1, name: 'Delivery tracking app' }),
    ).toBeVisible();
    await expect(page.getByText('EGP 245,000.50')).toBeVisible();
    dealUrl = page.url();
  });

  test('stage moves through the keyboard-accessible control; board totals are exact', async ({
    page,
  }) => {
    await signIn(page, creds().salesA);
    await page.goto('/app/deals');
    const select = page.getByLabel('Move Delivery tracking app to stage');
    await select.selectOption({ label: 'Move to Discovery call' });
    await expect(page.getByText('Moved to Discovery call')).toBeVisible();
    const column = page.getByRole('region', { name: /^Discovery call: 1 deals/ });
    await expect(column.getByText('EGP 245,000.50').first()).toBeVisible();
    await noSeriousA11y(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, `${SHOTS}/board-1440.png`);
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await shot(page, `${SHOTS}/board-360.png`);
  });

  test('a salesperson cannot confirm a win; a manager-level user can, with a reason', async ({
    page,
    browser,
  }) => {
    await signIn(page, creds().salesA);
    await page.goto(dealUrl);
    await expect(page.getByRole('button', { name: 'Mark won' })).toBeDisabled();
    // The API agrees, not just the UI.
    const id = dealUrl.split('/').pop()!;
    const csrf = await page.evaluate(
      async () => (await (await fetch('/api/v1/auth/csrf')).json()).data.csrfToken,
    );
    const res = await page.request.post(`/api/v1/deals/${id}/close`, {
      headers: { 'X-CSRF-Token': csrf, Origin: new URL(page.url()).origin },
      data: { outcome: 'WON', version: 2, overrideReason: 'Trying anyway' },
    });
    expect(res.status()).toBe(403);

    const owner = await browser.newContext();
    const ownerPage = await owner.newPage();
    await signIn(ownerPage, creds().owner);
    await ownerPage.goto(dealUrl);
    await ownerPage.getByRole('button', { name: 'Mark won' }).click();
    const dialog = ownerPage.getByRole('dialog', { name: 'Confirm this win without a proposal?' });
    await dialog.getByLabel(/^Why is it won/).fill('Signed PO received (fictional)');
    await dialog.getByRole('button', { name: 'Mark won' }).click();
    await expect(ownerPage.getByText('This deal is won')).toBeVisible();
    await noSeriousA11y(ownerPage);
    await ownerPage.setViewportSize({ width: 1440, height: 900 });
    await shot(ownerPage, `${SHOTS}/deal-won-1440.png`, { fullPage: true });

    // Winning converted the lead into a customer, with continuous history.
    await ownerPage.goto(leadUrl);
    await expect(ownerPage.getByText('Customer', { exact: true })).toBeVisible();
    await expect(
      ownerPage.getByText(/Became a customer when “Delivery tracking app” was won/),
    ).toBeVisible();
    await owner.close();
  });

  test('losing a deal requires a reason; follow-ups list items without a next step', async ({
    page,
  }) => {
    await signIn(page, creds().salesA);
    await page.goto(leadUrl);
    await page.getByRole('button', { name: 'New deal' }).click();
    const form = page.getByRole('dialog', { name: 'New deal' });
    await form.getByLabel(/^Deal name/).fill('Loyalty program');
    await form.getByLabel(/^Value/).fill('1000');
    await form.getByLabel(/^Currency/).selectOption('USD');
    await form.getByRole('button', { name: 'Create deal' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Loyalty program' })).toBeVisible();
    await expect(page.getByText('USD 1,000.00')).toBeVisible();

    await page.goto('/app/follow-ups');
    await expect(page.getByRole('region', { name: 'No next step' })).toContainText(
      'Loyalty program',
    );
    await noSeriousA11y(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await shot(page, `${SHOTS}/follow-ups-360.png`, { fullPage: true });

    await page.setViewportSize({ width: 1280, height: 900 });
    await page.getByRole('link', { name: /Loyalty program/ }).click();
    await page.getByRole('button', { name: 'Mark lost' }).click();
    const lost = page.getByRole('dialog', { name: 'Mark deal as lost?' });
    await lost.getByRole('button', { name: 'Mark lost' }).click();
    await expect(lost.getByText('Write at least 3 characters.')).toBeVisible();
    await lost.getByLabel(/^Why was it lost/).fill('Budget moved to next year');
    await lost.getByRole('button', { name: 'Mark lost' }).click();
    await expect(page.getByText('Reason: Budget moved to next year')).toBeVisible();
  });

  test('another salesperson cannot see these deals', async ({ page }) => {
    await signIn(page, creds().salesB);
    await page.goto(dealUrl);
    await expect(page.getByText('Deal not found')).toBeVisible();
    const res = await page.request.get(`/api/v1/deals/${dealUrl.split('/').pop()}`);
    expect(res.status()).toBe(404);
  });
});
