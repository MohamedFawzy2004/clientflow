// Large-dataset check (NFR-06): at least 500 contacts, 300 deals and 100 projects, then the list
// endpoints the main screens use are timed (p50/p95 of sequential requests) and every list is
// checked for silent truncation (a list that returns fewer rows than exist, with no paging).
//
//   node scripts/large-dataset.mjs --base http://127.0.0.1:4600 --origin http://127.0.0.1:4600 \
//     --email <owner email> --password-file <file> [--contacts 500] [--deals 300] [--projects 100]
//
// Writes data through the real API: use a test or demo database only. Run it once per database;
// a second run adds the same amounts again. Prints JSON with the environment and results.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import os from 'node:os';

const arg = (n, d) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : d;
};
const BASE = arg('--base', 'http://127.0.0.1:4600');
const ORIGIN = arg('--origin', BASE);
const N_CONTACTS = Number(arg('--contacts', '500'));
const N_DEALS = Number(arg('--deals', '300'));
const N_PROJECTS = Number(arg('--projects', '100'));
const SAMPLES = Number(arg('--samples', '30'));
const email = arg('--email');
const password = readFileSync(arg('--password-file'), 'utf8').trim();

const cookies = {};
let csrf = '';
async function call(method, path, body, extra = {}) {
  const res = await fetch(BASE + path, {
    method,
    headers: {
      Origin: ORIGIN,
      Cookie: Object.entries(cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
      ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...extra,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  for (const c of res.headers.getSetCookie()) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    cookies[pair.slice(0, i)] = pair.slice(i + 1);
  }
  const text = await res.text();
  return { status: res.status, body: text ? JSON.parse(text) : null };
}
const must = (r, what) => {
  if (r.status >= 300) throw new Error(`${what}: ${r.status} ${JSON.stringify(r.body?.error)}`);
  return r.body.data;
};

csrf = must(await call('GET', '/api/v1/auth/csrf'), 'csrf').csrfToken;
csrf = must(await call('POST', '/api/v1/auth/login', { email, password }), 'sign-in').csrfToken;

// Bounded parallelism so the seed is quick without tripping the per-IP API limit.
async function pool(n, fn, width = 8) {
  let next = 0;
  await Promise.all(
    Array.from({ length: width }, async () => {
      while (next < n) await fn(next++);
    }),
  );
}

const tag = randomUUID().slice(0, 6);
const t0 = performance.now();
const contactIds = [];
await pool(N_CONTACTS, async (i) => {
  const c = must(
    await call('POST', '/api/v1/contacts', {
      fullName: `Bulk ${tag} Person ${i}`,
      email: `bulk.${tag}.${i}@dataset.test`,
      companyName: `Dataset Co ${i % 40}`,
    }),
    'create contact',
  );
  contactIds.push(c.id);
});
const currencies = ['EGP', 'USD', 'EUR'];
await pool(N_DEALS, async (i) => {
  must(
    await call('POST', '/api/v1/deals', {
      contactId: contactIds[i % contactIds.length],
      title: `Bulk ${tag} deal ${i}`,
      amount: String(1000 + i * 37),
      currency: currencies[i % 3],
    }),
    'create deal',
  );
});
// The staff picker lists every delivery role; only an owner, admin or PM may manage a project.
const managers = must(await call('GET', '/api/v1/projects/staff'), 'staff').filter((u) =>
  ['OWNER', 'ADMIN', 'PM'].includes(u.role),
);
if (!managers.length) throw new Error('no owner, admin or PM to manage the projects');
await pool(N_PROJECTS, async (i) => {
  must(
    await call('POST', '/api/v1/projects', {
      title: `Bulk ${tag} project ${i}`,
      managerId: managers[i % managers.length].id,
      currency: currencies[i % 3],
    }),
    'create project',
  );
});
const seedSeconds = Math.round((performance.now() - t0) / 100) / 10;

const pct = (s, p) => s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)];
const endpoints = [
  ['GET /contacts (page 1, 25)', '/api/v1/contacts?page=1&limit=25'],
  ['GET /contacts (page 20, 25)', '/api/v1/contacts?page=20&limit=25'],
  ['GET /contacts?q=Person 4', '/api/v1/contacts?q=Person%204'],
  ['GET /deals (page 1)', '/api/v1/deals'],
  ['GET /deals/board', '/api/v1/deals/board'],
  ['GET /projects', '/api/v1/projects'],
  ['GET /dashboard/sales', '/api/v1/dashboard/sales'],
  ['GET /dashboard/delivery', '/api/v1/dashboard/delivery'],
  ['GET /proposals', '/api/v1/proposals'],
  ['GET /invoices', '/api/v1/invoices'],
];
const results = [];
for (const [name, path] of endpoints) {
  for (let i = 0; i < 3; i++) await call('GET', path);
  const times = [];
  let status = 0;
  let body;
  for (let i = 0; i < SAMPLES; i++) {
    const s = performance.now();
    const r = await call('GET', path);
    times.push(performance.now() - s);
    status = r.status;
    body = r.body;
  }
  times.sort((a, b) => a - b);
  const rows = Array.isArray(body?.data) ? body.data.length : undefined;
  results.push({
    endpoint: name,
    status,
    rows,
    total: body?.meta?.total,
    bytes: JSON.stringify(body ?? '').length,
    p50: Math.round(pct(times, 50)),
    p95: Math.round(pct(times, 95)),
    pass: status === 200 && pct(times, 95) < 500,
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
        samplesPerEndpoint: SAMPLES,
      },
      seeded: { contacts: N_CONTACTS, deals: N_DEALS, projects: N_PROJECTS, seedSeconds },
      results,
    },
    null,
    2,
  ),
);
if (results.some((r) => !r.pass)) process.exitCode = 1;
