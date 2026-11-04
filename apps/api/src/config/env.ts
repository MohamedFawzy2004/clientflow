import { ROLES, type Role } from '@clientflow/contracts';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  /** Interface to listen on. Containers need 0.0.0.0; local development keeps 127.0.0.1. */
  HOST: z.string().min(1).default('127.0.0.1'),
  /** Built web app to serve on the same origin (production). Unset in development (Vite serves it). */
  WEB_DIST_DIR: z.string().min(1).optional(),
  APP_ORIGINS: z
    .string()
    .min(1)
    .transform((v) =>
      v
        .split(',')
        .map((o) => o.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.string().url()).min(1)),
  CSRF_SECRET: z.string().min(32, 'CSRF_SECRET must be at least 32 characters'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  /** Public base URL used in emailed links. Defaults to the first APP_ORIGINS entry. */
  APP_PUBLIC_URL: z.string().url().optional(),
  /**
   * `dev-sink` writes emails to local files (never sent). `disabled` sends nothing. `resend`
   * sends through Resend (ADR-068) and needs RESEND_API_KEY and MAIL_FROM.
   */
  MAIL_TRANSPORT: z.enum(['dev-sink', 'disabled', 'resend']).default('dev-sink'),
  RESEND_API_KEY: z
    .string()
    .regex(/^re_[A-Za-z0-9_]{8,}$/, 'RESEND_API_KEY must be a Resend API key (re_…)')
    .optional(),
  /** Sender, e.g. `ClientFlow <noreply@crm.youragency.com>`, on a domain verified in Resend. */
  MAIL_FROM: z
    .string()
    .trim()
    .regex(
      /^(?:[^<>@]{1,100} <[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/,
      'MAIL_FROM must be an address or "Name <address>"',
    )
    .optional(),
  MAIL_SINK_DIR: z.string().min(1).default('.mail-sink'),
  /** Private upload storage (encrypted files). Never inside the web root; a volume in containers. */
  FILE_STORAGE_DIR: z.string().min(1).default('.storage'),
  /** 32 random bytes as 64 hex characters: the AES-256-GCM key for stored files (SEC-12). */
  FILE_ENCRYPTION_KEY: z
    .string()
    .regex(/^[0-9a-f]{64}$/i, 'FILE_ENCRYPTION_KEY must be 64 hex characters (32 bytes)'),
  /** Largest accepted upload. Default 25 MB, at most 100 MB (the database ceiling). */
  FILE_MAX_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(100 * 1024 * 1024)
    .default(25 * 1024 * 1024),
  /** Total stored per project. Default 2 GB. */
  FILE_PROJECT_QUOTA_BYTES: z.coerce
    .number()
    .int()
    .min(1024 * 1024)
    .default(2 * 1024 * 1024 * 1024),
  /**
   * Test/development only: raise the per-IP limits for sign-in and one-time-token endpoints
   * (the E2E suite signs in many times from one address). Refused in production.
   */
  LOGIN_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).max(10_000).optional(),
  TOKEN_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).max(10_000).optional(),
  API_RATE_LIMIT_PER_IP: z.coerce.number().int().min(1).max(100_000).optional(),
  /**
   * Run the background worker (emails, reminders) inside this process. Turn it off only when a
   * separate `npm run jobs:worker` process runs it instead (ADR-058).
   */
  JOBS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((v) => v === 'true'),
  /** How often the worker looks for due jobs. */
  JOBS_POLL_SECONDS: z.coerce.number().int().min(1).max(300).default(10),
  /** How often reminders are scanned (FR-A01). */
  REMINDER_SCAN_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  /**
   * Roles that must use two-step sign-in (ADR-069), comma-separated, or `none`. Default: OWNER
   * and ADMIN in production (not in a demo), none elsewhere.
   */
  MFA_REQUIRED_ROLES: z.string().trim().optional(),
  /** ClamAV (clamd) for uploads (ADR-070). Unset: built-in checks only. */
  CLAMAV_HOST: z.string().trim().min(1).optional(),
  CLAMAV_PORT: z.coerce.number().int().min(1).max(65535).default(3310),
  /**
   * `builtin-only` states that uploads run without an antivirus engine. Production refuses to
   * start with neither CLAMAV_HOST nor this, so a lost variable cannot turn scanning off quietly.
   */
  UPLOAD_SCAN: z.enum(['clamav', 'builtin-only']).optional(),
  /**
   * A demo deployment (ADR-066): allows `npm run demo:reset` and never sends real email. A reset
   * still refuses any database whose agency is not marked as a demo.
   */
  DEMO_MODE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
  /**
   * Public demo hosting (ADR-071): rebuild the demo each time the process starts, before it
   * listens. The value is the database name, typed back as with `demo:reset --confirm`, and every
   * demo-reset safety check still applies. Needs DEMO_MODE=true.
   */
  DEMO_RESET_ON_BOOT: z.string().trim().min(1).optional(),
  /** Demo only: changes allowed per address in 15 minutes (ADR-071). */
  DEMO_WRITE_LIMIT_PER_IP: z.coerce.number().int().min(10).max(100_000).default(120),
});

