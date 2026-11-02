// M4 gate: deal → proposal → internal review → portal invitation → send → client acceptance → deal
// won, on the real API + PostgreSQL (spec §18 "Immutable versions + approval race tests"; the race
// tests themselves run in apps/api/tests/proposals.test.ts). Also axe and 360px checks.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

const SHOTS = 'docs/milestones/m4-screenshots';
const creds = () =>
  JSON.parse(readFileSync('e2e/.auth/credentials.json', 'utf8')) as Record<
    'owner' | 'salesA' | 'salesB',
    { email: string; password: string }
  >;
const CLIENT = {
  email: 'hana.fawzi@fawzi.test',
  name: 'Hana Fawzi',
  password: 'amber-orchard-signal-47',
};
const INTERNAL_NOTE = 'Internal only: margin is thin, no further discount';

async function signIn(
  page: Page,
  who: { email: string; password: string },
  home = /\/app\/dashboard$/,
) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(who.email);
  await page.getByLabel(/^Password/).fill(who.password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(home);
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

let proposalUrl = '';
let leadUrl = '';
let dealUrl = '';
let inviteLink = '';

test.describe.serial('M4 proposal journey', () => {
  test('an owner adds a catalog service', async ({ page }) => {
    await signIn(page, creds().owner);
    await page.goto('/app/services');
    await page.getByRole('button', { name: 'Add service' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add service' });
    await dialog.getByLabel(/^Name/).fill('Discovery workshop');
    await dialog.getByLabel(/^Rate/).fill('12,000');
    await dialog.getByLabel(/^Charged per/).fill('day');
    await dialog.getByRole('button', { name: 'Add service' }).click();
    const list = page.getByRole('region', { name: 'Services' });
    await expect(list.getByRole('listitem').filter({ hasText: 'Discovery workshop' })).toHaveCount(
      1,
    );
    await expect(list.getByText(/EGP\s12,000\.00/)).toBeVisible();
    await noSeriousA11y(page);
  });

  test('a salesperson drafts a proposal with exact totals and submits it', async ({ page }) => {
    await signIn(page, creds().salesA);
    await page.goto('/app/leads');
    await page.getByRole('button', { name: 'Add lead' }).first().click();
    const add = page.getByRole('dialog', { name: 'Add lead' });
    await add.getByLabel(/^Full name/).fill('Hany Fawzi');
    await add.getByLabel(/^Company/).fill('Fawzi Logistics');
    await add.getByRole('button', { name: 'Save lead' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Hany Fawzi' })).toBeVisible();
    leadUrl = page.url();

    await page.getByRole('button', { name: 'New deal' }).click();
    const form = page.getByRole('dialog', { name: 'New deal' });
    await form.getByLabel(/^Deal name/).fill('Fleet app');
    await form.getByLabel(/^Value/).fill('30000');
    await form.getByRole('button', { name: 'Create deal' }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Fleet app' })).toBeVisible();
    dealUrl = page.url();

    await page.getByRole('button', { name: 'Create proposal' }).click();
    await expect(page).toHaveURL(/\/app\/proposals\/[0-9a-f-]+$/);
    proposalUrl = page.url();
    await expect(page.getByText('P-0001').first()).toBeVisible();

    await page
      .getByLabel('Add from catalog')
      .selectOption({ label: 'Discovery workshop · EGP 12,000.00 per day' });
    await page
      .getByLabel(/^Quantity/)
      .first()
      .fill('2');
    await page.getByRole('button', { name: 'Custom line' }).click();
    await page.getByLabel(/^Line 2/).fill('Build');
    await page
      .getByLabel(/^Quantity/)
      .nth(1)
      .fill('10');
    await page
      .getByLabel(/^Unit price/)
      .nth(1)
      .fill('850');
    await page.getByLabel(/^Discount %/).fill('10');
    await page.getByLabel(/^Not included/).fill('Hosting and app store fees');
    await page.getByLabel(/^Internal notes/).fill(INTERNAL_NOTE);

    // 2 × 12,000 + 10 × 850 = 32,500; −10% = 29,250; VAT 14% = 4,095; total 33,345.00.
    const price = page.getByRole('region', { name: 'Price (EGP)' });
    await expect(price.getByText(/VAT 14% of EGP\s29,250\.00/)).toBeVisible();
    await expect(price.getByText(/EGP\s33,345\.00/)).toBeVisible();
    await noSeriousA11y(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await shot(page, `${SHOTS}/editor-360.png`, { fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, `${SHOTS}/editor-1440.png`, { fullPage: true });

    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('All changes saved')).toBeVisible();
    await expect(page.getByText(/EGP\s33,345\.00/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Submit for review' }).click();
    await page
      .getByRole('dialog', { name: 'Submit for review?' })
      .getByRole('button', { name: 'Submit' })
      .click();
    await expect(page.getByText(/Waiting for an owner, admin or sales manager/)).toBeVisible();
    // The salesperson cannot approve, in the UI or through the API.
    await expect(page.getByRole('button', { name: 'Approve' })).toHaveCount(0);
  });

  test('a manager approves; sending waits for the client portal', async ({ page }) => {
    await signIn(page, creds().owner);
    await page.goto(proposalUrl);
    await page.getByRole('button', { name: 'Approve' }).click();
    await page
      .getByRole('dialog', { name: 'Approve this version?' })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(page.getByText('Client portal not set up')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Send to client' })).toBeDisabled();

    await page.goto(leadUrl);
    await page.getByRole('button', { name: 'Set up client portal' }).click();
    const setup = page.getByRole('dialog', { name: 'Set up the client portal' });
    await expect(setup.getByLabel(/^Organization name/)).toHaveValue('Fawzi Logistics');
    await setup.getByRole('button', { name: 'Create organization' }).click();
    await page.getByRole('button', { name: 'Invite to portal' }).click();
    const invite = page.getByRole('dialog', { name: /Invite someone at Fawzi Logistics/ });
    await invite.getByLabel(/^Email/).fill(CLIENT.email);
    await invite.getByRole('button', { name: 'Send invitation' }).click();
    inviteLink = await page.getByLabel('Invitation link').inputValue();
    expect(inviteLink).toMatch(/\/activate-invite#token=/);
    await noSeriousA11y(page);
  });

  test('the client accepts the invitation and lands in an empty portal', async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    const url = new URL(inviteLink);
    await page.goto(url.pathname + url.hash);
    await expect(page.getByRole('heading', { name: 'E2E Studio client portal' })).toBeVisible();
    await expect(page.getByText(/review proposals for Fawzi Logistics/)).toBeVisible();
    await page.getByLabel(/^Your name/).fill(CLIENT.name);
    await page.getByLabel(/^Password/).fill(CLIENT.password);
    await page.getByLabel(/^Confirm password/).fill(CLIENT.password);
    await page.getByRole('button', { name: 'Create account and sign in' }).click();
    await expect(page).toHaveURL(/\/portal$/);
    await expect(page.getByText('Nothing to review yet')).toBeVisible();
    // The staff app is not reachable for a portal user, in the UI or the API.
    await page.goto('/app/deals');
    await expect(page).toHaveURL(/\/portal$/);
    expect((await page.request.get('/api/v1/proposals')).status()).toBe(403);
    await context.close();
  });

  test('the owner sends the approved version', async ({ page }) => {
    await signIn(page, creds().owner);
    await page.goto(proposalUrl);
    await expect(page.getByText(/Ready to send to 1 portal user at Fawzi Logistics/)).toBeVisible();
    await page.getByRole('button', { name: 'Send to client' }).click();
    await page
      .getByRole('dialog', { name: 'Send to the client?' })
      .getByRole('button', { name: 'Send' })
      .click();
    await expect(page.getByText('Waiting for the client to respond in the portal.')).toBeVisible();
    await expect(page.getByText(INTERNAL_NOTE)).toBeVisible(); // staff still see it
  });

  test('the client reviews and accepts; the deal is won and the lead becomes a customer', async ({
    page,
    browser,
  }) => {
    await signIn(page, CLIENT, /\/portal$/);
    await page.getByRole('link', { name: 'Fleet app' }).click();
    await expect(page.getByRole('heading', { name: 'Proposal P-0001' })).toBeVisible();
    await expect(page.getByText('Hosting and app store fees')).toBeVisible();
    await expect(page.getByText(/EGP\s33,345\.00/).first()).toBeVisible();
    await expect(page.getByText(INTERNAL_NOTE)).toHaveCount(0);
    await noSeriousA11y(page);
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await shot(page, `${SHOTS}/portal-proposal-360.png`, { fullPage: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, `${SHOTS}/portal-proposal-1440.png`, { fullPage: true });

    const accept = page.getByRole('button', { name: 'Accept proposal' });
    await expect(accept).toBeDisabled();
    await page.getByLabel(/I have read version 1/).check();
    await accept.click();
    await page
      .getByRole('dialog', { name: /Accept P-0001 version 1/ })
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(page.getByText('You accepted this version')).toBeVisible();
    await expect(page.getByText(/Accepted by Hana Fawzi on/)).toBeVisible();

    const staff = await browser.newContext();
    const owner = await staff.newPage();
    await signIn(owner, creds().owner);
    await owner.goto(dealUrl);
    await expect(owner.getByText('This deal is won')).toBeVisible();
    await expect(owner.getByRole('link', { name: 'P-0001 version 1' })).toBeVisible();
    await owner.goto(leadUrl);
    await expect(owner.getByText('Customer', { exact: true })).toBeVisible();
    await owner.goto(proposalUrl);
    await expect(owner.getByText('Accepted by the client').first()).toBeVisible();
    await shot(owner, `${SHOTS}/proposal-accepted-1440.png`, { fullPage: true });
    await staff.close();
  });

  test('another salesperson cannot see the proposal; staff cannot use the portal API', async ({
    page,
  }) => {
    await signIn(page, creds().salesB);
    await page.goto(proposalUrl);
    await expect(page.getByText('Proposal not found')).toBeVisible();
    expect(
      (await page.request.get(`/api/v1/proposals/${proposalUrl.split('/').pop()}`)).status(),
    ).toBe(404);
    expect((await page.request.get('/api/v1/portal/proposals')).status()).toBe(403);
  });
});
