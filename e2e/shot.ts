import type { Page, PageScreenshotOptions } from '@playwright/test';

/**
 * Saves review screenshots only when CAPTURE_SCREENSHOTS=1 (`npm run e2e:screenshots`), so normal
 * test runs do not rewrite the committed images. Layout assertions run either way.
 */
export async function shot(
  page: Page,
  path: string,
  options: Omit<PageScreenshotOptions, 'path'> = {},
) {
  if (process.env.CAPTURE_SCREENSHOTS === '1') await page.screenshot({ ...options, path });
}
