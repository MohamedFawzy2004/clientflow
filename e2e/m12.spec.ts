// M12.1 gate: two-step sign-in in a real browser on the real API (ADR-069). Uses its own user
// (mfaUser), because it changes how that account signs in.
import { expect, test } from '@playwright/test';
import { base32Decode, stepAt, totpCode } from '../apps/api/src/lib/totp';
import { creds, review } from './support';

const DIR = 'docs/milestones/m12-1-screenshots';

test.describe.configure({ mode: 'serial' });

test.describe('M12.1 two-step sign-in', () => {
  let secret: Buffer;
  let recoveryCode: string;

  test('a member turns it on: password, QR code, a code, saved recovery codes', async ({
    page,
  }) => {
    const who = creds().mfaUser;
    await page.goto('/login');
    await page.getByLabel(/^Email/).fill(who.email);
    await page.getByLabel(/^Password/).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);

    await page.getByRole('link', { name: 'Account security' }).first().click();
    await expect(page.getByRole('heading', { level: 1, name: 'Account security' })).toBeVisible();
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();
    await page.getByLabel(/^Your password/).fill(who.password);
    await page.getByRole('button', { name: 'Continue' }).click();

    await expect(page.getByRole('img', { name: /QR code to scan/ })).toBeVisible();
    await review(page, DIR, 'setup-scan');
    const key = await page.locator('p.font-mono').first().innerText();
    secret = base32Decode(key);
    await page.getByLabel(/^Authentication code/).fill(totpCode(secret, stepAt(Date.now())));
    await page.getByRole('button', { name: 'Turn on two-step sign-in' }).click();

    const codes = page.getByRole('list').filter({ hasText: /^[A-Z2-7]{4}-/ });
    await expect(codes.getByRole('listitem')).toHaveCount(10);
    recoveryCode = await codes.getByRole('listitem').first().innerText();
    await review(page, DIR, 'recovery-codes');
    await page.getByLabel('I have saved my recovery codes').check();
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(page.getByText('On', { exact: true })).toBeVisible();
  });

  test('signing in now needs a code; a wrong one is refused', async ({ page }) => {
    const who = creds().mfaUser;
    await page.goto('/login');
    await page.getByLabel(/^Email/).fill(who.email);
    await page.getByLabel(/^Password/).fill(who.password);
    await page.getByRole('button', { name: 'Sign in' }).click();

    const code = page.getByLabel(/^Authentication code/);
    await expect(code).toBeVisible();
    await review(page, DIR, 'sign-in-code');
    await code.fill('000000');
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page.getByText('That code is not right. Try the next one.')).toBeVisible();
    // The setup used the current step; the next step's code is the first one left to use.
    await code.fill(totpCode(secret, stepAt(Date.now()) + 1));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/app\/dashboard$/);
  });

  test('a recovery code works once', async ({ browser }) => {
    const who = creds().mfaUser;
    for (const expectSuccess of [true, false]) {
      const context = await browser.newContext();
      const page = await context.newPage();
      await page.goto('/login');
      await page.getByLabel(/^Email/).fill(who.email);
      await page.getByLabel(/^Password/).fill(who.password);
      await page.getByRole('button', { name: 'Sign in' }).click();
      await page.getByRole('button', { name: 'Use a recovery code instead' }).click();
      await page.getByLabel(/^Recovery code/).fill(recoveryCode);
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      if (expectSuccess) await expect(page).toHaveURL(/\/app\/dashboard$/);
      else await expect(page.getByText(/not right or was used before/)).toBeVisible();
      await context.close();
    }
  });
});
