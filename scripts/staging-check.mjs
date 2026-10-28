// Checks a deployed ClientFlow (staging) from the outside, against the release checklist (spec
// §27, ADR-067). It reads only, apart from one sign-in and sign-out for the owner checks.
//
//   node scripts/staging-check.mjs --base https://clientflow-staging.onrender.com --email you@agency.com
//     [--password-file <file>]   otherwise it asks for the password (hidden)
//     [--code 123456]            the authenticator code, if the account uses two-step sign-in
//     [--allow-http]             local runs only: skips the HTTPS checks instead of failing them
//
// Prints PASS / FAIL / WARN / SKIP per check and exits 1 if anything failed. It never prints the
// password, cookies or tokens.
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';

const arg = (n) => {
  const i = process.argv.indexOf(n);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const BASE = (arg('--base') ?? '').replace(/\/+$/, '');
const EMAIL = arg('--email');
const allowHttp = process.argv.includes('--allow-http');
if (!/^https?:\/\//.test(BASE) || !EMAIL) {
  console.error(
    'Usage: node scripts/staging-check.mjs --base https://… --email you@… [--password-file f]',
  );
  process.exit(2);
}
const isHttps = BASE.startsWith('https://');

const results = [];
const report = (status, name, detail = '') => {
  results.push(status);
  console.log(`${status.padEnd(4)}  ${name}${detail ? ` — ${detail}` : ''}`);
};
const check = (ok, name, detail) => report(ok ? 'PASS' : 'FAIL', name, detail);
const httpsOnly = (name, fn) => {
  if (!isHttps && allowHttp) return report('SKIP', name, 'plain HTTP run (--allow-http)');
  return fn();
};

async function password() {
  const file = arg('--password-file');
  if (file) return readFileSync(file, 'utf8').trim();
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => {
      if (s.includes('Password')) process.stdout.write(s);
    };
    rl.question('Password for the owner account (hidden): ', (answer) => {
      rl.close();
      process.stdout.write('\n');
      resolve(answer);
    });
  });
}

/** The 6-digit code from the authenticator app (two-step sign-in, ADR-069). */
async function totpCode() {
  const given = arg('--code');
  if (given) return given;
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) =>
    rl.question('Code from your authenticator app: ', (answer) => {
      rl.close();
      resolve(answer.trim());
    }),
  );
}

