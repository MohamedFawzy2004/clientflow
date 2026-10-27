// M9 gate: invoice tracking on the real API + PostgreSQL (spec J5; FR-F01 – FR-F10). Exact
// totals, the issue snapshot, idempotent payments and the role checks also run in
// apps/api/tests/invoices.test.ts and the permission matrix. Setup uses the API; the journey uses
// the UI.
import { expect, test } from '@playwright/test';
import { acceptInvite, api, asUser, creds, review, signIn } from './support';

const SHOTS = 'docs/milestones/m9-screenshots';
const CLIENT = {
  email: 'karim@delta.test',
  name: 'Karim Fouad',
  password: 'delta-harbour-violet-77',
};

let projectUrl = '';
let invoiceUrl = '';
let reference = '';

test.describe.serial('M9 invoice tracking', () => {
  test('setup: an active project with a milestone, shared with a client (API)', async ({
    browser,
  }) => {
    const owner = await asUser(browser, creds().owner);
    const contact = await api(owner.page, 'POST', '/api/v1/contacts', {
      fullName: 'Karim Fouad',
      companyName: 'Delta Logistics',
    });
    const org = await api(owner.page, 'POST', `/api/v1/contacts/${contact.id}/client-org`, {
      name: 'Delta Logistics',
    });
    const invite = await api(owner.page, 'POST', `/api/v1/client-orgs/${org.id}/invitations`, {
      email: CLIENT.email,
    });
    const staff = (await api(owner.page, 'GET', '/api/v1/projects/staff')) as Array<{
      id: string;
      name: string;
    }>;
    const project = await api(owner.page, 'POST', '/api/v1/projects', {
      title: 'Delta fleet portal',
      managerId: staff.find((u) => u.name === 'Pat Morgan')!.id,
      currency: 'EGP',
      budget: '50000',
      dueOn: '2027-03-31',
    });
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/milestones`, {
      title: 'Design approved',
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
    projectUrl = `/app/projects/${project.id}`;
    const client = await acceptInvite(browser, invite.acceptUrl, CLIENT);
    await client.close();
    const shares = await api(owner.page, 'GET', `/api/v1/projects/${project.id}/shares`);
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/shares`, {
      userId: shares.people[0].user.id,
    });
    await owner.close();
  });

  test('finance drafts an invoice from the milestone, with exact totals', async ({ page }) => {
    await signIn(page, creds().finance);
    await page.getByRole('link', { name: 'Invoices' }).first().click();
    await expect(page.getByRole('heading', { name: 'Invoices', level: 1 })).toBeVisible();
    await page.getByRole('button', { name: 'New invoice' }).click();
    const dialog = page.getByRole('dialog', { name: 'New invoice' });
    await dialog.getByLabel(/^Client/).selectOption({ label: 'Delta Logistics' });
    await dialog.getByLabel(/^Project/).selectOption({ label: 'Delta fleet portal (EGP)' });
    await dialog.getByLabel(/^Due/).fill('2026-12-15');
    await dialog.getByRole('button', { name: 'Create draft' }).click();
    await expect(page).toHaveURL(/\/app\/invoices\/[0-9a-f-]+$/);
    invoiceUrl = new URL(page.url()).pathname;

    await page
      .getByLabel('Add from the project')
      .selectOption({ label: 'Milestone: Design approved' });
    await expect(page.getByLabel('Line 1 description')).toHaveValue('Milestone: Design approved');
    await page.getByLabel('Line 1 unit price (EGP)').fill('20000');
    await page.getByRole('button', { name: 'Add line' }).click();
    await page.getByLabel('Line 2 description').fill('Hosting, two months');
    await page.getByLabel('Line 2 quantity').fill('2');
    await page.getByLabel('Line 2 unit price (EGP)').fill('1500');
    await page.getByLabel(/^Tax \(%\)/).fill('14');
    await page
      .getByLabel(/^Payment terms/)
      .fill('Bank transfer within 30 days to the account on file.');
    // 20,000 + 2 × 1,500 = 23,000; 14% tax = 3,220; total 26,220.
    const totals = page.locator('dl').filter({ hasText: 'Subtotal' });
    await expect(totals.getByText(/23,000\.00/)).toBeVisible();
    await expect(totals.getByText(/3,220\.00/)).toBeVisible();
    await expect(totals.getByText(/26,220\.00/)).toBeVisible();
    await page.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft saved')).toBeVisible();
    await expect(page.getByText('Draft saved')).toBeHidden({ timeout: 10_000 });
    await expect(page.getByText('No time logged yet, so the cost is not known.')).toBeVisible();
    await review(page, SHOTS, 'invoice-draft');
  });

  test('finance issues and publishes it; the content is then frozen', async ({ page }) => {
    await signIn(page, creds().finance);
    await page.goto(invoiceUrl);
    await page.getByRole('button', { name: 'Issue invoice' }).click();
    await page
      .getByRole('dialog', { name: 'Issue this invoice?' })
      .getByRole('button', { name: 'Issue' })
      .click();
    await expect(page.getByText('Invoice issued')).toBeVisible();
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toHaveText(/^INV-\d{4}$/);
    reference = (await heading.textContent())!;
    await expect(page.getByRole('button', { name: 'Save draft' })).toHaveCount(0);
    await expect(page.getByText('Billed to')).toBeVisible();
    await page.getByRole('button', { name: 'Show in client portal' }).click();
    await page
      .getByRole('dialog', { name: 'Show it in the client portal?' })
      .getByRole('button', { name: 'Show' })
      .click();
    await expect(page.getByText('In the client portal')).toBeVisible();
  });

  test('payments: partial, then the rest; a PM cannot record one', async ({ page, browser }) => {
    await signIn(page, creds().finance);
    await page.goto(invoiceUrl);
    await page.getByLabel(/^Amount \(EGP\)/).fill('10000');
    await page.getByLabel(/^Reference/).fill('CIB-TRX-4471');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Payment recorded')).toBeVisible();
    await expect(page.getByText('Partly paid', { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText(/Record a payment you received \(EGP\s16,220\.00 open\)/),
    ).toBeVisible();
    await page.getByLabel(/^Amount \(EGP\)/).fill('16220');
    await page.getByRole('button', { name: 'Record payment' }).click();
    await expect(page.getByText('Paid', { exact: true }).first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    await review(page, SHOTS, 'invoice-paid');

    // FR-F04 / T-PAY-02: the PM reads the invoice but the API refuses a payment from them.
    const pm = await asUser(browser, creds().pm);
    await pm.page.goto(invoiceUrl);
    await expect(pm.page.getByRole('heading', { name: reference })).toBeVisible();
    await expect(pm.page.getByRole('button', { name: 'Record payment' })).toHaveCount(0);
    const csrf = (await (await pm.page.request.get('/api/v1/auth/csrf')).json()).data.csrfToken;
    const id = invoiceUrl.split('/').pop();
    const res = await pm.page.request.post(`/api/v1/invoices/${id}/payments`, {
      data: { amount: '1.00', receivedOn: '2026-10-27' },
      headers: {
        'X-CSRF-Token': csrf,
        Origin: new URL(pm.page.url()).origin,
        'Idempotency-Key': crypto.randomUUID(),
      },
    });
    expect(res.status()).toBe(403);
    await pm.page.goto(projectUrl);
    const money = pm.page.getByRole('region', { name: 'Project money' });
    await expect(money.getByText(/EGP\s26,220\.00/).first()).toBeVisible();
    await expect(money.getByText(/Estimated margin/)).toBeVisible();
    await review(pm.page, SHOTS, 'project-money');
    await pm.close();
  });

  test('the client sees the invoice as paid in the portal', async ({ page }) => {
    await signIn(page, CLIENT, /\/portal$/);
    await page
      .getByRole('navigation', { name: 'Portal' })
      .getByRole('link', { name: 'Invoices' })
      .click();
    await expect(page.getByText(/does not take payments/)).toBeVisible();
    await page.getByRole('link', { name: new RegExp(reference) }).click();
    await expect(page.getByRole('heading', { name: reference })).toBeVisible();
    await expect(page.getByText('Paid', { exact: true })).toBeVisible();
    await expect(
      page.getByText('Bank transfer within 30 days to the account on file.'),
    ).toBeVisible();
    // Internal fields never reach the portal.
    await expect(page.getByText('CIB-TRX-4471')).toHaveCount(0);
    await expect(page.getByText(/recorded by/)).toHaveCount(0);
    await review(page, SHOTS, 'portal-invoice');
  });

  test('the finance report and CSV export agree with the payments', async ({ page }) => {
    await signIn(page, creds().finance);
    await page.goto('/app/reports/finance');
    const egp = page.getByRole('region', { name: 'In EGP' });
    await expect(egp.getByText(/Invoiced \(1\)/)).toBeVisible();
    await expect(egp.getByText(/EGP\s26,220\.00/).first()).toBeVisible();
    await expect(page.getByRole('link', { name: new RegExp(reference) })).toBeVisible();
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('link', { name: 'Export CSV' }).click(),
    ]);
    const csv = await (await download.createReadStream()).toArray();
    const text = Buffer.concat(csv).toString('utf8');
    expect(text).toContain(reference);
    expect(text).toContain('Delta Logistics');
    await review(page, SHOTS, 'finance-report');
  });

  test('the owner sets a cost rate; finance can read it but not change it', async ({ browser }) => {
    const owner = await asUser(browser, creds().owner);
    await owner.page.goto('/app/finance/cost-rates');
    await owner.page.getByRole('button', { name: 'Set rate for Mina Adel' }).click();
    const dialog = owner.page.getByRole('dialog', { name: 'Cost rate for Mina Adel' });
    await dialog.getByLabel(/^Hourly cost/).fill('250');
    await dialog.getByLabel(/^Effective from/).fill('2026-10-01');
    await dialog.getByRole('button', { name: 'Save rate' }).click();
    await expect(owner.page.getByText('Cost rate saved')).toBeVisible();
    await owner.close();

    const finance = await asUser(browser, creds().finance);
    await finance.page.goto('/app/finance/cost-rates');
    await expect(finance.page.getByText(/EGP\s250\.00 an hour since 1 Oct 2026/)).toBeVisible();
    await expect(finance.page.getByRole('button', { name: /Set rate/ })).toHaveCount(0);
    await review(finance.page, SHOTS, 'cost-rates');
    await finance.close();
  });
});
