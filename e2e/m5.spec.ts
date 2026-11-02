// M5 gate: dashboard with filters, reminders, CSV export, agency settings and proposal PDF on the
// real API + PostgreSQL; a real drag-and-drop on the board; and a WCAG/360px smoke sweep over
// every main screen for the owner and a salesperson (spec §18 "Security and WCAG smoke gate").
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { shot } from './shot';

const SHOTS = 'docs/milestones/m5-screenshots';
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

async function noSeriousA11y(page: Page, where: string) {
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
        `${where} ${v.id}: ${v.help} (${v.nodes
          .map((n) => n.target.join(' '))
          .slice(0, 3)
          .join(', ')})`,
    ),
  ).toEqual([]);
}

async function noOverflow(page: Page, where: string) {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
  }));
  expect({ where, overflow: sw > iw }).toEqual({ where, overflow: false });
}

/** JSON API call with the page's session and CSRF token (setup steps, not what is under test). */
async function api(page: Page, method: 'POST' | 'PUT' | 'PATCH', path: string, data: object) {
  const csrf = await page.evaluate(
    async () => (await (await fetch('/api/v1/auth/csrf')).json()).data.csrfToken,
  );
  const req: APIRequestContext = page.request;
  const res = await req.fetch(path, {
    method,
    data,
    headers: { 'X-CSRF-Token': csrf, Origin: new URL(page.url()).origin },
  });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()).data;
}

test.describe.serial('M5 sales MVP', () => {
  test('drag a deal card to another stage on the board', async ({ page }) => {
    await signIn(page, creds().salesA);
    const lead = await api(page, 'POST', '/api/v1/contacts', { fullName: 'Dina Drag' });
    await api(page, 'POST', '/api/v1/deals', {
      contactId: lead.id,
      title: 'Drag test deal',
      amount: '1000',
      currency: 'EGP',
    });
    await page.goto('/app/deals');
    const card = page.getByRole('listitem').filter({ hasText: 'Drag test deal' });
    const target = page.getByRole('region', { name: /^Proposal:/ });
    await card.dragTo(target);
    await expect(page.getByText('Moved to Proposal')).toBeVisible();
    await expect(target.getByRole('link', { name: 'Drag test deal' })).toBeVisible();
  });

  test('a salesperson sees their own numbers, reminders and can download a proposal PDF', async ({
    page,
  }) => {
    await signIn(page, creds().salesA);
    // An overdue follow-up and a submitted proposal, created through the API.
    const lead = await api(page, 'POST', '/api/v1/contacts', { fullName: 'Late Lina' });
    await api(page, 'PATCH', `/api/v1/contacts/${lead.id}`, {
      version: 1,
      nextActionAt: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    });
    const deal = await api(page, 'POST', '/api/v1/deals', {
      contactId: lead.id,
      title: 'PDF test deal',
      amount: '5000',
      currency: 'EGP',
    });
    const proposal = await api(page, 'POST', '/api/v1/proposals', { dealId: deal.id });
    const saved = await api(page, 'PUT', `/api/v1/proposals/${proposal.id}/draft`, {
      version: 1,
      title: 'PDF test proposal',
      expiresOn: '2099-12-31',
      discountPercent: '0',
      taxRatePercent: '14',
      taxLabel: 'VAT',
      items: [{ name: 'Workshop', unit: 'day', quantity: '1', unitPrice: '5000' }],
    });
    await api(page, 'POST', `/api/v1/proposals/${proposal.id}/submit`, {
      version: saved.current.version,
    });

    await page.goto('/app/dashboard');
    await expect(page.getByText(/your records/)).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Owner' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: /Export deals/ })).toHaveCount(0);
    const attention = page.getByRole('region', { name: 'Needs your attention' });
    await expect(attention.getByText('Late Lina')).toBeVisible();
    await expect(
      page.getByRole('link', { name: /Reminders: \d+ need attention/ }).first(),
    ).toBeVisible();

    await page.goto(`/app/proposals/${proposal.id}`);
    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: 'PDF of version 1' }).click();
    const file = await download;
    expect(file.suggestedFilename()).toMatch(/^P-\d{4}-v1\.pdf$/);
    const bytes = readFileSync((await file.path())!);
    expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
  });

  test('a manager filters by owner, exports CSV and sees reviews waiting', async ({ page }) => {
    await signIn(page, creds().owner);
    await page.goto('/app/dashboard');
    await expect(page.getByText(/whole agency/)).toBeVisible();
    const review = page.getByRole('region', { name: 'Needs your attention' });
    await expect(review.getByText(/Waiting for your review/).first()).toBeVisible();

    await page.getByRole('combobox', { name: 'Owner' }).selectOption({ label: 'Sami Ahmed' });
    await expect(page).toHaveURL(/ownerId=/);
    await expect(page.getByText(/Sami Ahmed\. Money is totalled per currency/)).toBeVisible();
    await noSeriousA11y(page, 'dashboard');
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, `${SHOTS}/dashboard-1440.png`, { fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page, 'dashboard 360');
    await shot(page, `${SHOTS}/dashboard-360.png`, { fullPage: true });
    await page.setViewportSize({ width: 1280, height: 900 });

    const download = page.waitForEvent('download');
    await page.getByRole('link', { name: /Export deals/ }).click();
    const csv = readFileSync((await (await download).path())!, 'utf8');
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.split('\r\n')[0]).toBe(
      '﻿"Deal","Contact","Company","Owner","Stage","Status","Currency","Amount","Created","Closed","Lost reason"',
    );
    expect(csv).toContain('"PDF test deal"');
  });

  test('the owner updates agency settings', async ({ page }) => {
    await signIn(page, creds().owner);
    await page.goto('/app/settings');
    await page.getByLabel(/^Phone/).fill('+20 2 1234 5678');
    await page.getByRole('checkbox', { name: 'Sat' }).check();
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('All changes saved')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/^Phone/)).toHaveValue('+20 2 1234 5678');
    await expect(page.getByRole('checkbox', { name: 'Sat' })).toBeChecked();
    await page.getByLabel(/^Time zone/).fill('Mars/Olympus');
    await page.getByRole('button', { name: 'Save settings' }).click();
    await expect(page.getByText('Use a time zone name such as Africa/Cairo.')).toBeVisible();
    await noSeriousA11y(page, 'settings');
  });
});

// WCAG + responsive smoke over every main screen, per role (M5 gate).
const SCREENS: Record<'owner' | 'salesA', string[]> = {
  owner: [
    '/app/dashboard',
    '/app/reminders',
    '/app/follow-ups',
    '/app/leads',
    '/app/deals',
    '/app/proposals',
    '/app/services',
    '/app/team',
    '/app/settings',
  ],
  salesA: [
    '/app/dashboard',
    '/app/reminders',
    '/app/leads',
    '/app/deals',
    '/app/proposals',
    '/app/services',
  ],
};

for (const who of ['owner', 'salesA'] as const) {
  test(`WCAG and 360px smoke: every main screen for ${who}`, async ({ page }) => {
    test.setTimeout(120_000);
    await signIn(page, creds()[who]);
    for (const width of [1440, 360]) {
      await page.setViewportSize({ width, height: 900 });
      for (const path of SCREENS[who]) {
        await page.goto(path);
        await expect(page.locator('main h1').first()).toBeVisible();
        await noSeriousA11y(page, `${who} ${path} @${width}`);
        await noOverflow(page, `${who} ${path} @${width}`);
      }
    }
  });
}
