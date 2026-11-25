// Final closure: mobile behaviour changed in this release. The project plan opens on an agenda
// on a phone (no sideways scrolling) and keeps the timeline one tap away; desktop keeps the
// timeline. Same-day tasks are drawn once with a count. The relationship map pinch-zooms, still
// lets a one-finger swipe scroll the page, and opens a details sheet for a selection on a phone.
// The dashboard's lower sections load as they scroll into view. Setup uses the API; the checks
// use the UI.
import { expect, test } from '@playwright/test';
import { api, asUser, creds, noOverflow, noSeriousA11y, signIn } from './support';

let planUrl = '';

test.describe.serial('Final closure mobile behaviour', () => {
  test('setup: a lead, and a project with a milestone and two same-day tasks (API)', async ({
    browser,
  }) => {
    const owner = await asUser(browser, creds().owner);
    // One sourced lead, so the dashboard shows its sales sections rather than "Getting started".
    await api(owner.page, 'POST', '/api/v1/contacts', {
      fullName: 'Mona Saleh',
      companyName: 'Closure Studio',
      source: 'WEBSITE',
    });
    const staff = (await api(owner.page, 'GET', '/api/v1/projects/staff')) as Array<{
      id: string;
      name: string;
    }>;
    const project = await api(owner.page, 'POST', '/api/v1/projects', {
      title: 'Closure agenda check',
      managerId: staff.find((u) => u.name === 'Pat Morgan')!.id,
      currency: 'EGP',
      budget: '10000',
      dueOn: '2027-06-30',
    });
    await api(owner.page, 'POST', `/api/v1/projects/${project.id}/milestones`, {
      title: 'Wireframes signed off',
      dueOn: '2027-02-15',
    });
    const plan = (await api(owner.page, 'GET', `/api/v1/projects/${project.id}/plan`)) as {
      milestones: Array<{ id: string; title: string }>;
    };
    const milestone = plan.milestones.find((m) => m.title === 'Wireframes signed off')!;
    for (const title of ['Draft wireframes', 'Review wireframes'])
      await api(owner.page, 'POST', `/api/v1/projects/${project.id}/tasks`, {
        title,
        milestoneId: milestone.id,
        dueOn: '2027-02-10',
      });
    planUrl = `/app/projects/${project.id}/plan`;
    await owner.close();
  });

  test('a phone opens the plan on the agenda, and the timeline is one tap away', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, creds().owner);
    await page.goto(planUrl);
    const view = page.getByRole('group', { name: 'Plan view' });
    await expect(view.getByRole('button', { name: 'Agenda' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await expect(page.getByText('Draft wireframes')).toBeVisible();
    await expect(page.getByText('Review wireframes')).toBeVisible();
    await expect(page.getByText('Wireframes signed off due')).toBeVisible();
    await noOverflow(page);
    await noSeriousA11y(page);

    await view.getByRole('button', { name: 'Timeline' }).click();
    await expect(page).toHaveURL(/view=timeline/);
    await expect(page.getByRole('region', { name: /drawing$/ })).toBeVisible();
    await noOverflow(page);
  });

  test('desktop opens on the timeline and draws same-day tasks once, with a count', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signIn(page, creds().owner);
    await page.goto(planUrl);
    await expect(
      page.getByRole('group', { name: 'Plan view' }).getByRole('button', { name: 'Timeline' }),
    ).toHaveAttribute('aria-pressed', 'true');
    const chip = page.locator('[data-cluster]').filter({ hasText: '2' });
    await expect(chip).toHaveCount(1);
    await expect(chip).toHaveAttribute('title', /Draft wireframes.*; .*Review wireframes/);
    await noSeriousA11y(page);
  });

  test('the relationship map pinch-zooms on a phone and still lets the page scroll', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, creds().owner);
    await page.goto('/app/relationships');
    // A phone opens on the list; the map is one tap away.
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const canvas = page.getByRole('group', { name: /^Map canvas/ });
    await expect(canvas).toBeVisible();
    // Unzoomed, a vertical swipe scrolls the page instead of being swallowed by the map.
    await expect(canvas).toHaveCSS('touch-action', 'pan-y');
    const zoomOut = page.getByRole('button', { name: 'Zoom out' });
    await expect(zoomOut).toBeDisabled();
    await canvas.evaluate((el) => {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      const fire = (type: string, id: number, x: number) =>
        el.dispatchEvent(
          new PointerEvent(type, {
            pointerId: id,
            pointerType: 'touch',
            clientX: x,
            clientY: cy,
            bubbles: true,
            isPrimary: id === 1,
          }),
        );
      fire('pointerdown', 1, cx - 20);
      fire('pointerdown', 2, cx + 20);
      fire('pointermove', 1, cx - 60);
      fire('pointermove', 2, cx + 60);
      fire('pointerup', 1, cx - 60);
      fire('pointerup', 2, cx + 60);
    });
    await expect(zoomOut).toBeEnabled();
    await expect(canvas).toHaveCSS('touch-action', 'none');
    await noOverflow(page);
  });

  test('on a phone, selecting a map record opens a details sheet', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page, creds().owner);
    await page.goto('/app/relationships');
    await page.getByRole('button', { name: 'Map', exact: true }).click();
    const node = page.locator('svg g[role="button"]').first();
    const name = (await node.getAttribute('aria-label'))!.split(': ')[1]!.split(',')[0]!;
    await node.click();
    const sheet = page.getByRole('region', { name: 'Selected record' });
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText(name);
    await sheet.getByRole('button', { name: 'Details' }).click();
    await expect(page.getByRole('heading', { name: 'Selected', exact: true })).toBeInViewport();
    await sheet.getByRole('button', { name: 'Clear selection' }).click();
    await expect(sheet).toBeHidden();
    await noOverflow(page);
  });

  test('the dashboard shows its lower sections on a phone once scrolled to', async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page, creds().owner);
    const sources = page.getByRole('heading', { name: 'Lead sources' });
    await sources.scrollIntoViewIfNeeded();
    await expect(sources).toBeVisible();
    await noOverflow(page);
  });
});
