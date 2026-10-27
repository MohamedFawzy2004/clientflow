// M8 gate: scope changes on the real API + PostgreSQL (spec §18 "No unapproved scope mutation";
// spec J4). The atomicity, isolation and immutability checks run in apps/api/tests/changes.test.ts.
// Setup uses the API; the journey uses the UI.
import { expect, test } from '@playwright/test';
import { acceptInvite, api, asUser, creds, noSeriousA11y, review, signIn } from './support';

const SHOTS = 'docs/milestones/m8-screenshots';
const CLIENT = { email: 'salma@nile.test', name: 'Salma Nabil', password: 'river-nile-lantern-42' };

let projectUrl = '';
let changeUrl = '';

test.describe.serial('M8 scope changes', () => {
  test('setup: an active project shared with a client (API)', async ({ browser }) => {
    const owner = await asUser(browser, creds().owner);
    const contact = await api(owner.page, 'POST', '/api/v1/contacts', {
      fullName: 'Salma Nabil',
      companyName: 'Nile Foods',
    });
    const org = await api(owner.page, 'POST', `/api/v1/contacts/${contact.id}/client-org`, {
      name: 'Nile Foods',
    });
    const invite = await api(owner.page, 'POST', `/api/v1/client-orgs/${org.id}/invitations`, {
      email: CLIENT.email,
    });
    const staff = (await api(owner.page, 'GET', '/api/v1/projects/staff')) as Array<{
      id: string;
      name: string;
    }>;
    const project = await api(owner.page, 'POST', '/api/v1/projects', {
      title: 'Nile ordering app',
      managerId: staff.find((u) => u.name === 'Pat Morgan')!.id,
      currency: 'EGP',
      budget: '50000',
      dueOn: '2027-03-31',
    });
    const linked = await api(owner.page, 'PATCH', `/api/v1/projects/${project.id}`, {
      version: project.version,
      clientOrgId: org.id,
    });
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/state`, {
      version: linked.version,
      state: 'ACTIVE',
    });
    projectUrl = `/app/projects/${project.id}`;
    const client = await acceptInvite(browser, invite.acceptUrl, CLIENT);
    await client.close();
    const shares = await api(owner.page, 'GET', `/api/v1/projects/${project.id}/shares`);
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/shares`, {
      userId: shares.people[0].user.id,
    });
    await owner.close();
  });

  test('the client requests a change in the portal', async ({ page }) => {
    await signIn(page, CLIENT, /\/portal$/);
    await page
      .getByRole('navigation', { name: 'Portal' })
      .getByRole('link', { name: 'Projects' })
      .click();
    await page.getByRole('link', { name: 'Nile ordering app' }).click();
    await page.getByRole('button', { name: 'Request a change' }).click();
    const dialog = page.getByRole('dialog', { name: 'Request a change' });
    await dialog.getByLabel(/^Title/).fill('Delivery tracking');
    await dialog
      .getByLabel(/^What should change/)
      .fill('Customers follow their delivery on a map.');
    await dialog.getByLabel(/^Why/).fill('Fewer support calls');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(page.getByText('Your request was sent to the team')).toBeVisible();
    const changes = page.getByRole('region', { name: 'Changes' });
    await expect(changes.getByText('Requested by you')).toBeVisible();
    await expect(changes.getByText('Requested', { exact: true })).toBeVisible();
  });

  test('the PM estimates the change and submits it for approval', async ({ page }) => {
    await signIn(page, creds().pm);
    await page.goto(projectUrl);
    await page
      .getByRole('navigation', { name: 'Project sections' })
      .getByRole('link', { name: 'Changes' })
      .click();
    await expect(page.getByText('From the client')).toBeVisible();
    await page.getByRole('link', { name: /CR-1 Delivery tracking/ }).click();
    await expect(page).toHaveURL(/\/changes\/[0-9a-f-]+$/);
    changeUrl = page.url();
    await page
      .getByLabel(/^Scope change/)
      .fill('Live order map for customers, with driver location every 30 seconds.');
    await page.getByLabel(/^Work items/).fill('Driver location API\nCustomer map screen');
    await page.getByLabel(/^Price excl\. tax/).fill('12000');
    await page.getByLabel(/^Effort/).fill('40');
    await page.getByLabel(/^New project due date/).fill('2027-04-30');
    await page.getByRole('button', { name: 'Save estimate' }).click();
    await expect(page.getByText('Estimate saved')).toBeVisible();
    await page.getByRole('button', { name: 'Submit for approval' }).click();
    await page
      .getByRole('dialog', { name: 'Submit for approval?' })
      .getByRole('button', { name: 'Submit' })
      .click();
    await expect(page.getByText('Waiting for internal approval')).toBeVisible();
    // The PM cannot approve their own priced change, and cannot send it yet.
    await expect(page.getByRole('button', { name: 'Approve for the client' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Send to the client/ })).toHaveCount(0);
    await review(page, SHOTS, 'change-in-review');
  });

  test('the owner approves it and the PM sends it to the client', async ({ browser }) => {
    const owner = await asUser(browser, creds().owner);
    await owner.page.goto(changeUrl);
    await owner.page.getByRole('button', { name: 'Approve for the client' }).click();
    await owner.page
      .getByRole('dialog', { name: 'Approve this change for the client?' })
      .getByRole('button', { name: 'Approve' })
      .click();
    await expect(owner.page.getByText('Approved for the client')).toBeVisible();
    await owner.close();

    const pm = await asUser(browser, creds().pm);
    await pm.page.goto(changeUrl);
    await pm.page.getByRole('button', { name: /Send to the client/ }).click();
    await pm.page
      .getByRole('dialog', { name: 'Send version 1 to the client?' })
      .getByRole('button', { name: 'Send' })
      .click();
    await expect(
      pm.page.getByText(/Nothing in the project changes until the client accepts/),
    ).toBeVisible();
    // Nothing changed in the project yet.
    await pm.page.goto(projectUrl);
    await expect(pm.page.getByText(/due 31 Mar 2027/)).toBeVisible();
    await expect(pm.page.getByText(/Budget\s*EGP\s50,000\.00/).first()).toBeVisible();
    await pm.close();
  });

  test('the client comments and accepts; the baseline, date and tasks update', async ({
    browser,
  }) => {
    const client = await asUser(browser, CLIENT, /\/portal$/);
    await client.page.goto('/portal/projects');
    await client.page.getByRole('link', { name: 'Nile ordering app' }).click();
    await client.page.getByRole('link', { name: /CR-1 Delivery tracking/ }).click();
    await expect(
      client.page.getByText(/Delivery moves to 30 Apr 2027 \(now 31 Mar 2027\)/),
    ).toBeVisible();
    await expect(client.page.getByText(/EGP\s13,680\.00/).first()).toBeVisible();
    // The internal effort estimate never reaches the client.
    await expect(client.page.getByText(/40h|Effort/)).toHaveCount(0);
    await client.page.getByLabel('Add a comment').fill('Can the map show the driver name?');
    await client.page.getByRole('button', { name: 'Post comment' }).click();
    await expect(client.page.getByText('Can the map show the driver name?')).toBeVisible();
    await review(client.page, SHOTS, 'portal-change');
    await client.page.getByRole('button', { name: 'Accept change' }).click();
    await client.page
      .getByRole('dialog', { name: /Accept CR-1 version 1/ })
      .getByRole('button', { name: 'Accept' })
      .click();
    await expect(client.page.getByText('Accepted: the team will plan the work')).toBeVisible();
    await expect(client.page.getByText('You accepted')).toBeVisible();
    await client.close();

    const pm = await asUser(browser, creds().pm);
    await pm.page.goto(projectUrl);
    await expect(pm.page.getByText(/due 30 Apr 2027/)).toBeVisible();
    const baseline = pm.page.getByRole('region', { name: 'Scope baseline' });
    await expect(baseline.getByRole('link', { name: /CR-1 Delivery tracking/ })).toBeVisible();
    await expect(
      baseline.getByText(/EGP\s50,000\.00\s*originally, now\s*EGP\s62,000\.00/),
    ).toBeVisible();
    await pm.page.getByRole('link', { name: 'Tasks' }).click();
    await expect(pm.page.getByText('Extra: CR-1')).toHaveCount(2);
    await review(pm.page, SHOTS, 'board-extra-work');
    await pm.page.goto(changeUrl);
    await expect(pm.page.getByText('Accepted: the baseline was updated')).toBeVisible();
    await expect(pm.page.getByText(/Budget EGP\s50,000\.00 → EGP\s62,000\.00/)).toBeVisible();
    const comments = pm.page.getByRole('region', { name: 'Comments' });
    await expect(comments.getByText('Can the map show the driver name?')).toBeVisible();
    await comments.getByLabel('Add a comment').fill('Yes, first name only.');
    await comments.getByRole('button', { name: 'Post comment' }).click();
    await expect(comments.getByText('Yes, first name only.')).toBeVisible();
    await review(pm.page, SHOTS, 'change-accepted');
    await pm.close();
  });

  test('a rejected change leaves the baseline exactly as it was', async ({ browser }) => {
    const pm = await asUser(browser, creds().pm);
    await pm.page.goto(`${projectUrl}/changes`);
    await pm.page.getByRole('button', { name: 'New change request' }).click();
    const dialog = pm.page.getByRole('dialog', { name: 'New change request' });
    await dialog.getByLabel(/^Title/).fill('Later launch');
    await dialog.getByLabel(/^What should change/).fill('Launch in June instead of April.');
    await dialog.getByRole('button', { name: 'Create' }).click();
    await expect(pm.page).toHaveURL(/\/changes\/[0-9a-f-]+$/);
    const second = pm.page.url();
    await pm.page.getByLabel(/^Scope change/).fill('No new work; the delivery date moves.');
    await pm.page.getByLabel(/^Price excl\. tax/).fill('0');
    await pm.page.getByLabel(/^New project due date/).fill('2027-06-30');
    await pm.page.getByRole('button', { name: 'Save estimate' }).click();
    await expect(pm.page.getByText('Estimate saved')).toBeVisible();
    // No price: no approval step.
    await expect(pm.page.getByRole('button', { name: 'Submit for approval' })).toHaveCount(0);
    await pm.page.getByRole('button', { name: /Send to the client/ }).click();
    await pm.page
      .getByRole('dialog', { name: 'Send version 1 to the client?' })
      .getByRole('button', { name: 'Send' })
      .click();
    await expect(
      pm.page.getByText(/Nothing in the project changes until the client accepts/),
    ).toBeVisible();
    await pm.close();

    const client = await asUser(browser, CLIENT, /\/portal$/);
    await client.page.goto(`/portal/changes/${second.split('/').pop()}`);
    await client.page.getByRole('button', { name: 'Reject' }).click();
    const reject = client.page.getByRole('dialog', { name: 'Reject this change?' });
    await reject.getByLabel(/^Why/).fill('April is important for us.');
    await reject.getByRole('button', { name: 'Reject' }).click();
    await expect(client.page.getByText('Your answer was sent to the team')).toBeVisible();
    await noSeriousA11y(client.page);
    await client.close();

    const pm2 = await asUser(browser, creds().pm);
    await pm2.page.goto(projectUrl);
    await expect(pm2.page.getByText(/due 30 Apr 2027/)).toBeVisible();
    await expect(
      pm2.page.getByRole('region', { name: 'Scope baseline' }).getByText(/now\s*EGP\s62,000\.00/),
    ).toBeVisible();
    await pm2.page.goto(second);
    await expect(pm2.page.getByText('Rejected', { exact: true }).first()).toBeVisible();
    await expect(pm2.page.getByText(/April is important for us/)).toBeVisible();
    await pm2.close();
  });
});
