-- CreateEnum
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'SALES_MANAGER', 'SALES', 'PM', 'MEMBER', 'FINANCE', 'CLIENT');

-- CreateEnum
CREATE TYPE "ContactLifecycle" AS ENUM ('LEAD', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "ContactSource" AS ENUM ('REFERRAL', 'WEBSITE', 'SOCIAL', 'EVENT', 'OUTBOUND', 'PARTNER', 'OTHER');

-- CreateEnum
CREATE TYPE "AuditOutcome" AS ENUM ('SUCCESS', 'FAILURE', 'DENIED');

-- CreateTable
CREATE TABLE "agencies" (
    "id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "slug" VARCHAR(80) NOT NULL,
    "default_currency" CHAR(3) NOT NULL DEFAULT 'EGP',
    "timezone" VARCHAR(64) NOT NULL DEFAULT 'Africa/Cairo',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "agencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "email_norm" VARCHAR(254) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "role" "Role" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "last_login_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" CHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "last_seen_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contacts" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "full_name" VARCHAR(200) NOT NULL,
    "email_norm" VARCHAR(254),
    "phone" VARCHAR(40),
    "phone_norm" VARCHAR(20),
    "company_name" VARCHAR(200),
    "lifecycle" "ContactLifecycle" NOT NULL DEFAULT 'LEAD',
    "source" "ContactSource",
    "next_action_at" TIMESTAMPTZ(3),
    "notes" VARCHAR(5000),
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activities" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "actor_id" UUID,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "event_type" VARCHAR(60) NOT NULL,
    "summary" VARCHAR(500) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_events" (
    "id" UUID NOT NULL,
    "agency_id" UUID,
    "actor_id" UUID,
    "action" VARCHAR(80) NOT NULL,
    "target_type" VARCHAR(40),
    "target_id" UUID,
    "outcome" "AuditOutcome" NOT NULL,
    "request_id" VARCHAR(64),
    "metadata_redacted" JSONB,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agencies_slug_key" ON "agencies"("slug");

-- CreateIndex
CREATE INDEX "users_email_norm_idx" ON "users"("email_norm");

-- CreateIndex
CREATE UNIQUE INDEX "users_agency_id_email_norm_key" ON "users"("agency_id", "email_norm");

-- CreateIndex
CREATE UNIQUE INDEX "users_agency_id_id_key" ON "users"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "contacts_agency_id_owner_id_created_at_idx" ON "contacts"("agency_id", "owner_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_agency_id_created_at_idx" ON "contacts"("agency_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_agency_id_email_norm_idx" ON "contacts"("agency_id", "email_norm");

-- CreateIndex
CREATE INDEX "contacts_agency_id_phone_norm_idx" ON "contacts"("agency_id", "phone_norm");

-- CreateIndex
CREATE INDEX "activities_agency_id_entity_type_entity_id_created_at_idx" ON "activities"("agency_id", "entity_type", "entity_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_agency_id_created_at_idx" ON "audit_events"("agency_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "audit_events_action_created_at_idx" ON "audit_events"("action", "created_at" DESC);

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_agency_id_owner_id_fkey" FOREIGN KEY ("agency_id", "owner_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activities" ADD CONSTRAINT "activities_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------
-- Hand-written rules Prisma cannot express (spec §8.1, §8.2).
-- ---------------------------------------------------------------------------

-- Agencies
ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "agencies_slug_format" CHECK ("slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  ADD CONSTRAINT "agencies_currency_format" CHECK ("default_currency" ~ '^[A-Z]{3}$');

-- Users: normalized email (lowercase, trimmed) and non-empty name.
ALTER TABLE "users"
  ADD CONSTRAINT "users_email_normalized" CHECK ("email_norm" = lower(btrim("email_norm")) AND position('@' in "email_norm") > 1),
  ADD CONSTRAINT "users_name_not_blank" CHECK (length(btrim("name")) > 0);

-- Sessions: SHA-256 hex digest only, expiry after creation.
ALTER TABLE "sessions"
  ADD CONSTRAINT "sessions_token_hash_hex" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "sessions_expiry_after_creation" CHECK ("expires_at" > "created_at");

-- Contacts
ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_full_name_not_blank" CHECK (length(btrim("full_name")) > 0),
  ADD CONSTRAINT "contacts_email_normalized" CHECK ("email_norm" IS NULL OR ("email_norm" = lower(btrim("email_norm")) AND position('@' in "email_norm") > 1)),
  ADD CONSTRAINT "contacts_phone_norm_format" CHECK ("phone_norm" IS NULL OR "phone_norm" ~ '^\+?[0-9]{6,15}$'),
  ADD CONSTRAINT "contacts_version_positive" CHECK ("version" > 0);

-- Audit events are append-only for the application role (SEC-17).
CREATE OR REPLACE FUNCTION "audit_events_block_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_events is append-only' USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_events_no_update_delete"
  BEFORE UPDATE OR DELETE ON "audit_events"
  FOR EACH ROW EXECUTE FUNCTION "audit_events_block_mutation"();
