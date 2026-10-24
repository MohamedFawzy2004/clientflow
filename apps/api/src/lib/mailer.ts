import { mkdirSync, writeFileSync } from 'node:fs';
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
}

export interface Mailer {
  readonly delivery: 'sent_to_dev_sink' | 'disabled';
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
    const file = join(this.dir, `${Date.now()}-${message.kind}-${generateToken(4)}.json`);
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

  async send(message: MailMessage) {
    this.messages.push(message);
  }

  /** Extracts the token from the last link of the given kind. */
  lastToken(kind: string): string | undefined {
    const msg = [...this.messages].reverse().find((m) => m.kind === kind);
    return msg?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
  }
}
