// Repeatable Lighthouse run for a signed-in page (NFR-03). Signs in through the real API, passes
// the session cookie to Lighthouse, and prints one line per run plus the largest-paint element.
//
//   node scripts/lighthouse.mjs --base http://127.0.0.1:4600 --path /app/dashboard \
//     --email <user> --password-file <file> [--runs 3] [--desktop]
//
// Uses the installed Edge or Chrome (CHROME_PATH to choose). Reports go to the scratch folder
// given by --out (default: .lighthouse, gitignored). From Git Bash, set MSYS_NO_PATHCONV=1 so
// `--path /app/...` is not rewritten into a Windows path.
import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg('--base', 'http://127.0.0.1:4600');
const PATH = arg('--path', '/app/dashboard');
const RUNS = Number(arg('--runs', '3'));
const OUT = arg('--out', '.lighthouse');
const desktop = process.argv.includes('--desktop');
const email = arg('--email');
const password = readFileSync(arg('--password-file'), 'utf8').trim();

const jar = new Map();
async function call(method, path, body, csrf) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Origin: BASE,
      Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  return res.json();
}
const pre = await call('GET', '/api/v1/auth/csrf');
const login = await call('POST', '/api/v1/auth/login', { email, password }, pre.data.csrfToken);
if (!login.data) throw new Error(`sign-in failed: ${JSON.stringify(login.error)}`);

mkdirSync(OUT, { recursive: true });
const headers = join(OUT, 'headers.json');
writeFileSync(
  headers,
  JSON.stringify({ Cookie: [...jar].map(([k, v]) => `${k}=${v}`).join('; ') }),
);

const name = PATH.replace(/\W+/g, '-').replace(/^-|-$/g, '') || 'root';
for (let run = 1; run <= RUNS; run++) {
  const report = join(OUT, `${name}-${desktop ? 'desktop' : 'mobile'}-${run}.json`);
  // Lighthouse sometimes fails to record a trace (NO_NAVSTART): try a run up to four times.
  let res;
  for (let attempt = 0; attempt < 4; attempt++) {
    res = spawnSync(
      'npx',
      [
        '--yes',
        'lighthouse@13.5.0',
        BASE + PATH,
        '--quiet',
        '--only-categories=performance',
        `--extra-headers=${headers}`,
        '--output=json',
        `--output-path=${report}`,
        '--chrome-flags=--headless=new',
        ...(desktop ? ['--preset=desktop'] : []),
      ],
      { stdio: 'inherit', shell: process.platform === 'win32' },
    );
    if (res.status === 0) break;
  }
  if (res.status !== 0) throw new Error(`lighthouse failed with ${res.status}`);
  const r = JSON.parse(readFileSync(report, 'utf8'));
  const a = r.audits;
  const lcpEl = a['largest-contentful-paint-element']?.details?.items?.[0]?.items?.[0]?.node;
  console.log(
    `${PATH} ${desktop ? 'desktop' : 'mobile'} run ${run}: perf ${Math.round(r.categories.performance.score * 100)}` +
      `  LCP ${Math.round(a['largest-contentful-paint'].numericValue)} ms` +
      `  TBT ${Math.round(a['total-blocking-time'].numericValue)} ms` +
      `  FCP ${Math.round(a['first-contentful-paint'].numericValue)} ms` +
      (lcpEl ? `  LCP element: ${lcpEl.nodeLabel?.slice(0, 60)} (${lcpEl.selector})` : ''),
  );
}
