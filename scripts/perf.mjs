// Repeatable local load test (NFR-02): p95 per endpoint for reads and writes, measured with the
// real API and PostgreSQL. Prints the environment and data size with the results.
//
//   node scripts/perf.mjs --base http://127.0.0.1:4600 --origin http://127.0.0.1:4600 \
//     --email <staff email> --password-file <file with the password> [--requests 300] [--concurrency 10]
//
// It adds 2,000 fictional contacts through the CSV import API once (so lists are not tiny), then
// runs each scenario. Use a test database only: it writes data.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg('--base', 'http://127.0.0.1:4600');
const ORIGIN = arg('--origin', BASE);
const N = Number(arg('--requests', '300'));
const C = Number(arg('--concurrency', '10'));
const email = arg('--email');
const password = readFileSync(arg('--password-file'), 'utf8').trim();

let cookies = {};
const cookieHeader = () =>
  Object.entries(cookies)
    .map(([k, v]) => `${k}=${v}`)
    .join('; ');
function keep(res) {
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies[pair.slice(0, i)] = pair.slice(i + 1);
  }
}
let csrf = '';
async function call(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: cookieHeader(),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  keep(res);
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}

// Sign in.
const pre = await call('GET', '/api/v1/auth/csrf');
csrf = pre.body.data.csrfToken;
const login = await call('POST', '/api/v1/auth/login', { email, password });
if (login.status !== 200) throw new Error(`sign-in failed: ${login.status}`);
csrf = login.body.data.csrfToken;

// Data: 2,000 contacts through the real import (idempotent by key).
const rows = ['Name,Email,Company,Source'];
for (let i = 0; i < 2000; i++) rows.push(`Perf Person ${i},perf.${i}@load.test,Load Co ${i % 50},Website`);
const csv = rows.join('\n');
const preview = await call('POST', '/api/v1/imports/preview', { kind: 'contacts', csv });
await call(
  'POST',
  '/api/v1/imports',
  { kind: 'contacts', csv, mapping: preview.body.data.mapping, fileSha256: preview.body.data.fileSha256 },
  { 'Idempotency-Key': '00000000-0000-4000-8000-00000000f00d' },
);
const contacts = await call('GET', '/api/v1/contacts?limit=1');
const total = contacts.body.meta?.total ?? contacts.body.data?.total ?? 'n/a';

const scenarios = [
  { name: 'GET /contacts (page 1, 25)', kind: 'read', run: () => call('GET', '/api/v1/contacts?page=1&limit=25') },
  { name: 'GET /contacts?q=Person 1', kind: 'read', run: () => call('GET', '/api/v1/contacts?q=Person%201') },
  { name: 'GET /deals/board', kind: 'read', run: () => call('GET', '/api/v1/deals/board') },
  { name: 'GET /dashboard/sales', kind: 'read', run: () => call('GET', '/api/v1/dashboard/sales') },
  { name: 'GET /invoices', kind: 'read', run: () => call('GET', '/api/v1/invoices') },
  { name: 'GET /notifications', kind: 'read', run: () => call('GET', '/api/v1/notifications') },
  {
    name: 'POST /contacts',
    kind: 'write',
    run: () => call('POST', '/api/v1/contacts', { fullName: `Load ${randomUUID().slice(0, 8)}` }),
  },
];

const pct = (sorted, p) => sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
const results = [];
for (const s of scenarios) {
  for (let i = 0; i < 10; i++) await s.run(); // warm-up
  const times = [];
  let errors = 0;
  let next = 0;
  await Promise.all(
    Array.from({ length: C }, async () => {
      while (next < N) {
        next += 1;
        const t0 = performance.now();
        const r = await s.run();
        times.push(performance.now() - t0);
        if (r.status >= 400) errors += 1;
      }
    }),
  );
  times.sort((a, b) => a - b);
  const target = s.kind === 'read' ? 500 : 800;
  results.push({
    scenario: s.name,
    requests: times.length,
    errors,
    p50: Math.round(pct(times, 50)),
    p95: Math.round(pct(times, 95)),
    max: Math.round(times.at(-1)),
    target,
    pass: errors === 0 && pct(times, 95) < target,
  });
}
console.log(
  JSON.stringify(
    {
      environment: {
        os: `${os.type()} ${os.release()}`,
        cpu: os.cpus()[0]?.model,
        cores: os.cpus().length,
        memoryGb: Math.round(os.totalmem() / 2 ** 30),
        node: process.version,
        concurrency: C,
        contactsInDatabase: total,
      },
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