/** Transports that never deliver mail to a real inbox. */
const NON_SENDING_TRANSPORTS: readonly string[] = ['dev-sink', 'disabled'];

export type Env = z.infer<typeof envSchema>;

const PLACEHOLDER_MARKERS = ['change-me', 'replace-with'];

/** Validates process.env once. Fails closed on missing or placeholder secrets (SEC-16). */
export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  const env = parsed.data;
  const secrets = [
    env.CSRF_SECRET,
    env.DATABASE_URL,
    env.FILE_ENCRYPTION_KEY,
    env.RESEND_API_KEY ?? '',
  ];
  if (secrets.some((s) => PLACEHOLDER_MARKERS.some((m) => s.includes(m)))) {
    throw new Error('Environment still contains placeholder secrets from .env.example.');
  }
  if (env.NODE_ENV === 'production' && env.APP_ORIGINS.some((o) => !o.startsWith('https://'))) {
    throw new Error('APP_ORIGINS must use https:// in production.');
  }
  if (
    env.NODE_ENV === 'production' &&
    (env.LOGIN_RATE_LIMIT_PER_IP !== undefined ||
      env.TOKEN_RATE_LIMIT_PER_IP !== undefined ||
      env.API_RATE_LIMIT_PER_IP !== undefined)
  ) {
    throw new Error('Rate-limit overrides are for tests only and are not allowed in production.');
  }
  // The dev sink writes tokens to disk in plain text: never acceptable in production.
  if (env.NODE_ENV === 'production' && env.MAIL_TRANSPORT === 'dev-sink') {
    throw new Error('MAIL_TRANSPORT=dev-sink is not allowed in production.');
  }
  if (env.MAIL_TRANSPORT === 'resend' && (!env.RESEND_API_KEY || !env.MAIL_FROM)) {
    throw new Error('MAIL_TRANSPORT=resend needs RESEND_API_KEY and MAIL_FROM.');
  }
  // Demo visitors can type any address into an invitation: a demo must never deliver email.
  if (env.DEMO_MODE && !NON_SENDING_TRANSPORTS.includes(env.MAIL_TRANSPORT)) {
    throw new Error('DEMO_MODE needs a transport that sends nothing (dev-sink or disabled).');
  }
  if (env.DEMO_RESET_ON_BOOT && !env.DEMO_MODE) {
    throw new Error('DEMO_RESET_ON_BOOT needs DEMO_MODE=true.');
  }
  const roles = mfaRequiredRoles(env); // fails here on an unknown role name
  // Security audit F6: in a real deployment these two must not be lost by a typo or a missing
  // variable. A demo holds no client data and keeps its own defaults.
  const realDeployment = env.NODE_ENV === 'production' && !env.DEMO_MODE;
  if (realDeployment && !(['OWNER', 'ADMIN'] as const).every((r) => roles.includes(r))) {
    throw new Error('MFA_REQUIRED_ROLES must include OWNER and ADMIN in production.');
  }
  if (env.UPLOAD_SCAN === 'clamav' && !env.CLAMAV_HOST) {
    throw new Error('UPLOAD_SCAN=clamav needs CLAMAV_HOST.');
  }
  if (env.UPLOAD_SCAN === 'builtin-only' && env.CLAMAV_HOST) {
    throw new Error('UPLOAD_SCAN=builtin-only conflicts with CLAMAV_HOST: remove one of them.');
  }
  if (realDeployment && !env.CLAMAV_HOST && env.UPLOAD_SCAN !== 'builtin-only') {
    throw new Error(
      'Set CLAMAV_HOST for antivirus scanning, or UPLOAD_SCAN=builtin-only to run without it.',
    );
  }
  return env;
}

/** The roles that must use two-step sign-in (ADR-069). */
export function mfaRequiredRoles(env: Env): Role[] {
  const raw = env.MFA_REQUIRED_ROLES;
  if (raw === undefined) {
    return env.NODE_ENV === 'production' && !env.DEMO_MODE ? ['OWNER', 'ADMIN'] : [];
  }
  if (raw === '' || raw.toLowerCase() === 'none') return [];
  const roles = raw.split(',').map((r) => r.trim().toUpperCase());
  const unknown = roles.filter((r) => !(ROLES as readonly string[]).includes(r));
  if (unknown.length > 0) {
    throw new Error(`MFA_REQUIRED_ROLES has unknown roles: ${unknown.join(', ')}`);
  }
  return roles as Role[];
}
