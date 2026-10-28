// M12.1 — Resend email adapter (ADR-068, FR-A03). No real email is ever sent: fetch is faked.
import { Writable } from 'node:stream';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.js';
import { ResendMailer, createMailer, sendOrReport } from '../src/lib/mailer.js';
import { createLogger } from '../src/middleware/logger.js';
import { login, makeApp, ORIGIN, resetDb, seedAgency } from './helpers.js';

function capture() {
  const lines: string[] = [];
  const logger = createLogger(
    'info',
    new Writable({
      write(chunk, _e, cb) {
        lines.push(chunk.toString());
        cb();
      },
    }),
  );
  return { logger, lines };
}

function fakeFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const r = responses.shift() ?? { status: 200, body: { id: 'msg_1' } };
    return new Response(JSON.stringify(r.body), { status: r.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const MESSAGE = {
  to: 'person@client.test',
  subject: 'You are invited',
  text: 'Accept here: https://crm.example.test/activate-invite#token=abc',
  kind: 'invitation',
  idempotencyKey: 'job-123:invitation',
};

describe('ResendMailer', () => {
  it('posts one plain-text email with the idempotency key and logs no recipient', async () => {
    const { logger, lines } = capture();
    const { impl, calls } = fakeFetch([{ status: 200, body: { id: 'msg_42' } }]);
    const mailer = new ResendMailer(
      're_testkey123456',
      'ClientFlow <noreply@example.test>',
      logger,
      impl,
    );
    await mailer.send(MESSAGE);

    expect(calls).toHaveLength(1);
    const { url, init } = calls[0]!;
    expect(url).toBe('https://api.resend.com/emails');
    expect(init.method).toBe('POST');
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer re_testkey123456');
    expect(headers['Idempotency-Key']).toBe('job-123:invitation');
    const body = JSON.parse(String(init.body));
    expect(body).toEqual({
      from: 'ClientFlow <noreply@example.test>',
      to: ['person@client.test'],
      subject: 'You are invited',
      text: MESSAGE.text,
      tags: [{ name: 'kind', value: 'invitation' }],
    });
    expect(body.html).toBeUndefined();
    const log = lines.join('');
    expect(log).toContain('msg_42');
    expect(log).not.toContain('person@client.test');
    expect(log).not.toContain('#token=');
  });

  it('throws on a refusal and logs only the error name, not the message', async () => {
    const { logger, lines } = capture();
    const { impl } = fakeFetch([
      {
        status: 422,
        body: { name: 'validation_error', message: 'Invalid `to` field: person@client.test' },
      },
    ]);
    const mailer = new ResendMailer('re_testkey123456', 'noreply@example.test', logger, impl);
    await expect(mailer.send(MESSAGE)).rejects.toThrow(/HTTP 422/);
    const log = lines.join('');
    expect(log).toContain('validation_error');
    expect(log).not.toContain('person@client.test');
  });

  it('a retried job reuses the same key, so Resend can drop the repeat', async () => {
    const { logger } = capture();
    const { impl, calls } = fakeFetch([
      { status: 500, body: { name: 'internal_server_error' } },
      { status: 200, body: { id: 'msg_2' } },
    ]);
    const mailer = new ResendMailer('re_testkey123456', 'noreply@example.test', logger, impl);
    await expect(mailer.send(MESSAGE)).rejects.toThrow();
    await mailer.send(MESSAGE);
    const keys = calls.map((c) => (c.init.headers as Record<string, string>)['Idempotency-Key']);
    expect(keys).toEqual(['job-123:invitation', 'job-123:invitation']);
  });

  it('sendOrReport turns a provider failure into "failed" instead of an error', async () => {
    const { logger } = capture();
    const { impl } = fakeFetch([{ status: 503, body: {} }]);
    const mailer = new ResendMailer('re_testkey123456', 'noreply@example.test', logger, impl);
    expect(await sendOrReport(mailer, logger, MESSAGE)).toBe('failed');
  });
});

describe('mail configuration', () => {
  const base = {
    DATABASE_URL: 'postgresql://u:p@localhost:5432/clientflow',
    APP_ORIGINS: 'https://crm.example.test',
    CSRF_SECRET: 'x'.repeat(40),
    FILE_ENCRYPTION_KEY: 'ab'.repeat(32),
  };

  it('resend needs a key and a sender', () => {
    expect(() => loadEnv({ ...base, MAIL_TRANSPORT: 'resend' })).toThrow(
      /RESEND_API_KEY and MAIL_FROM/,
    );
    expect(() =>
      loadEnv({
        ...base,
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 'not-a-key',
        MAIL_FROM: 'a@b.test',
      }),
    ).toThrow(/Resend API key/);
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      MAIL_TRANSPORT: 'resend',
      RESEND_API_KEY: 're_abcdefgh1234',
      MAIL_FROM: 'ClientFlow <noreply@crm.example.test>',
    });
    expect(createMailer(env, capture().logger).delivery).toBe('sent');
  });

  it('accepts a plain address or "Name <address>", nothing else', () => {
    const ok = (MAIL_FROM: string) =>
      loadEnv({ ...base, MAIL_TRANSPORT: 'resend', RESEND_API_KEY: 're_abcdefgh1234', MAIL_FROM });
    expect(ok('noreply@crm.example.test').MAIL_FROM).toBe('noreply@crm.example.test');
    expect(() => ok('not an address')).toThrow(/MAIL_FROM/);
    expect(() => ok('Name <broken>')).toThrow(/MAIL_FROM/);
  });

  it('a demo never sends through Resend', () => {
    expect(() =>
      loadEnv({
        ...base,
        DEMO_MODE: 'true',
        MAIL_TRANSPORT: 'resend',
        RESEND_API_KEY: 're_abcdefgh1234',
        MAIL_FROM: 'noreply@crm.example.test',
      }),
    ).toThrow(/DEMO_MODE/);
  });
});

describe('invitation when the email provider is down', () => {
  beforeEach(async () => {
    await resetDb();
  });

  it('still creates the invitation and says the email failed', async () => {
    const seeded = await seedAgency();
    const { app, mailer } = makeApp();
    mailer.failures.push({ afterSend: false });
    const owner = await login(app, seeded.users.owner!.email);
    const res = await owner.agent
      .post('/api/v1/invitations')
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', owner.csrf)
      .send({ email: 'new.person@agency.test', role: 'MEMBER' });
    expect(res.status).toBe(201);
    expect(res.body.data.emailDelivery).toBe('failed');
    expect(res.body.data.acceptUrl).toMatch(/#token=/);
  });
});
