import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { Logger } from 'pino';
import { generateToken } from './tokens.js';

export interface MailMessage {
  to: string;
  subject: string;
  /** Plain text only. Links point to the app; no confidential record data (SEC-24). */
  text: string;
  /** Category for logs and tests, e.g. "invitation", "password_reset". */
  kind: string;
  /**
   * Same key = same email. Background jobs pass one so a retry after a crash does not send twice:
   * the dev sink and the test mailer drop repeats, and a real provider gets it as its idempotency key.
   */
  idempotencyKey?: string;
}

export interface Mailer {
  readonly delivery: 'sent' | 'sent_to_dev_sink' | 'disabled';
  send(message: MailMessage): Promise<void>;
}

/**
 * Development sink: writes each email as a JSON file (gitignored folder) and never sends it.
 * The log line names the file and kind only, never the recipient or the link (FR-A03).
 */
export class DevSinkMailer implements Mailer {
  readonly delivery = 'sent_to_dev_sink' as const;
  private readonly dir: string;

  constructor(
    dir: string,
    private readonly logger: Logger,
  ) {
    this.dir = resolve(dir);
  }

  async send(message: MailMessage) {
    mkdirSync(this.dir, { recursive: true });
    const key = message.idempotencyKey?.replace(/[^A-Za-z0-9_.-]/g, '_');
    if (key && readdirSync(this.dir).some((name) => name.endsWith(`-${key}.json`))) {
      this.logger.info({ kind: message.kind }, 'Email already in dev sink (repeat dropped)');
      return;
    }
    const file = join(this.dir, `${Date.now()}-${message.kind}-${key ?? generateToken(4)}.json`);
    writeFileSync(
      file,
      JSON.stringify({ ...message, createdAt: new Date().toISOString() }, null, 2),
      {
        mode: 0o600,
      },
    );
    this.logger.info({ kind: message.kind, file }, 'Email written to dev sink (not sent)');
  }
}

export class DisabledMailer implements Mailer {
  readonly delivery = 'disabled' as const;

  constructor(private readonly logger: Logger) {}

  async send(message: MailMessage) {
    this.logger.warn({ kind: message.kind }, 'Email delivery is disabled; message dropped');
  }
}

/** Test double: keeps messages in memory so tests can read links. */
export class MemoryMailer implements Mailer {
  readonly delivery = 'sent_to_dev_sink' as const;
  readonly messages: MailMessage[] = [];

  /** Test hook: throw on the next sends (after accepting the message when `afterSend`). */
  failures: Array<{ afterSend: boolean }> = [];

  async send(message: MailMessage) {
    const failure = this.failures.shift();
    if (failure && !failure.afterSend) throw new Error('Mail provider unavailable');
    const repeat =
      message.idempotencyKey !== undefined &&
      this.messages.some((m) => m.idempotencyKey === message.idempotencyKey);
    if (!repeat) this.messages.push(message);
    if (failure?.afterSend) throw new Error('Connection reset after the message was accepted');
  }

  /** Extracts the token from the last link of the given kind. */
  lastToken(kind: string): string | undefined {
    const msg = [...this.messages].reverse().find((m) => m.kind === kind);
    return msg?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  }
}

/**
 * Resend (ADR-068): one HTTPS call per email, plain text only. The outbox's idempotency key goes
 * to Resend as `Idempotency-Key`, so a retried job never sends twice within Resend's 24 hours.
 * Logs carry the kind and Resend's message id, never the recipient or the body.
 */
export class ResendMailer implements Mailer {
  readonly delivery = 'sent' as const;

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly endpoint = 'https://api.resend.com/emails',
  ) {}

  async send(message: MailMessage) {
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...(message.idempotencyKey
          ? { 'Idempotency-Key': message.idempotencyKey.slice(0, 256) }
          : {}),
      },
      body: JSON.stringify({
        from: this.from,
        to: [message.to],
        subject: message.subject,
        text: message.text,
        tags: [{ name: 'kind', value: message.kind.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256) }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) {
      // Resend's error message can quote the address, so only its error name is logged.
      const name = await res
        .json()
        .then((b: unknown) => {
          const name = (b as { name?: unknown } | null)?.name;
          return typeof name === 'string' ? name : undefined;
        })
        .catch(() => undefined);
      this.logger.warn(
        { kind: message.kind, status: res.status, error: name },
        'Resend refused an email',
      );
      throw new Error(`The email provider refused the message (HTTP ${res.status}).`);
    }
    const { id } = (await res.json().catch(() => ({}))) as { id?: string };
    this.logger.info({ kind: message.kind, providerId: id }, 'Email sent');
  }
}

/** The mailer the configuration asks for (server and background worker). */
export function createMailer(
  env: {
    MAIL_TRANSPORT: 'dev-sink' | 'disabled' | 'resend';
    MAIL_SINK_DIR: string;
    RESEND_API_KEY?: string | undefined;
    MAIL_FROM?: string | undefined;
  },
  logger: Logger,
): Mailer {
  if (env.MAIL_TRANSPORT === 'resend') {
    return new ResendMailer(env.RESEND_API_KEY!, env.MAIL_FROM!, logger);
  }
  return env.MAIL_TRANSPORT === 'dev-sink'
    ? new DevSinkMailer(env.MAIL_SINK_DIR, logger)
    : new DisabledMailer(logger);
}

export type EmailDelivery = Mailer['delivery'] | 'failed';

/**
 * For emails sent during a request whose link may be shown on screen (invitations): a provider
 * outage must not fail the request, so the person sharing the link is told to send it themselves.
 * The link is shown only when the result is not 'sent' (see linkForInviter, security audit F4).
 */
export async function sendOrReport(
  mailer: Mailer,
  logger: Logger,
  message: MailMessage,
): Promise<EmailDelivery> {
  try {
    await mailer.send(message);
    return mailer.delivery;
  } catch (err) {
    logger.error(
      { kind: message.kind, err: err instanceof Error ? err.message : String(err) },
      'Email could not be sent; the link is shown on screen instead',
    );
    return 'failed';
  }
}
