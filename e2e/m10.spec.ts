// M10 gate: notifications, reminders from the background worker and CSV import, on the real API +
// PostgreSQL. Retries, dead letters, dedupe and the role checks also run in
// apps/api/tests/notifications.test.ts, imports.test.ts and the permission matrix.
import { execFileSync } from 'node:child_process';
import { expect, test } from '@playwright/test';
import { E2E_MAIL_SINK } from '../playwright.config';
import { acceptInvite, api, asUser, creds, review, signIn } from './support';

const SHOTS = 'docs/milestones/m10-screenshots';
const CLIENT = {
  email: 'laila@sahel.test',
  name: 'Laila Sherif',
  password: 'sahel-orchid-lantern-58',
};
const CSV = [
  'Name,Email,Phone,Company,Source',
  'Hana Mostafa,hana@sahel.test,+20 100 555 1212,Sahel Resorts,Referral',
  'Youssef Nabil,youssef@coast.test,,Coast Hotels,Website',
  'Broken Row,not-an-email,,,',
  'Hana Again,HANA@sahel.test,,,',
  'منى سعيد,mona.said@delta.test,,دلتا,',
].join('\n');

let projectId = '';
let clientEmail = '';

/** Runs the worker once against the E2E database (reminder scan + due jobs), like the scheduler. */
function runJobsOnce() {
  const out = execFileSync('npm', ['run', 'jobs:once', '-w', '@clientflow/api', '--silent'], {
    env: {
      ...process.env,
      DATABASE_URL: process.env.E2E_DATABASE_URL ?? '',
      APP_ORIGINS: 'http://localhost:5174',
      MAIL_TRANSPORT: 'dev-sink',
      MAIL_SINK_DIR: E2E_MAIL_SINK,
      NODE_ENV: 'test',
      LOG_LEVEL: 'warn',
    },
    shell: process.platform === 'win32',
    encoding: 'utf8',
  });
  return JSON.parse(out.trim().split('\n').at(-1)!) as { reminders: number; dead: number };
}

