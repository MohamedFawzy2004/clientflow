-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL', 'SENT', 'ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "ReviewKind" AS ENUM ('INTERNAL', 'CLIENT');

-- CreateEnum
CREATE TYPE "ReviewDecision" AS ENUM ('SUBMITTED', 'APPROVED', 'CHANGES_REQUESTED', 'SENT', 'ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "proposal_seq" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "client_org_id" UUID;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "accepted_proposal_version_id" UUID;

-- AlterTable
ALTER TABLE "invitations" ADD COLUMN     "client_org_id" UUID;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "client_org_id" UUID;

-- CreateTable
CREATE TABLE "client_organizations" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "name" VARCHAR(200) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "client_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "service_catalog" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "description" VARCHAR(2000),
    "unit" VARCHAR(40) NOT NULL,
    "rate_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "archived_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "service_catalog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposals" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "deal_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "current_version_no" INTEGER NOT NULL DEFAULT 1,
    "client_org_id" UUID,
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_versions" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "title" VARCHAR(200) NOT NULL,
    "summary" VARCHAR(5000),
    "inclusions" VARCHAR(5000),
    "exclusions" VARCHAR(5000),
    "assumptions" VARCHAR(5000),
    "milestones" VARCHAR(5000),
    "payment_terms" VARCHAR(2000),
    "terms" VARCHAR(10000),
    "internal_notes" VARCHAR(5000),
    "currency" CHAR(3) NOT NULL,
    "expires_on" DATE NOT NULL,
    "discount_bp" INTEGER NOT NULL DEFAULT 0,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 1400,
    "tax_label" VARCHAR(40) NOT NULL DEFAULT 'VAT',
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "discount_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "content_hash" CHAR(64),
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "sent_at" TIMESTAMPTZ(3),
    "decided_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "proposal_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_items" (
    "id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "service_id" UUID,
    "name" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "unit" VARCHAR(40) NOT NULL,
    "quantity_centi" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,

    CONSTRAINT "proposal_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_reviews" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" "ReviewKind" NOT NULL,
    "decision" "ReviewDecision" NOT NULL,
    "comment" VARCHAR(2000),
    "content_hash" CHAR(64),
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "client_organizations_agency_id_name_idx" ON "client_organizations"("agency_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "client_organizations_agency_id_id_key" ON "client_organizations"("agency_id", "id");

-- CreateIndex
CREATE INDEX "service_catalog_agency_id_archived_at_name_idx" ON "service_catalog"("agency_id", "archived_at", "name");

-- CreateIndex
CREATE INDEX "proposals_agency_id_status_updated_at_idx" ON "proposals"("agency_id", "status", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "proposals_agency_id_deal_id_idx" ON "proposals"("agency_id", "deal_id");

-- CreateIndex
CREATE INDEX "proposals_client_org_id_status_idx" ON "proposals"("client_org_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_agency_id_number_key" ON "proposals"("agency_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "proposals_agency_id_id_key" ON "proposals"("agency_id", "id");

-- CreateIndex
CREATE INDEX "proposal_versions_agency_id_status_idx" ON "proposal_versions"("agency_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_proposal_id_version_no_key" ON "proposal_versions"("proposal_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_versions_agency_id_id_key" ON "proposal_versions"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_items_version_id_position_key" ON "proposal_items"("version_id", "position");

-- CreateIndex
CREATE INDEX "proposal_reviews_version_id_occurred_at_idx" ON "proposal_reviews"("version_id", "occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "deals_accepted_proposal_version_id_key" ON "deals"("accepted_proposal_version_id");

-- CreateIndex
CREATE UNIQUE INDEX "deals_agency_id_id_key" ON "deals"("agency_id", "id");

-- CreateIndex
CREATE INDEX "users_client_org_id_idx" ON "users"("client_org_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invitations" ADD CONSTRAINT "invitations_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_accepted_proposal_version_id_fkey" FOREIGN KEY ("accepted_proposal_version_id") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client_organizations" ADD CONSTRAINT "client_organizations_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_catalog" ADD CONSTRAINT "service_catalog_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_agency_id_deal_id_fkey" FOREIGN KEY ("agency_id", "deal_id") REFERENCES "deals"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposals" ADD CONSTRAINT "proposals_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_agency_id_proposal_id_fkey" FOREIGN KEY ("agency_id", "proposal_id") REFERENCES "proposals"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_versions" ADD CONSTRAINT "proposal_versions_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_items" ADD CONSTRAINT "proposal_items_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "service_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_reviews" ADD CONSTRAINT "proposal_reviews_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_reviews" ADD CONSTRAINT "proposal_reviews_agency_id_version_id_fkey" FOREIGN KEY ("agency_id", "version_id") REFERENCES "proposal_versions"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_reviews" ADD CONSTRAINT "proposal_reviews_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written rules Prisma cannot express (M4).

-- CLIENT users and CLIENT invitations belong to exactly one client organization; staff never do.
ALTER TABLE "invitations" DROP CONSTRAINT "invitations_staff_roles_only";
ALTER TABLE "invitations"
  ADD CONSTRAINT "invitations_client_org_matches_role" CHECK (("role" = 'CLIENT') = ("client_org_id" IS NOT NULL));
ALTER TABLE "users"
  ADD CONSTRAINT "users_client_org_matches_role" CHECK (("role" = 'CLIENT') = ("client_org_id" IS NOT NULL));

ALTER TABLE "client_organizations"
  ADD CONSTRAINT "client_organizations_name_not_blank" CHECK (length(btrim("name")) > 0);

ALTER TABLE "service_catalog"
  ADD CONSTRAINT "service_catalog_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "service_catalog_unit_not_blank" CHECK (length(btrim("unit")) > 0),
  ADD CONSTRAINT "service_catalog_rate_range" CHECK ("rate_minor" >= 0 AND "rate_minor" <= 900000000000000),
  ADD CONSTRAINT "service_catalog_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED')),
  ADD CONSTRAINT "service_catalog_version_positive" CHECK ("version" > 0);

ALTER TABLE "proposals"
  ADD CONSTRAINT "proposals_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "proposals_current_version_positive" CHECK ("current_version_no" > 0),
  ADD CONSTRAINT "proposals_version_positive" CHECK ("version" > 0);

ALTER TABLE "proposal_versions"
  ADD CONSTRAINT "proposal_versions_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "proposal_versions_number_positive" CHECK ("version_no" > 0),
  ADD CONSTRAINT "proposal_versions_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED')),
  ADD CONSTRAINT "proposal_versions_rates_range" CHECK ("discount_bp" BETWEEN 0 AND 10000 AND "tax_rate_bp" BETWEEN 0 AND 10000),
  ADD CONSTRAINT "proposal_versions_amounts_non_negative" CHECK ("subtotal_minor" >= 0 AND "discount_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" >= 0),
  ADD CONSTRAINT "proposal_versions_discount_within_subtotal" CHECK ("discount_minor" <= "subtotal_minor"),
  -- The stored total is always the sum of its explained parts (FR-Q03).
  ADD CONSTRAINT "proposal_versions_total_consistent" CHECK ("total_minor" = "subtotal_minor" - "discount_minor" + "tax_minor"),
  ADD CONSTRAINT "proposal_versions_hash_format" CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "proposal_versions_hash_when_frozen" CHECK ("status" IN ('DRAFT', 'SUPERSEDED') OR "content_hash" IS NOT NULL),
  -- Nothing reaches a client without internal approval (FR-Q05, US-08), even by a direct DB write.
  ADD CONSTRAINT "proposal_versions_approved_before_sent" CHECK (
    "status" NOT IN ('APPROVED_INTERNAL', 'SENT', 'ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED') OR "approved_at" IS NOT NULL),
  ADD CONSTRAINT "proposal_versions_sent_before_decided" CHECK (
    "status" NOT IN ('SENT', 'ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED') OR "sent_at" IS NOT NULL),
  ADD CONSTRAINT "proposal_versions_decided_has_time" CHECK (
    "status" NOT IN ('ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED') OR "decided_at" IS NOT NULL),
  ADD CONSTRAINT "proposal_versions_version_positive" CHECK ("version" > 0);

ALTER TABLE "proposal_items"
  ADD CONSTRAINT "proposal_items_name_not_blank" CHECK (length(btrim("name")) > 0),
  ADD CONSTRAINT "proposal_items_unit_not_blank" CHECK (length(btrim("unit")) > 0),
  ADD CONSTRAINT "proposal_items_position_non_negative" CHECK ("position" >= 0),
  ADD CONSTRAINT "proposal_items_quantity_range" CHECK ("quantity_centi" BETWEEN 1 AND 10000000),
  ADD CONSTRAINT "proposal_items_price_range" CHECK ("unit_price_minor" >= 0 AND "unit_price_minor" <= 900000000000000),
  ADD CONSTRAINT "proposal_items_line_total_non_negative" CHECK ("line_total_minor" >= 0);

ALTER TABLE "proposal_reviews"
  ADD CONSTRAINT "proposal_reviews_hash_format" CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "proposal_reviews_client_decisions" CHECK (
    "kind" = 'INTERNAL' OR ("decision" IN ('ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED') AND "content_hash" IS NOT NULL));

-- At most one version being worked on, one live sent version and one accepted version per proposal.
CREATE UNIQUE INDEX "proposal_versions_one_open" ON "proposal_versions" ("proposal_id")
  WHERE "status" IN ('DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL');
CREATE UNIQUE INDEX "proposal_versions_one_sent" ON "proposal_versions" ("proposal_id") WHERE "status" = 'SENT';
CREATE UNIQUE INDEX "proposal_versions_one_accepted" ON "proposal_versions" ("proposal_id") WHERE "status" = 'ACCEPTED';
-- One logical client decision per version (T-PROP-03).
CREATE UNIQUE INDEX "proposal_reviews_one_client_decision" ON "proposal_reviews" ("version_id") WHERE "kind" = 'CLIENT';

-- Immutable versions (FR-Q04, T-PROP-01): once a version leaves DRAFT its content cannot change.
-- Status and workflow timestamps may still move forward; client decisions are final.
CREATE OR REPLACE FUNCTION "proposal_versions_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'proposal version % is immutable', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
    NEW."proposal_id", NEW."version_no", NEW."title", NEW."summary", NEW."inclusions", NEW."exclusions",
    NEW."assumptions", NEW."milestones", NEW."payment_terms", NEW."terms", NEW."internal_notes",
    NEW."currency", NEW."expires_on", NEW."discount_bp", NEW."tax_rate_bp", NEW."tax_label",
    NEW."subtotal_minor", NEW."discount_minor", NEW."tax_minor", NEW."total_minor", NEW."content_hash"
  ) IS DISTINCT FROM (
    OLD."proposal_id", OLD."version_no", OLD."title", OLD."summary", OLD."inclusions", OLD."exclusions",
    OLD."assumptions", OLD."milestones", OLD."payment_terms", OLD."terms", OLD."internal_notes",
    OLD."currency", OLD."expires_on", OLD."discount_bp", OLD."tax_rate_bp", OLD."tax_label",
    OLD."subtotal_minor", OLD."discount_minor", OLD."tax_minor", OLD."total_minor", OLD."content_hash"
  ) THEN
    RAISE EXCEPTION 'proposal version % is immutable', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" IN ('ACCEPTED', 'REJECTED', 'CHANGES_REQUESTED') AND NEW."status" <> OLD."status" THEN
    RAISE EXCEPTION 'proposal version % already has a client decision', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "proposal_versions_immutable"
  BEFORE UPDATE OR DELETE ON "proposal_versions"
  FOR EACH ROW EXECUTE FUNCTION "proposal_versions_guard"();

CREATE OR REPLACE FUNCTION "proposal_items_guard"() RETURNS trigger AS $$
DECLARE
  parent_status "ProposalStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "proposal_versions"
    WHERE "id" = (CASE WHEN TG_OP = 'DELETE' THEN OLD."version_id" ELSE NEW."version_id" END);
  IF parent_status IS DISTINCT FROM 'DRAFT' THEN
    RAISE EXCEPTION 'items of a non-draft proposal version are immutable' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND NEW."version_id" <> OLD."version_id" THEN
    RAISE EXCEPTION 'items cannot move between versions' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "proposal_items_immutable"
  BEFORE INSERT OR UPDATE OR DELETE ON "proposal_items"
  FOR EACH ROW EXECUTE FUNCTION "proposal_items_guard"();

-- Review records are history: append-only, like audit events.
CREATE OR REPLACE FUNCTION "proposal_reviews_block_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'proposal_reviews is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "proposal_reviews_no_update_delete"
  BEFORE UPDATE OR DELETE ON "proposal_reviews"
  FOR EACH ROW EXECUTE FUNCTION "proposal_reviews_block_mutation"();