const jar = new Map();
const cookieHeader = () => [...jar].map(([k, v]) => `${k}=${v}`).join('; ');
async function call(path, { method = 'GET', body, headers = {}, origin = BASE } = {}) {
  const res = await fetch(BASE + path, {
    method,
    redirect: 'manual',
    headers: {
      Origin: origin,
      Cookie: cookieHeader(),
      'Accept-Encoding': 'gzip, br',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...headers,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const setCookies = res.headers.getSetCookie();
  for (const c of setCookies) {
    const [pair] = c.split(';');
    const i = pair.indexOf('=');
    jar.set(pair.slice(0, i), pair.slice(i + 1));
  }
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  return { res, json, text, setCookies };
}

const cookieFlags = (c) => {
  const lower = c.toLowerCase();
  return {
    name: c.split('=')[0],
    secure: /;\s*secure/.test(lower),
    httpOnly: /;\s*httponly/.test(lower),
    sameSite: /;\s*samesite=(lax|strict)/.test(lower),
  };
};

console.log(`ClientFlow staging check: ${BASE}  (${new Date().toISOString()})\n`);

// 1. HTTPS
await httpsOnly('HTTP redirects to HTTPS', async () => {
  const res = await fetch(BASE.replace(/^https:/, 'http:') + '/health/live', {
    redirect: 'manual',
  });
  const to = res.headers.get('location') ?? '';
  check(
    [301, 302, 307, 308].includes(res.status) && to.startsWith('https://'),
    'HTTP redirects to HTTPS',
    `${res.status} → ${to || 'no Location'}`,
  );
});

// 2. Health
{
  const live = await call('/health/live');
  check(live.res.status === 200, 'Liveness /health/live', String(live.res.status));
  const ready = await call('/health/ready');
  check(
    ready.res.status === 200 && ready.json?.checks?.database === 'ok',
    'Readiness /health/ready (database)',
    `${ready.res.status} ${ready.text.slice(0, 120)}`,
  );
  if (ready.json?.checks?.jobs && ready.json.checks.jobs !== 'ok')
    report('WARN', 'Background jobs', `jobs: ${ready.json.checks.jobs}`);
}

// 3. Headers on the app page
{
  const page = await call('/app/dashboard');
  const h = page.res.headers;
  check(
    page.res.status === 200 && page.text.includes('<div id="root">'),
    'App page is served',
    String(page.res.status),
  );
  const csp = h.get('content-security-policy') ?? '';
  const scriptSrc = /script-src ([^;]*)/.exec(csp)?.[1] ?? '';
  check(
    /default-src 'self'/.test(csp) &&
      scriptSrc.includes("'self'") &&
      !/unsafe-inline|unsafe-eval/.test(scriptSrc),
    'Content-Security-Policy is strict',
    csp.slice(0, 90),
  );
  check(
    /frame-ancestors 'none'/.test(csp) ||
      (h.get('x-frame-options') ?? '').toUpperCase() === 'DENY' ||
      (h.get('x-frame-options') ?? '').toUpperCase() === 'SAMEORIGIN',
    'Not embeddable in other sites (clickjacking)',
  );
  check((h.get('x-content-type-options') ?? '') === 'nosniff', 'X-Content-Type-Options: nosniff');
  check(
    /no-referrer|strict-origin/.test(h.get('referrer-policy') ?? ''),
    'Referrer-Policy',
    h.get('referrer-policy') ?? 'missing',
  );
  await httpsOnly('HSTS (Strict-Transport-Security)', async () => {
    const hsts = h.get('strict-transport-security') ?? '';
    const age = Number(/max-age=(\d+)/.exec(hsts)?.[1] ?? 0);
    check(age >= 15_552_000, 'HSTS (Strict-Transport-Security)', hsts || 'missing');
  });
  check(!h.get('x-powered-by'), 'No X-Powered-By header');
}

// 4. API basics: error envelope, no compression of API JSON (BREACH), no CORS for other sites
{
  const nope = await call('/api/v1/definitely-not-a-route');
  check(
    nope.res.status === 404 &&
      typeof nope.json?.error?.requestId === 'string' &&
      !/at \w+ \(|node_modules/.test(nope.text),
    '404 uses the error envelope with a request ID, no stack trace',
  );
  const csrf = await call('/api/v1/auth/csrf');
  check(
    !csrf.res.headers.get('content-encoding'),
    'API JSON is not compressed (BREACH)',
    csrf.res.headers.get('content-encoding') ?? 'identity',
  );
  check(
    (csrf.res.headers.get('cache-control') ?? '').includes('no-store'),
    'API responses are not cached',
    csrf.res.headers.get('cache-control') ?? 'missing',
  );
  const pre = csrf.setCookies.map(cookieFlags);
  check(
    pre.length > 0 && pre.every((c) => c.httpOnly && c.sameSite),
    'Pre-sign-in cookie is HttpOnly and SameSite',
    pre.map((c) => c.name).join(', '),
  );
  await httpsOnly('Pre-sign-in cookie is Secure with the __Host- prefix', async () => {
    check(
      pre.length > 0 && pre.every((c) => c.secure && c.name.startsWith('__Host-')),
      'Pre-sign-in cookie is Secure with the __Host- prefix',
      pre.map((c) => c.name).join(', '),
    );
  });
  const cors = await fetch(BASE + '/api/v1/auth/me', {
    method: 'OPTIONS',
    headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
  });
  check(!cors.headers.get('access-control-allow-origin'), 'No CORS access for other sites');
  const foreign = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: 'x' },
    origin: 'https://evil.example',
    headers: { 'X-CSRF-Token': csrf.json?.data?.csrfToken ?? '' },
  });
  check(
    foreign.res.status === 403,
    'Sign-in from another origin is refused',
    String(foreign.res.status),
  );
  const noToken = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: 'x' },
  });
  check(
    noToken.res.status === 403,
    'Sign-in without the CSRF token is refused',
    String(noToken.res.status),
  );
}