test.describe.serial('M10 automation and import', () => {
  test('setup: an active project shared with a client (API)', async ({ browser }) => {
    const owner = await asUser(browser, creds().owner);
    const contact = await api(owner.page, 'POST', '/api/v1/contacts', {
      fullName: 'Laila Sherif',
      companyName: 'Sahel Resorts',
    });
    const org = await api(owner.page, 'POST', `/api/v1/contacts/${contact.id}/client-org`, {
      name: 'Sahel Resorts',
    });
    const invite = await api(owner.page, 'POST', `/api/v1/client-orgs/${org.id}/invitations`, {
      email: CLIENT.email,
    });
    const staff = (await api(owner.page, 'GET', '/api/v1/projects/staff')) as Array<{
      id: string;
      name: string;
    }>;
    const project = await api(owner.page, 'POST', '/api/v1/projects', {
      title: 'Sahel booking site',
      managerId: staff.find((u) => u.name === 'Pat Morgan')!.id,
      currency: 'EGP',
      budget: '40000',
      dueOn: '2027-04-30',
    });
    const current = await api(owner.page, 'GET', `/api/v1/projects/${project.id}`);
    const linked = await api(owner.page, 'PATCH', `/api/v1/projects/${project.id}`, {
      version: current.version,
      clientOrgId: org.id,
    });
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/state`, {
      version: linked.version,
      state: 'ACTIVE',
    });
    projectId = project.id;
    const client = await acceptInvite(browser, invite.acceptUrl, CLIENT);
    await client.close();
    clientEmail = CLIENT.email;
    const shares = await api(owner.page, 'GET', `/api/v1/projects/${project.id}/shares`);
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/shares`, {
      userId: shares.people[0].user.id,
    });
    await owner.close();
  });

  test('the owner imports contacts from CSV: preview, problems, duplicates, undo', async ({
    page,
  }) => {
    await signIn(page, creds().owner);
    await page.getByRole('link', { name: 'Imports' }).first().click();
    await expect(page.getByRole('heading', { name: 'Import from CSV', level: 1 })).toBeVisible();
    await page.locator('input[type="file"]').setInputFiles({
      name: 'sahel-leads.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(CSV, 'utf8'),
    });
    const rows = page.getByRole('region', { name: 'Rows' });
    await expect(rows.getByText('Enter a valid email address.')).toBeVisible();
    await expect(rows.getByText('Same as line 2.')).toBeVisible();
    await expect(page.getByLabel(/^Name/)).toHaveValue('Name');
    await review(page, SHOTS, '01-import-preview');

    await page.getByRole('button', { name: 'Import 3 contacts' }).click();
    const done = page.getByRole('region', { name: 'Import finished' });
    await expect(done.getByText('3 contacts imported')).toBeVisible();
    await expect(done.getByText(/1 skipped as duplicates, 1 not imported/)).toBeVisible();
    await review(page, SHOTS, '02-import-result');

    await page.goto('/app/leads');
    await expect(page.getByText('Hana Mostafa').first()).toBeVisible();
    await expect(page.getByText('منى سعيد').first()).toBeVisible();

    // Undo archives what the import created; the history keeps the record.
    await page.goto('/app/imports');
    await page.getByRole('button', { name: /^Undo import of sahel-leads\.csv/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Undo import' }).click();
    await expect(page.getByText(/3 archived/)).toBeVisible();
    await expect(
      page.getByRole('region', { name: 'History' }).getByText('Undone', { exact: true }),
    ).toBeVisible();
    await page.goto('/app/leads');
    await expect(page.getByRole('heading', { name: 'Leads', level: 1 })).toBeVisible();
    await expect(page.getByText('Hana Mostafa')).toHaveCount(0);
  });

  test('a client request reaches the PM’s notification center; opening it goes to the change', async ({
    browser,
    page,
  }) => {
    const client = await asUser(
      browser,
      { email: clientEmail, password: CLIENT.password },
      /\/portal$/,
    );
    await api(client.page, 'POST', `/api/v1/portal/projects/${projectId}/changes`, {
      title: 'Arabic booking flow',
      description: 'Guests should be able to book in Arabic.',
    });
    await client.close();

    await signIn(page, creds().pm);
    const bell = page.getByRole('link', { name: /Notifications: \d+ unread/ }).first();
    await expect(bell).toBeVisible();
    await bell.click();
    await expect(page.getByRole('heading', { name: 'Notifications', level: 1 })).toBeVisible();
    const item = page.getByRole('link', {
      name: /Laila Sherif \(client\) requested CR-1 on Sahel booking site/,
    });
    await expect(item).toBeVisible();
    await review(page, SHOTS, '03-notification-center');
    await item.click();
    await expect(page).toHaveURL(new RegExp(`/app/projects/${projectId}/changes/[0-9a-f-]+$`));
    await expect(page.getByRole('heading', { name: 'Arabic booking flow' })).toBeVisible();

    // Read now: the unread filter no longer lists it.
    await page.goto('/app/notifications');
    await page.getByRole('button', { name: 'Unread' }).click();
    await expect(page.getByRole('link', { name: /requested CR-1/ })).toHaveCount(0);
  });

  test('the PM chooses channels per category', async ({ page }) => {
    await signIn(page, creds().pm);
    await page.goto('/app/notifications/settings');
    const tasks = page.getByRole('group', { name: 'Tasks: channels' });
    await tasks.getByRole('checkbox', { name: 'Email' }).check();
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText('Notification settings saved')).toBeVisible();
    await review(page, SHOTS, '04-notification-settings');
    await page.reload();
    await expect(
      page.getByRole('group', { name: 'Tasks: channels' }).getByRole('checkbox', { name: 'Email' }),
    ).toBeChecked();
  });

  test('the worker turns an overdue follow-up into a reminder for its owner', async ({ page }) => {
    await signIn(page, creds().salesA);
    await api(page, 'POST', '/api/v1/contacts', {
      fullName: 'Overdue Omar',
      nextActionAt: new Date(Date.now() - 60 * 60_000).toISOString(),
    });
    const first = runJobsOnce();
    expect(first.reminders).toBeGreaterThanOrEqual(1);
    expect(first.dead).toBe(0);
    // A second run creates nothing new for the same follow-up.
    expect(runJobsOnce().reminders).toBe(0);
    await page.goto('/app/notifications');
    await expect(page.getByRole('link', { name: /Follow-up overdue: Overdue Omar/ })).toHaveCount(
      1,
    );
  });

  test('the owner sees background job health in settings', async ({ page }) => {
    await signIn(page, creds().owner);
    await page.goto('/app/settings');
    const jobs = page.getByRole('region', { name: 'Background jobs' });
    await expect(
      jobs.getByText(/Reminders were last checked|Reminders have not been checked/),
    ).toBeVisible();
    await expect(jobs.getByText('Failed', { exact: true })).toBeVisible();
    await review(page, SHOTS, '05-background-jobs');
  });
});
