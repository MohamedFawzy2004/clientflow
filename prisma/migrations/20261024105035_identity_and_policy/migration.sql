-- AlterTable
ALTER TABLE "users" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "invitations" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "email_norm" VARCHAR(254) NOT NULL,
    "role" "Role" NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "accepted_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "invited_by_id" UUID NOT NULL,
    "accepted_user_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invitations_token_hash_key" ON "invitations"("token_hash");

-- CreateIndex
CREATE INDEX "invitations_agency_id_created_at_idx" ON "invitations"("agency_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "password_reset_tokens_user_id_idx" ON "password_reset_tokens"("user_id");

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_agency_id_invited_by_id_fkey" FOREIGN KEY ("agency_id", "invited_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_accepted_user_id_fkey" FOREIGN KEY ("accepted_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules (spec §8.2, §9 Invitation state machine).
-- ---------------------------------------------------------------------------

ALTER TABLE "users"
  ADD CONSTRAINT "users_version_positive" CHECK ("version" > 0);

ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_email_normalized" CHECK ("email_norm" = lower(btrim("email_norm")) AND position('@' in "email_norm") > 1),
  ADD CONSTRAINT "invitations_token_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "invitations_expiry_after_creation" CHECK ("expires_at" > "created_at"),
  -- Client portal users are a separate boundary (M7): never invited as staff.
  ADD CONSTRAINT "invitations_staff_roles_only" CHECK ("role" <> 'CLIENT'),
  -- Terminal states are exclusive, and an accepted invite always names the user it created.
  ADD CONSTRAINT "invitations_single_terminal_state" CHECK (NOT ("accepted_at" IS NOT NULL AND "revoked_at" IS NOT NULL)),
  ADD CONSTRAINT "invitations_accepted_has_user" CHECK (("accepted_at" IS NULL) = ("accepted_user_id" IS NULL));

-- At most one open invitation per email per agency. Replacing an invite revokes the old one first.
CREATE UNIQUE INDEX "invitations_one_open_per_email"
  ON "invitations" ("agency_id", "email_norm")
  WHERE "accepted_at" IS NULL AND "revoked_at" IS NULL;

-- An invitation can be accepted by exactly one user.
CREATE UNIQUE INDEX "invitations_accepted_user_unique"
  ON "invitations" ("accepted_user_id")
  WHERE "accepted_user_id" IS NOT NULL;

ALTER TABLE "password_reset_tokens"
  ADD CONSTRAINT "password_reset_tokens_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "password_reset_tokens_expiry_after_creation" CHECK ("expires_at" > "created_at");
