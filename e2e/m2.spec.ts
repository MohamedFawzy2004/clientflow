// M2 end-to-end: invitation → acceptance → deactivation, and forgot → reset password, on the real
// API + PostgreSQL with the dev mail sink. Also screenshots and axe on the new screens.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Page } from '@playwright/test';
import { shot } from './shot';

const SINK = 'e2e/.mail-sink';
const SHOTS = 'docs/milestones/m2-screenshots';
const creds = () =>
  JSON.parse(readFileSync('e2e/.auth/credentials.json', 'utf8')) as Record<
    'owner' | 'salesA' | 'salesB' | 'resetUser',
    { email: string; password: string }
  >;

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByLabel(/^Email/).fill(email);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
  await expect(page).toHaveURL(/\/app\/dashboard$/);
}

async function noSeriousA11y(page: Page) {
  const results = await new AxeBuilder({ page })
    .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
    .analyze();
  const serious = results.violations.filter(
    (v) => v.impact === 'serious' || v.impact === 'critical',
  );
  expect(serious.map((v) => `${v.id}: ${v.help}`)).toEqual([]);
}

async function noOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
  }));
  expect(sw).toBeLessThanOrEqual(iw);
}

/** Newest email of a kind from the dev sink: proves the link really went through the mailer. */
function latestEmail(kind: string, to: string) {
  const files = readdirSync(SINK)
    .filter((f) => f.includes(`-${kind}-`))
    .sort();
  for (const f of files.reverse()) {
    const msg = JSON.parse(readFileSync(join(SINK, f), 'utf8')) as { to: string; text: string };
    if (msg.to === to) return msg;
  }
  throw new Error(`No ${kind} email for ${to}`);
}

const INVITEE = {
  email: 'lina.hassan@e2e.test',
  name: 'Lina Hassan',
  password: 'tidal-copper-meadow-29',
};