// 5. Signed in as the owner
{
  const pre = await call('/api/v1/auth/csrf');
  let login = await call('/api/v1/auth/login', {
    method: 'POST',
    body: { email: EMAIL, password: await password() },
    headers: { 'X-CSRF-Token': pre.json?.data?.csrfToken ?? '' },
  });
  if (login.res.status === 200 && login.json?.data?.mfaRequired) {
    const raw = login.setCookies.find((c) => /cf_mfa/.test(c)) ?? '';
    const challenge = cookieFlags(raw);
    check(
      challenge.httpOnly && /samesite=strict/i.test(raw),
      'Two-step challenge cookie is HttpOnly and SameSite=Strict',
      challenge.name || 'missing',
    );
    login = await call('/api/v1/auth/mfa/verify', {
      method: 'POST',
      body: { code: await totpCode() },
      headers: { 'X-CSRF-Token': pre.json?.data?.csrfToken ?? '' },
    });
    check(login.res.status === 200, 'Two-step sign-in code accepted', String(login.res.status));
  } else if (login.res.status === 200 && isHttps) {
    report(
      'WARN',
      'Two-step sign-in',
      'the owner signed in without a code: is MFA_REQUIRED_ROLES set?',
    );
  }
  if (login.res.status !== 200) {
    report('FAIL', 'Owner sign-in', `HTTP ${login.res.status} ${login.json?.error?.code ?? ''}`);
  } else {
    report('PASS', 'Owner sign-in');
    const session = login.setCookies.map(cookieFlags).filter((c) => /session/.test(c.name));
    check(
      session.length === 1 && session[0].httpOnly && session[0].sameSite,
      'Session cookie is HttpOnly and SameSite',
      session.map((c) => c.name).join(', '),
    );
    await httpsOnly('Session cookie is Secure with the __Host- prefix', async () => {
      check(
        session.length === 1 && session[0].secure && session[0].name.startsWith('__Host-'),
        'Session cookie is Secure with the __Host- prefix',
      );
    });
    const csrfToken = login.json?.data?.csrfToken ?? '';
    const ops = await call('/api/v1/ops/status');
    if (ops.res.status !== 200) {
      report('FAIL', 'System status', `HTTP ${ops.res.status}`);
    } else {
      const s = ops.json.data;
      check(s.rateLimits === 'postgres', 'Sign-in limits are shared in PostgreSQL', s.rateLimits);
      if (s.scanner === 'ok') report('PASS', 'Virus scanner answers');
      else if (s.scanner === 'unreachable')
        report('FAIL', 'Virus scanner', 'configured but not reachable: uploads are refused');
      else report('WARN', 'Virus scanner', 'none configured: uploads get built-in checks only');
      check(
        !s.jobs.lagging && s.jobs.dead === 0,
        'Background jobs on time, none failed',
        `pending ${s.jobs.pending}, failed ${s.jobs.dead}`,
      );
      const ip = s.clientIp ?? '';
      const privateIp =
        /^(10\.|127\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.|::1$|fc|fd|fe80)/i.test(
          ip.replace(/^::ffff:/, ''),
        );
      if (!isHttps && allowHttp) report('SKIP', 'TRUST_PROXY', `the server sees ${ip} (local run)`);
      else if (privateIp)
        report(
          'FAIL',
          'TRUST_PROXY',
          `the server sees ${ip}, a proxy address: raise TRUST_PROXY by 1 and redeploy`,
        );
      else
        report(
          'WARN',
          'TRUST_PROXY',
          `the server sees you as ${ip}: confirm it is your public IP (search "what is my IP")`,
        );
      report('INFO', 'Release', s.release ?? 'APP_RELEASE not set');
    }
    const out = await call('/api/v1/auth/logout', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
    });
    check(out.res.status === 204 || out.res.status === 200, 'Sign-out', String(out.res.status));
    const after = await call('/api/v1/auth/me');
    check(after.res.status === 401, 'The old session no longer works', String(after.res.status));
  }
}

const failed = results.filter((r) => r === 'FAIL').length;
console.log(
  `\n${failed === 0 ? 'All checks passed' : `${failed} check(s) FAILED`} (${results.filter((r) => r === 'WARN').length} to confirm by hand).`,
);
process.exitCode = failed === 0 ? 0 : 1;
