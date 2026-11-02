// Shared E2E helpers (from M8; the M6/M7 specs keep their own copies).
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Browser, type Page } from '@playwright/test';
import { shot } from './shot';

export type Who = 'owner' | 'admin' | 'pm' | 'member' | 'salesA' | 'salesB' | 'finance';
export const creds = () =>
  JSON.parse(readFileSync('e2e/.auth/credentials.json', 'utf8')) as Record<
    Who,
    { email: string; password: string }
  >;

export async function signIn(
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

export async function asUser(
  browser: Browser,
  who: { email: string; password: string },
  home?: RegExp,
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  await signIn(page, who, home);
  return { page, close: () => context.close() };
}

export async function noSeriousA11y(page: Page) {
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

export async function noOverflow(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: innerWidth,
  }));
  expect(sw).toBeLessThanOrEqual(iw);
}

/** Checks a screen at 360px (no sideways scroll, no serious axe issue) and saves both widths. */
export async function review(page: Page, dir: string, name: string) {
  await noSeriousA11y(page);
  await page.setViewportSize({ width: 1440, height: 900 });
  await shot(page, `${dir}/${name}-1440.png`, { fullPage: true });
  await page.setViewportSize({ width: 360, height: 800 });
  await noOverflow(page);
  await noSeriousA11y(page);
  await shot(page, `${dir}/${name}-360.png`, { fullPage: true });
  await page.setViewportSize({ width: 1280, height: 800 });
}

/** A direct API call with the page's session and CSRF token (for setup only). */
export async function api(
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

/** Accepts a portal invitation in a fresh browser context and returns the signed-in page. */
export async function acceptInvite(
  browser: Browser,
  acceptUrl: string,
  who: { name: string; password: string },
) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const url = new URL(acceptUrl);
  await page.goto(url.pathname + url.hash);
  await page.getByLabel(/^Your name/).fill(who.name);
  await page.getByLabel(/^Password/).fill(who.password);
  await page.getByLabel(/^Confirm password/).fill(who.password);
  await page.getByRole('button', { name: 'Create account and sign in' }).click();
  await expect(page).toHaveURL(/\/portal$/);
  return { page, close: () => context.close() };
}
