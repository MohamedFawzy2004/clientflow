// M6 gate: a client-accepted deal handed off to delivery, on the real API + PostgreSQL (spec §18
// "Atomic/idempotent conversion tests"; the race and fault-injection tests run in
// apps/api/tests/projects.test.ts). Setup uses the API; the PM journey uses the UI.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { shot } from './shot';

const SHOTS = 'docs/milestones/m6-screenshots';
type Who = 'owner' | 'salesA' | 'salesB' | 'pm' | 'member';
const creds = () =>
  JSON.parse(readFileSync('e2e/.auth/credentials.json', 'utf8')) as Record<
    Who,
    { email: string; password: string }
  >;
const CLIENT = {
  email: 'omar@harbour.test',
  name: 'Omar Said',
  password: 'quiet-harbor-lantern-58',
};

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

async function api(
  page: Page,
  method: 'GET' | 'POST' | 'PUT' | 'PATCH',
  path: string,
  data?: object,
) {
  const csrfRes = await page.request.get('/api/v1/auth/csrf');
  expect(csrfRes.ok(), `GET /auth/csrf → ${csrfRes.status()} ${await csrfRes.text()}`).toBe(true);
  const csrf = (await csrfRes.json()).data.csrfToken as string;
  const res = await page.request.fetch(path, {
    method,
    ...(data ? { data } : {}),
    headers: { 'X-CSRF-Token': csrf, Origin: new URL(page.url()).origin },
  });
  expect(res.ok(), `${method} ${path} → ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()).data;
}

async function asUser(browser: Browser, who: { email: string; password: string }, home?: RegExp) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who, home);
  return { page, close: () => context.close() };
}

let dealId = '';
let projectUrl = '';

test.describe.serial('M6 project handoff', () => {
  test('setup: a deal the client accepted through the portal (API)', async ({ browser }) => {
    const sales = await asUser(browser, creds().salesA);
    const lead = await api(sales.page, 'POST', '/api/v1/contacts', {
      fullName: 'Leila Kamal',
      companyName: 'Harbour Freight',
    });
    const deal = await api(sales.page, 'POST', '/api/v1/deals', {
      contactId: lead.id,
      title: 'Warehouse app',
      amount: '60000',
      currency: 'EGP',
    });
    dealId = deal.id;
    const proposal = await api(sales.page, 'POST', '/api/v1/proposals', { dealId });
    const draft = await api(sales.page, 'PUT', `/api/v1/proposals/${proposal.id}/draft`, {
      version: 1,
      title: 'Warehouse app',
      inclusions: 'Scanner app\nStock dashboard',
      exclusions: 'Hardware',
      milestones: 'Discovery\nBuild\nLaunch',
      expiresOn: '2099-12-31',
      discountPercent: '0',
      taxRatePercent: '14',
      taxLabel: 'VAT',
      items: [{ name: 'Build', unit: 'day', quantity: '20', unitPrice: '3000' }],
    });
    await api(sales.page, 'POST', `/api/v1/proposals/${proposal.id}/submit`, {
      version: draft.current.version,
    });
    await sales.close();

    const owner = await asUser(browser, creds().owner);
    const reviewed = await api(owner.page, 'GET', `/api/v1/proposals/${proposal.id}`);
    const approved = await api(owner.page, 'POST', `/api/v1/proposals/${proposal.id}/review`, {
      version: reviewed.current.version,
      decision: 'APPROVE',
    });
    const org = await api(owner.page, 'POST', `/api/v1/contacts/${lead.id}/client-org`, {
      name: 'Harbour Freight',
    });
    const invite = await api(owner.page, 'POST', `/api/v1/client-orgs/${org.id}/invitations`, {
      email: CLIENT.email,
    });
    await owner.close();

    const clientCtx = await browser.newContext();
    const client = await clientCtx.newPage();
    const url = new URL(invite.acceptUrl);
    await client.goto(url.pathname + url.hash);
    await client.getByLabel(/^Your name/).fill(CLIENT.name);
    await client.getByLabel(/^Password/).fill(CLIENT.password);
    await client.getByLabel(/^Confirm password/).fill(CLIENT.password);
    await client.getByRole('button', { name: 'Create account and sign in' }).click();
    await expect(client).toHaveURL(/\/portal$/);

    const owner2 = await asUser(browser, creds().owner);
    await api(owner2.page, 'POST', `/api/v1/proposals/${proposal.id}/send`, {
      version: approved.current.version,
    });
    await owner2.close();

    await client.reload();
    const view = await api(client, 'GET', `/api/v1/portal/proposals/${proposal.id}`);
    await api(client, 'POST', `/api/v1/portal/proposals/${proposal.id}/decision`, {
      decision: 'ACCEPT',
      contentHash: view.current.contentHash,
    });
    await clientCtx.close();
  });

  test('the PM sees the handoff waiting and converts the deal into a project', async ({ page }) => {
    await signIn(page, creds().pm);
    await expect(page.getByRole('region', { name: 'Waiting for handoff' })).toBeVisible();
    await page.goto('/app/projects');
    const queue = page.getByRole('region', { name: 'Waiting for handoff' });
    await expect(queue.getByRole('listitem').filter({ hasText: 'Warehouse app' })).toHaveCount(1);
    await noSeriousA11y(page);
    await queue.getByRole('button', { name: 'Convert Warehouse app to project' }).click();
    const dialog = page.getByRole('dialog', { name: 'Convert to project' });
    await expect(dialog.getByLabel(/^Project manager/)).toHaveValue(/.+/);
    await dialog.getByLabel(/^Due/).fill('2027-03-31');
    await dialog.getByRole('button', { name: 'Create project' }).click();
    await expect(page).toHaveURL(/\/app\/projects\/[0-9a-f-]+$/);
    projectUrl = page.url();
    await expect(page.getByRole('heading', { level: 1, name: 'Warehouse app' })).toBeVisible();
    await expect(page.getByText('Harbour Freight · managed by Pat Morgan')).toBeVisible();
    const milestones = page.getByRole('region', { name: /^Milestones/ });
    for (const m of ['Discovery', 'Build', 'Launch'])
      await expect(milestones.getByText(m, { exact: true })).toBeVisible();
    const baseline = page.getByRole('region', { name: 'Scope baseline' });
    await expect(baseline.getByText(/accepted by Omar Said/)).toBeVisible();
    await expect(baseline.getByText('Hardware')).toBeVisible();
    await expect(page.getByText(/Budget\s*EGP\s60,000\.00\s*excl\. tax/)).toBeVisible();
    await noSeriousA11y(page);
    await page.setViewportSize({ width: 1440, height: 900 });
    await shot(page, `${SHOTS}/project-1440.png`, { fullPage: true });
    await page.setViewportSize({ width: 360, height: 800 });
    await noOverflow(page);
    await shot(page, `${SHOTS}/project-360.png`, { fullPage: true });
  });

  test('the PM starts delivery: state, milestone, checklist and team', async ({ page }) => {
    await signIn(page, creds().pm);
    await page.goto(projectUrl);
    await page.getByLabel('Change state').selectOption({ label: 'Active' });
    await expect(page.getByText('Project is now active')).toBeVisible();
    await page.getByLabel('Status of Discovery').selectOption({ label: 'Done' });
    await expect(page.getByRole('region', { name: 'Milestones (1/3 done)' })).toBeVisible();
    // The box turns checked once the server has recorded who completed it.
    const kickoff = page.getByRole('checkbox', { name: /Kick-off meeting scheduled/ });
    await kickoff.click();
    await expect(kickoff).toBeChecked();
    await expect(page.getByText(/^Pat Morgan, /)).toBeVisible();
    await page.getByLabel('Add someone').selectOption({ label: 'Mina Adel' });
    await page.getByRole('region', { name: 'Team' }).getByRole('button', { name: 'Add' }).click();
    await expect(
      page
        .getByRole('region', { name: 'Team' })
        .getByRole('listitem')
        .filter({ hasText: 'Mina Adel' }),
    ).toHaveCount(1);
    await expect(
      page
        .getByRole('region', { name: 'History' })
        .getByText(/moved the project from Planned to Active/),
    ).toBeVisible();
  });

  test('the member and the salesperson see it read-only; another salesperson cannot', async ({
    browser,
  }) => {
    const member = await asUser(browser, creds().member);
    await expect(member.page.getByRole('region', { name: 'Open projects' })).toContainText('1');
    await member.page.goto(projectUrl);
    await expect(member.page.getByText(/Only its manager or an admin can change it/)).toBeVisible();
    await expect(member.page.getByLabel('Change state')).toHaveCount(0);
    await member.close();

    const sales = await asUser(browser, creds().salesA);
    await sales.page.goto(`/app/deals/${dealId}`);
    const delivery = sales.page.getByRole('region', { name: 'Delivery' });
    await expect(delivery.getByText(/Handed off to/)).toBeVisible();
    await delivery.getByRole('link', { name: 'Warehouse app' }).click();
    await expect(sales.page.getByText(/Only its manager or an admin can change it/)).toBeVisible();
    await sales.close();

    const other = await asUser(browser, creds().salesB);
    await other.page.goto(projectUrl);
    await expect(other.page.getByText('Project not found')).toBeVisible();
    await other.close();
  });
});
