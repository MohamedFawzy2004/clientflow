-- Two-step sign-in (ADR-069): encrypted TOTP secrets, hashed recovery codes, sign-in challenges.
ALTER TABLE "users" ADD COLUMN "mfa_secret_enc" BYTEA,
ADD COLUMN "mfa_pending_secret_enc" BYTEA,
ADD COLUMN "mfa_enabled_at" TIMESTAMPTZ(3),
ADD COLUMN "mfa_last_step" BIGINT;

-- Enabled exactly when a confirmed secret exists.
ALTER TABLE "users" ADD CONSTRAINT "users_mfa_enabled_has_secret"
  CHECK (("mfa_enabled_at" IS NULL) = ("mfa_secret_enc" IS NULL));

CREATE TABLE "mfa_recovery_codes" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" CHAR(64) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mfa_challenges" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mfa_challenges_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "mfa_challenges_attempts_range" CHECK ("attempts" BETWEEN 0 AND 5),
    CONSTRAINT "mfa_challenges_expiry_after_creation" CHECK ("expires_at" > "created_at")
);

CREATE UNIQUE INDEX "mfa_recovery_codes_code_hash_key" ON "mfa_recovery_codes"("code_hash");
CREATE INDEX "mfa_recovery_codes_user_id_idx" ON "mfa_recovery_codes"("user_id");
CREATE UNIQUE INDEX "mfa_challenges_token_hash_key" ON "mfa_challenges"("token_hash");
CREATE INDEX "mfa_challenges_user_id_idx" ON "mfa_challenges"("user_id");

ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "mfa_challenges" ADD CONSTRAINT "mfa_challenges_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
