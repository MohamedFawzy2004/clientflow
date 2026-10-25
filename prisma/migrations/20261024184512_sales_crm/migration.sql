-- CreateEnum
CREATE TYPE "DealStatus" AS ENUM ('OPEN', 'WON', 'LOST');

-- DropIndex
DROP INDEX "activities_agency_id_entity_type_entity_id_created_at_idx";

-- AlterTable
ALTER TABLE "activities" ADD COLUMN     "body" VARCHAR(5000),
ADD COLUMN     "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "converted_at" TIMESTAMPTZ(3);

-- CreateTable
CREATE TABLE "pipelines" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipelines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_stages" (
    "id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "position" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pipeline_stages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deals" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "contact_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "pipeline_id" UUID NOT NULL,
    "stage_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "amount_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "status" "DealStatus" NOT NULL DEFAULT 'OPEN',
    "expected_close_on" DATE,
    "next_step" VARCHAR(300),
    "next_step_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "closed_by_id" UUID,
    "lost_reason" VARCHAR(500),
    "won_override_reason" VARCHAR(500),
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_agency_id_id_key" ON "pipelines"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_position_key" ON "pipeline_stages"("pipeline_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "pipeline_stages_pipeline_id_id_key" ON "pipeline_stages"("pipeline_id", "id");

-- CreateIndex
CREATE INDEX "deals_agency_id_status_stage_id_idx" ON "deals"("agency_id", "status", "stage_id");

-- CreateIndex
CREATE INDEX "deals_agency_id_owner_id_status_idx" ON "deals"("agency_id", "owner_id", "status");

-- CreateIndex
CREATE INDEX "deals_agency_id_contact_id_idx" ON "deals"("agency_id", "contact_id");

-- CreateIndex
CREATE INDEX "deals_agency_id_next_step_at_idx" ON "deals"("agency_id", "next_step_at");

-- CreateIndex
CREATE INDEX "activities_agency_id_entity_type_entity_id_occurred_at_idx" ON "activities"("agency_id", "entity_type", "entity_id", "occurred_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_agency_id_next_action_at_idx" ON "contacts"("agency_id", "next_action_at");

-- CreateIndex
CREATE UNIQUE INDEX "contacts_agency_id_id_key" ON "contacts"("agency_id", "id");

-- AddForeignKey
ALTER TABLE "pipelines" ADD CONSTRAINT "pipelines_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_stages" ADD CONSTRAINT "pipeline_stages_pipeline_id_fkey" FOREIGN KEY ("pipeline_id") REFERENCES "pipelines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_agency_id_contact_id_fkey" FOREIGN KEY ("agency_id", "contact_id") REFERENCES "contacts"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_agency_id_owner_id_fkey" FOREIGN KEY ("agency_id", "owner_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_agency_id_pipeline_id_fkey" FOREIGN KEY ("agency_id", "pipeline_id") REFERENCES "pipelines"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_pipeline_id_stage_id_fkey" FOREIGN KEY ("pipeline_id", "stage_id") REFERENCES "pipeline_stages"("pipeline_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Hand-written rules and backfills (spec §8.2, §9).
-- ---------------------------------------------------------------------------

-- Existing timeline rows happened when they were created, not at migration time.
UPDATE "activities" SET "occurred_at" = "created_at";

ALTER TABLE "activities"
  ADD CONSTRAINT "activities_summary_not_blank" CHECK (length(btrim("summary")) > 0);

ALTER TABLE "pipelines"
  ADD CONSTRAINT "pipelines_name_not_blank" CHECK (length(btrim("name")) > 0);

-- Exactly one default pipeline per agency.
CREATE UNIQUE INDEX "pipelines_one_default_per_agency"
  ON "pipelines" ("agency_id") WHERE "is_default";

ALTER TABLE "pipeline_stages"
  ADD CONSTRAINT "pipeline_stages_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "pipeline_stages_position_non_negative" CHECK ("position" >= 0);

ALTER TABLE "deals"
  ADD CONSTRAINT "deals_title_not_blank" CHECK (length(btrim("title")) > 0),
  -- Integer minor units only; upper bound keeps values exact in JSON/JS (< 2^53).
  ADD CONSTRAINT "deals_amount_range" CHECK ("amount_minor" >= 0 AND "amount_minor" <= 900000000000000),
  ADD CONSTRAINT "deals_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED')),
  ADD CONSTRAINT "deals_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "deals_next_step_not_blank" CHECK ("next_step" IS NULL OR length(btrim("next_step")) > 0),
  -- Status is a state machine: OPEN has no close data, WON/LOST always do, LOST always has a reason.
  ADD CONSTRAINT "deals_status_consistent" CHECK (
    ("status" = 'OPEN' AND "closed_at" IS NULL AND "closed_by_id" IS NULL AND "lost_reason" IS NULL AND "won_override_reason" IS NULL)
    OR ("status" = 'WON' AND "closed_at" IS NOT NULL AND "closed_by_id" IS NOT NULL AND "lost_reason" IS NULL)
    OR ("status" = 'LOST' AND "closed_at" IS NOT NULL AND "closed_by_id" IS NOT NULL AND "won_override_reason" IS NULL
        AND "lost_reason" IS NOT NULL AND length(btrim("lost_reason")) > 0)
  ),
  ADD CONSTRAINT "deals_won_override_not_blank" CHECK ("won_override_reason" IS NULL OR length(btrim("won_override_reason")) > 0);

-- Whoever closed a deal belongs to the same agency.
ALTER TABLE "deals" ADD CONSTRAINT "deals_agency_id_closed_by_id_fkey"
  FOREIGN KEY ("agency_id", "closed_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Every existing agency gets the default sales pipeline (new agencies get it at bootstrap).
INSERT INTO "pipelines" ("id", "agency_id", "name", "is_default")
SELECT gen_random_uuid(), a."id", 'Sales pipeline', true
FROM "agencies" a
WHERE NOT EXISTS (SELECT 1 FROM "pipelines" p WHERE p."agency_id" = a."id");

INSERT INTO "pipeline_stages" ("id", "pipeline_id", "name", "position")
SELECT gen_random_uuid(), p."id", s."name", s."position"
FROM "pipelines" p
CROSS JOIN (VALUES ('New', 0), ('Qualified', 1), ('Discovery call', 2), ('Proposal', 3), ('Negotiation', 4)) AS s("name", "position")
WHERE NOT EXISTS (SELECT 1 FROM "pipeline_stages" ps WHERE ps."pipeline_id" = p."id");
