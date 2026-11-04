-- Per-account limit on two-step codes and step-up passwords (security audit F1–F3). The
-- per-challenge limit alone let a password holder open new challenges without end.
ALTER TABLE "users" ADD COLUMN "mfa_failed_attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "mfa_failure_window_at" TIMESTAMPTZ(3),
ADD COLUMN "mfa_locked_until" TIMESTAMPTZ(3);

ALTER TABLE "users" ADD CONSTRAINT "users_mfa_failed_attempts_range"
  CHECK ("mfa_failed_attempts" >= 0);