test.describe.serial('M2 identity journey', () => {
  test('owner invites a teammate from the Team page', async ({ page }) => {
    await signIn(page, creds().owner.email, creds().owner.password);
    await page.getByRole('link', { name: 'Team' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Team' })).toBeVisible();
    await expect(page.getByRole('table', { name: 'Team members' })).toContainText('Sami Ahmed');
    await noSeriousA11y(page);

    await page.getByRole('button', { name: 'Invite member' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Invite a team member' });
    await dialog.getByLabel(/^Work email/).fill(INVITEE.email);
    await dialog.getByLabel(/^Role/).selectOption('SALES');
    await dialog.getByRole('button', { name: 'Create invitation' }).click();
    const done = page.getByRole('dialog', { name: 'Invitation created' });
    await expect(done.getByLabel('Invitation link')).toHaveValue(/\/activate-invite#token=/);
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, `${SHOTS}/invite-created-1440.png`);

    // The same link was written to the mail sink, so email delivery would carry it too.
    const shown = await done.getByLabel('Invitation link').inputValue();
    expect(latestEmail('invitation', INVITEE.email).text).toContain(new URL(shown).hash);
    await done.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText(INVITEE.email)).toBeVisible();
    await shot(page, `${SHOTS}/team-1440.png`, { fullPage: true });
  });

  test('the invitee accepts, chooses a password and lands signed in', async ({ browser }) => {
    const link = latestEmail('invitation', INVITEE.email).text.match(/http\S+/)![0];
    const context = await browser.newContext({ viewport: { width: 360, height: 800 } });
    const page = await context.newPage();
    await page.goto(new URL(link).pathname + new URL(link).hash);
    await expect(page.getByRole('heading', { name: /Join E2E Studio/ })).toBeVisible();
    // The one-time token is removed from the address bar after reading it.
    await expect.poll(() => page.evaluate(() => location.hash)).toBe('');
    await noOverflow(page);
    await noSeriousA11y(page);
    await shot(page, `${SHOTS}/activate-invite-360.png`, { fullPage: true });

    await page.getByLabel(/^Your name/).fill(INVITEE.name);
    await page.getByLabel(/^Password/).fill('password1234');
    await page.getByLabel(/^Confirm password/).fill('password1234');
    await page.getByRole('button', { name: 'Create account and sign in' }).click();
    await expect(page.getByText(/too common or easy to guess/)).toBeVisible();

    await page.getByLabel(/^Password/).fill(INVITEE.password);
    await page.getByLabel(/^Confirm password/).fill(INVITEE.password);
    await page.getByRole('button', { name: 'Create account and sign in' }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
    await expect(page.getByRole('heading', { name: /Lina/ })).toBeVisible();

    // A salesperson has no Team section, and the API agrees.
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('link', { name: 'Team' })).toHaveCount(0);
    expect((await page.request.get('/api/v1/users')).status()).toBe(403);

    // Reusing the invitation link fails.
    const reuse = await context.newPage();
    await reuse.goto(new URL(link).pathname + new URL(link).hash);
    await expect(reuse.getByText('This invitation link does not work')).toBeVisible();
    await context.storageState({ path: 'e2e/.auth/invitee.json' });
    await context.close();
  });

  test('deactivating the new member ends their session immediately', async ({ page, browser }) => {
    const member = await browser.newContext({ storageState: 'e2e/.auth/invitee.json' });
    const memberPage = await member.newPage();
    await memberPage.goto('/app/leads');
    await expect(memberPage.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible();

    await signIn(page, creds().owner.email, creds().owner.password);
    await page.goto('/app/team');
    await page
      .getByRole('table', { name: 'Team members' })
      .getByRole('button', { name: `Manage ${INVITEE.name}` })
      .click();
    const manage = page.getByRole('dialog', { name: 'Manage member' });
    await manage.getByRole('button', { name: 'Deactivate' }).click();
    const confirm = page.getByRole('dialog', { name: 'Please confirm' });
    await confirm.getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByRole('table', { name: 'Team members' })).toContainText('Deactivated');

    await memberPage.reload();
    await expect(memberPage).toHaveURL(/\/login/);
    expect((await memberPage.request.get('/api/v1/auth/me')).status()).toBe(401);
    await member.close();
  });

  test('forgot password → emailed link → new password works, old one does not', async ({
    page,
  }) => {
    const who = creds().resetUser;
    const newPassword = 'harbor-violet-quartz-63';
    await page.setViewportSize({ width: 360, height: 800 });
    await page.goto('/login');
    await page.getByRole('link', { name: 'Forgot password?' }).click();
    await expect(page).toHaveURL(/\/forgot-password$/);
    await noSeriousA11y(page);
    await page.getByLabel(/^Email/).fill(who.email);
    await page.getByRole('button', { name: 'Send reset link' }).click();
    await expect(
      page.getByText('If that address has an account, a link is on its way'),
    ).toBeVisible();

    await expect
      .poll(() => {
        try {
          return latestEmail('password_reset', who.email).text;
        } catch {
          return '';
        }
      })
      .toContain('/reset-password#token=');
    const link = latestEmail('password_reset', who.email).text.match(/http\S+/)![0];
    await page.goto(new URL(link).pathname + new URL(link).hash);
    await expect(page.getByRole('heading', { name: 'Choose a new password' })).toBeVisible();
    await noOverflow(page);
    await shot(page, `${SHOTS}/reset-password-360.png`, { fullPage: true });
    await page.getByLabel(/^New password/).fill(newPassword);
    await page.getByLabel(/^Confirm new password/).fill(newPassword);
    await page.getByRole('button', { name: 'Set new password' }).click();
    await expect(page.getByText('You can sign in with your new password')).toBeVisible();

    await page.goto('/login');
    await page.getByLabel(/^Email/).fill(who.email);
    await page.getByLabel(/^Password/).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page.getByRole('alert')).toContainText('Email or password is incorrect.');
    await signIn(page, who.email, newPassword);
  });

  test('team page works at 360px', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, creds().owner.email, creds().owner.password);
    await page.goto('/app/team');
    await expect(page.getByRole('list', { name: 'Team members' })).toContainText(INVITEE.name);
    await noOverflow(page);
    await shot(page, `${SHOTS}/team-360.png`, { fullPage: true });
  });
});
