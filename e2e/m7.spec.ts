// M7 gate: delivery and the client portal on the real API + PostgreSQL (spec §18 "Client
// isolation/upload tests"; the isolation matrix and upload attacks run in
// apps/api/tests/delivery-portal.test.ts). Setup uses the API; the journeys use the UI.
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, test, type Browser, type Page } from '@playwright/test';
import { shot } from './shot';

const SHOTS = 'docs/milestones/m7-screenshots';
type Who = 'owner' | 'pm' | 'member';
const creds = () =>
  JSON.parse(readFileSync('e2e/.auth/credentials.json', 'utf8')) as Record<
    Who,
    { email: string; password: string }
  >;
const CLIENT = {
  email: 'nadia@delta.test',
  name: 'Nadia Farouk',
  password: 'amber-delta-window-73',
};
const pdf = (label: string) =>
  Buffer.from(`%PDF-1.4\n% ${label}\n1 0 obj <<>> endobj\ntrailer <<>>\n%%EOF\n`);

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

/** Checks a screen at 360px (no sideways scroll, no serious axe issue) and saves both widths. */
async function review(page: Page, name: string) {
  await noSeriousA11y(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, `${SHOTS}/${name}-1440.png`, { fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page);
  await noSeriousA11y(page);
  await shot(page, `${SHOTS}/${name}-360.png`, { fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
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

async function uploadOnFilesTab(page: Page, name: string, buffer: Buffer, mimeType: string) {
  await page.locator('input[type=file]').setInputFiles({ name, mimeType, buffer });
}

let projectUrl = '';

test.describe.serial('M7 delivery and portal', () => {
  test('setup: a project linked to a client organization with a portal user (API)', async ({
    browser,
  }) => {
    const owner = await asUser(browser, creds().owner);
    const contact = await api(owner.page, 'POST', '/api/v1/contacts', {
      fullName: 'Nadia Farouk',
      companyName: 'Delta Studio',
    });
    const org = await api(owner.page, 'POST', `/api/v1/contacts/${contact.id}/client-org`, {
      name: 'Delta Studio',
    });
    const invite = await api(owner.page, 'POST', `/api/v1/client-orgs/${org.id}/invitations`, {
      email: CLIENT.email,
    });
    const staff = (await api(owner.page, 'GET', '/api/v1/projects/staff')) as Array<{
      id: string;
      name: string;
    }>;
    const pmId = staff.find((u) => u.name === 'Pat Morgan')!.id;
    const memberId = staff.find((u) => u.name === 'Mina Adel')!.id;
    const project = await api(owner.page, 'POST', '/api/v1/projects', {
      title: 'Delta website',
      managerId: pmId,
      currency: 'EGP',
    });
    const linked = await api(owner.page, 'PATCH', `/api/v1/projects/${project.id}`, {
      version: project.version,
      clientOrgId: org.id,
    });
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/members`, { userId: memberId });
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/state`, {
      version: linked.version,
      state: 'ACTIVE',
    });
    await owner.close();
    projectUrl = `/app/projects/${project.id}`;

    const ctx = await browser.newContext();
    const client = await ctx.newPage();
    const url = new URL(invite.acceptUrl);
    await client.goto(url.pathname + url.hash);
    await client.getByLabel(/^Your name/).fill(CLIENT.name);
    await client.getByLabel(/^Password/).fill(CLIENT.password);
    await client.getByLabel(/^Confirm password/).fill(CLIENT.password);
    await client.getByRole('button', { name: 'Create account and sign in' }).click();
    await expect(client).toHaveURL(/\/portal$/);
    // Not shared yet: the portal has no projects.
    await client.getByRole('link', { name: 'Projects' }).click();
    await expect(client.getByText('No projects shared with you yet')).toBeVisible();
    await ctx.close();
  });

  test('the PM plans tasks with a dependency on the board', async ({ page }) => {
    await signIn(page, creds().pm);
    await page.goto(projectUrl);
    await page
      .getByRole('navigation', { name: 'Project sections' })
      .getByRole('link', { name: 'Tasks' })
      .click();
    await expect(page).toHaveURL(/\/board$/);
    for (const [title, due] of [
      ['Write homepage copy', '2026-11-05'],
      ['Design homepage', '2026-11-12'],
    ] as const) {
      await page.getByRole('button', { name: 'New task' }).click();
      const dialog = page.getByRole('dialog', { name: 'New task' });
      await dialog.getByLabel(/^Task/).fill(title);
      await dialog.getByLabel(/^Assignee/).selectOption({ label: 'Mina Adel' });
      await dialog.getByLabel(/^Due/).fill(due);
      await dialog.getByLabel(/^Priority/).selectOption({ label: 'High' });
      await dialog.getByLabel(/^Estimate/).fill('6');
      await dialog.getByRole('button', { name: 'Add task' }).click();
      await expect(page.getByText('Task added')).toBeVisible();
      await expect(dialog).toHaveCount(0);
    }
    await page.getByRole('button', { name: 'Design homepage' }).click();
    const detail = page.getByRole('dialog', { name: 'Design homepage' });
    await detail
      .getByLabel('Add a task it waits for')
      .selectOption({ label: 'Write homepage copy' });
    await detail.getByRole('button', { name: 'Add', exact: true }).click();
    await expect(
      detail.getByRole('listitem').filter({ hasText: 'Write homepage copy' }),
    ).toHaveCount(1);
    await detail.getByRole('button', { name: 'Close', exact: true }).last().click();
    await expect(page.getByText('Waits for 1')).toBeVisible();
    await review(page, 'board-pm');
  });

  test('the member works the board, logs time and prepares a deliverable', async ({ page }) => {
    await signIn(page, creds().member);
    await expect(page.getByRole('region', { name: 'My tasks' })).toContainText(
      'Write homepage copy',
    );
    await page.goto(`${projectUrl}/board`);
    await expect(page.getByRole('button', { name: 'New task' })).toHaveCount(0);
    // Waiting for another task: DONE is refused by the server.
    await page.getByLabel('Status of Design homepage').selectOption({ label: 'Done' });
    await expect(page.getByText(/Finish “Write homepage copy” first/)).toBeVisible();
    await page.getByLabel('Status of Write homepage copy').selectOption({ label: 'Done' });
    await expect(page.getByText('“Write homepage copy” is now done')).toBeVisible();
    await page.getByLabel('Status of Design homepage').selectOption({ label: 'In progress' });
    await expect(page.getByText('“Design homepage” is now in progress')).toBeVisible();

    await page.getByRole('button', { name: 'Design homepage' }).click();
    const detail = page.getByRole('dialog', { name: 'Design homepage' });
    await detail.getByLabel('Hours').fill('1');
    await detail.getByLabel('Minutes').fill('30');
    await detail.getByLabel(/^Internal note/).fill('Hero section');
    await detail.getByRole('button', { name: 'Log time' }).click();
    await expect(page.getByText('Logged 1h 30m')).toBeVisible();
    await expect(detail.getByText(/1h 30m · /)).toBeVisible();
    await noSeriousA11y(page);
    await detail.getByRole('button', { name: 'Close', exact: true }).last().click();

    await page.getByRole('link', { name: 'Time' }).click();
    await expect(page.getByText('You logged')).toBeVisible();
    await expect(page.getByText('1h 30m').first()).toBeVisible();

    await page.getByRole('link', { name: 'Files' }).click();
    // Active content is refused by the server and never stored.
    await uploadOnFilesTab(
      page,
      'page.html',
      Buffer.from('<html><script>x</script></html>'),
      'text/html',
    );
    await expect(page.getByText(/This file type is not accepted/)).toBeVisible();
    await uploadOnFilesTab(page, 'homepage-v1.pdf', pdf('v1'), 'application/pdf');
    await expect(page.getByText('Uploaded “homepage-v1.pdf”')).toBeVisible();
    const row = page.getByRole('listitem').filter({ hasText: 'homepage-v1.pdf' });
    await expect(row.getByText('Checked')).toBeVisible();
    await review(page, 'files');

    await page.getByRole('link', { name: 'Deliverables' }).click();
    await page.getByRole('button', { name: 'New deliverable' }).click();
    const dialog = page.getByRole('dialog', { name: 'New deliverable' });
    await dialog.getByLabel(/^Title/).fill('Homepage design');
    await dialog.getByLabel(/^Client review due/).fill('2026-11-20');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(page).toHaveURL(/\/deliverables\/[0-9a-f-]+$/);
    await page.getByLabel('File for the next version').selectOption({ index: 1 });
    await page.getByLabel(/^Note for the client/).fill('First design round');
    await page.getByRole('button', { name: 'Add version' }).click();
    await expect(page.getByText('Ready to publish')).toBeVisible();
    await expect(page.getByText('The project manager publishes it to the client.')).toBeVisible();
    await expect(page.getByRole('button', { name: /Publish version/ })).toHaveCount(0);
  });

  test('the PM publishes version 1 and shares the project with the client', async ({ page }) => {
    await signIn(page, creds().pm);
    await page.goto(`${projectUrl}/deliverables`);
    await page.getByRole('link', { name: 'Homepage design' }).click();
    await page.getByRole('button', { name: 'Publish version 1 to the client' }).click();
    const confirm = page.getByRole('dialog', { name: 'Publish version 1?' });
    await confirm.getByRole('button', { name: 'Publish' }).click();
    await expect(page.getByText('Published to the client')).toBeVisible();
    await expect(page.getByText('Version 1 is with the client')).toBeVisible();
    await review(page, 'deliverable-pm');

    await page.goto(projectUrl);
    const access = page.getByRole('region', { name: 'Client portal access' });
    await access.getByRole('button', { name: `Share for ${CLIENT.name}` }).click();
    await expect(page.getByText(`Shared with ${CLIENT.name}`)).toBeVisible();
    await expect(
      access.getByRole('button', { name: `Remove access for ${CLIENT.name}` }),
    ).toBeVisible();
  });

  test('the client downloads the file and asks for a revision', async ({ page }) => {
    await signIn(page, CLIENT, /\/portal$/);
    await page
      .getByRole('navigation', { name: 'Portal' })
      .getByRole('link', { name: 'Projects' })
      .click();
    await page.getByRole('link', { name: 'Delta website' }).click();
    const review1 = page.getByRole('region', { name: 'For your review' });
    await expect(review1.getByText('Waiting for your review')).toBeVisible();
    // Internal data never reaches the portal.
    await expect(page.getByText('Write homepage copy')).toHaveCount(0);
    await expect(page.getByText('Hero section')).toHaveCount(0);
    await review(page, 'portal-project');

    await review1.getByRole('link', { name: 'Homepage design' }).click();
    await expect(page.getByText('First design round')).toBeVisible();
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: /Download homepage-v1\.pdf/ }).click();
    const file = await download;
    expect(file.suggestedFilename()).toBe('homepage-v1.pdf');
    const path = await file.path();
    expect(readFileSync(path).toString()).toContain('% v1');

    await review(page, 'portal-deliverable');
    await page.getByRole('button', { name: 'Request a revision' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request a revision?' });
    await dialog.getByLabel(/^What should change/).fill('Use our brand blue for the buttons.');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Your feedback was sent to the team')).toBeVisible();
    await expect(page.getByText('The team is working on it')).toBeVisible();
  });

  test('a second version is published and the client approves it', async ({ browser }) => {
    const member = await asUser(browser, creds().member);
    await member.page.goto(`${projectUrl}/deliverables`);
    await member.page.getByRole('link', { name: 'Homepage design' }).click();
    await expect(member.page.getByText('Use our brand blue for the buttons.')).toBeVisible();
    await member.page
      .locator('input[type=file]')
      .setInputFiles({ name: 'homepage-v2.pdf', mimeType: 'application/pdf', buffer: pdf('v2') });
    await expect(member.page.getByText('Uploaded “homepage-v2.pdf”')).toBeVisible();
    await expect(member.page.getByLabel('File for the next version')).toHaveValue(/.+/);
    await member.page.getByRole('button', { name: 'Add version' }).click();
    await expect(member.page.getByText('Version 2', { exact: false }).first()).toBeVisible();
    await member.close();

    const pm = await asUser(browser, creds().pm);
    await pm.page.goto(`${projectUrl}/deliverables`);
    await pm.page.getByRole('link', { name: 'Homepage design' }).click();
    await pm.page.getByRole('button', { name: 'Publish version 2 to the client' }).click();
    await pm.page
      .getByRole('dialog', { name: 'Publish version 2?' })
      .getByRole('button', { name: 'Publish' })
      .click();
    await expect(pm.page.getByText('Version 2 is with the client')).toBeVisible();
    await pm.close();

    const client = await asUser(browser, CLIENT, /\/portal$/);
    await client.page.goto('/portal/projects');
    await client.page.getByRole('link', { name: 'Delta website' }).click();
    await client.page.getByRole('link', { name: 'Homepage design' }).click();
    // History stays: version 1 with the client's own reason.
    await expect(client.page.getByText('“Use our brand blue for the buttons.”')).toBeVisible();
    await client.page.getByRole('button', { name: 'Approve version 2' }).click();
    await client.page
      .getByRole('dialog', { name: /Approve “Homepage design” version 2/ })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(client.page.getByText('You approved this')).toBeVisible();
    await client.close();

    const pm2 = await asUser(browser, creds().pm);
    await pm2.page.goto(`${projectUrl}/deliverables`);
    await expect(
      pm2.page.getByRole('listitem').filter({ hasText: 'Homepage design' }).getByText('Approved'),
    ).toBeVisible();
    await pm2.page.goto('/app/dashboard');
    await expect(pm2.page.getByRole('region', { name: 'Waiting for the client' })).toContainText(
      '0',
    );
    await pm2.close();
  });

  test('a client cannot open a project that is not shared with them', async ({ page }) => {
    await signIn(page, CLIENT, /\/portal$/);
    await page.goto('/portal/projects/0194f3b2-0000-7000-8000-000000000000');
    await expect(page.getByText('It does not exist or it is not shared with you.')).toBeVisible();
    // Staff pages stay closed to clients.
    await page.goto(projectUrl);
    await expect(page).toHaveURL(/\/portal$/);
  });
});
