/**
 * Whether this deployment is a public demo (ADR-071), as stamped into index.html by the API that
 * serves the built app (withDemoModeFlag in apps/api/src/app.ts). Known before the first paint,
 * so the sign-in page can lay itself out once.
 *
 * `undefined` when the page carries no flag (the Vite dev server serves its own index.html): the
 * app then asks the API, as it did before the flag existed.
 */
export function demoModeFromPage(): boolean | undefined {
  if (typeof document === 'undefined') return undefined;
  const flag = document.querySelector('meta[name="clientflow-demo-mode"]')?.getAttribute('content');
  if (flag === 'on') return true;
  if (flag === 'off') return false;
  return undefined;
}
