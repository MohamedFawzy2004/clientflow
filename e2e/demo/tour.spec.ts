// M12 demo tour: each role's main journey on the fictional demo workspace, run in Chromium,
// Firefox and WebKit (spec §7.5–7.6, §27). Writes are repeatable (a new lead, a time entry, a
// comment), so the tour can run in every engine against one seeded demo.
import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { noOverflow, noSeriousA11y, signIn } from '../support';
import { shot } from '../shot';

interface Cred {
  email: string;
  role: string;
  password: string;
}
const all = () =>
  JSON.parse(readFileSync('apps/api/.demo-credentials.local.json', 'utf8')) as Cred[];
const who = (prefix: string) => all().find((c) => c.email.startsWith(`${prefix}@`))!;

const DIR = 'docs/milestones/m12-screenshots';
const WIDTHS = [360, 390, 768, 1024, 1280, 1440, 1920];

/** Screenshots at every spec width (Chromium only, CAPTURE_SCREENSHOTS=1). */
async function widths(page: Page, name: string, browserName: string) {
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: width < 768 ? 800 : 900 });
    await noOverflow(page);
    if (browserName === 'chromium') {
      await shot(page, `${DIR}/${name}-${width}.png`, { fullPage: width < 768 });
    }
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** WCAG 1.4.4 / 1.4.10: 200% zoom of 1280 px is 640 CSS px; 400% is 320 CSS px. */
async function zoomed(page: Page) {
  for (const width of [640, 320]) {
    await page.setViewportSize({ width, height: width === 640 ? 400 : 256 });
    await noOverflow(page);
  }
  await page.setViewportSize({ width: 1280, height: 800 });
}

test.describe('demo tour', () => {
  test('owner: dashboard with the demo notice', async ({ page, browserName }) => {
    await signIn(page, who('owner'));
    await expect(page.getByRole('note')).toContainText('Demo workspace.');
    await expect(page.getByText(/Lumen Digital Studio \(demo\)/).first()).toBeVisible();
    await noSeriousA11y(page);
    await widths(page, 'dashboard', browserName);
    await zoomed(page);
  });

  test('sales: leads, a new lead, the pipeline and a proposal', async ({ page, browserName }) => {
    await signIn(page, who('sales.a'));
    await page.getByRole('link', { name: 'Leads' }).first().click();
    await expect(page.getByRole('link', { name: 'Salma Ibrahim' })).toBeVisible();
    await widths(page, 'leads', browserName);

    const name = `Tour lead ${browserName} ${Date.now()}`;
    await page.getByRole('button', { name: 'Add lead' }).first().click();
    const dialog = page.getByRole('dialog', { name: 'Add lead' });
    await dialog.getByLabel(/^Full name/).fill(name);
    await dialog.getByLabel(/^Company/).fill('Tour Test Co.');
    await dialog.getByRole('button', { name: 'Save lead' }).click();
    await expect(page.getByRole('heading', { level: 1, name })).toBeVisible();

    await page.goto('/app/deals');
    await expect(page.getByText('Architecture portfolio site').first()).toBeVisible();
    await noSeriousA11y(page);
    await widths(page, 'deals', browserName);

    await page.goto('/app/proposals');
    await page.getByRole('link', { name: /Online ordering website with stamp card/ }).click();
    await expect(page.getByText('Accepted').first()).toBeVisible();
    await noSeriousA11y(page);
    await zoomed(page);
  });

  test('PM: project, task board and change requests', async ({ page, browserName }) => {
    await signIn(page, who('pm'));
    await page.goto('/app/projects');
    await page.getByRole('link', { name: 'Nile Bakery — ordering website' }).click();
    await expect(
      page.getByRole('heading', { level: 1, name: 'Nile Bakery — ordering website' }),
    ).toBeVisible();
    await noSeriousA11y(page);
    await widths(page, 'project', browserName);

    await page.getByRole('link', { name: 'Tasks' }).first().click();
    await expect(page.getByText('Pickup slot rules with the shop team').first()).toBeVisible();
    await noSeriousA11y(page);
    await widths(page, 'task-board', browserName);
    await zoomed(page);

    await page.goto('/app/projects');
    await page.getByRole('link', { name: 'Delta Logistics — fleet dashboard' }).click();
    await page.getByRole('link', { name: 'Changes' }).first().click();
    await expect(page.getByText('Push alerts for late deliveries').first()).toBeVisible();
    await noSeriousA11y(page);
  });

  test('member: my tasks and logging time', async ({ page }) => {
    await signIn(page, who('member.a'));
    await page.goto('/app/projects');
    await page.getByRole('link', { name: 'Nile Bakery — ordering website' }).click();
    await page.getByRole('link', { name: 'Time' }).first().click();
    await expect(page.getByText('Product catalogue import').first()).toBeVisible();
    await noSeriousA11y(page);
    await zoomed(page);
  });

  test('finance: invoices, the overdue one and the finance report', async ({
    page,
    browserName,
  }) => {
    await signIn(page, who('finance'));
    await page.goto('/app/invoices');
    await expect(page.getByText('Delta Logistics').first()).toBeVisible();
    await expect(page.getByRole('link', { name: /INV-\d+ · Delta Logistics/ })).toBeVisible();
    await expect(
      page.getByText('Overdue', { exact: true }).filter({ visible: true }).first(),
    ).toBeVisible();
    await noSeriousA11y(page);
    await widths(page, 'invoices', browserName);
    await zoomed(page);

    await page.goto('/app/reports/finance');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await noSeriousA11y(page);
  });

  test('client 1: own proposal, project, deliverables and invoices only', async ({
    page,
    browserName,
  }) => {
    await signIn(page, who('client.1'), /\/portal$/);
    await expect(page.getByRole('note')).toContainText('Demo workspace.');
    await expect(page.getByText('Online ordering website with stamp card').first()).toBeVisible();
    await expect(page.getByText('Fleet tracking dashboard')).toHaveCount(0);
    await noSeriousA11y(page);
    await widths(page, 'portal-proposals', browserName);

    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('link', { name: /Nile Bakery — ordering website/ }).click();
    await expect(page.getByText('Homepage design').first()).toBeVisible();
    await expect(page.getByText('Delta Logistics')).toHaveCount(0);
    await noSeriousA11y(page);
    await widths(page, 'portal-project', browserName);
    await zoomed(page);

    await page.getByRole('link', { name: 'Invoices' }).click();
    await expect(page.getByText(/INV-\d+/).first()).toBeVisible();
    await noSeriousA11y(page);
  });

  test('client 2: a deliverable waiting for their review', async ({ page }) => {
    await signIn(page, who('client.2'), /\/portal$/);
    await page.getByRole('link', { name: 'Projects' }).click();
    await page.getByRole('link', { name: /Delta Logistics — fleet dashboard/ }).click();
    await expect(page.getByText('Dashboard wireframes').first()).toBeVisible();
    await expect(page.getByText('Nile Bakery')).toHaveCount(0);
    await noSeriousA11y(page);
  });

  test('keyboard: skip link reaches the content', async ({ page, browserName }) => {
    // WebKit (like Safari) skips links on Tab unless the user turns on full keyboard access.
    test.skip(browserName === 'webkit', 'Tab skips links by default in WebKit.');
    await signIn(page, who('owner'));
    // A fresh page load, so the first Tab starts at the top of the document.
    await page.goto('/app/leads');
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
});
