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
   * `dev-sink` writes emails to local files (never sent). `disabled` sends nothing.
   * A real provider adapter arrives with the owner's choice of provider (ADR-016).
   */
  MAIL_TRANSPORT: z.enum(['dev-sink', 'disabled']).default('dev-sink'),
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
});

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
  const secrets = [env.CSRF_SECRET, env.DATABASE_URL, env.FILE_ENCRYPTION_KEY];
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
  return env;
}
