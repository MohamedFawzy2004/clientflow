-- CreateEnum
CREATE TYPE "TaskScope" AS ENUM ('BASELINE', 'CHANGE', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "ChangeStatus" AS ENUM ('REQUESTED', 'ESTIMATING', 'IN_REVIEW', 'AWAITING_CLIENT', 'ACCEPTED', 'REJECTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ChangeVersionStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED_INTERNAL', 'SENT', 'ACCEPTED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "ChangeDecisionKind" AS ENUM ('ACCEPTED', 'REJECTED');

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "change_request_id" UUID,
ADD COLUMN     "scope" "TaskScope" NOT NULL DEFAULT 'BASELINE',
ADD COLUMN     "scope_note" VARCHAR(500);

-- CreateTable
CREATE TABLE "change_requests" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000) NOT NULL,
    "justification" VARCHAR(2000),
    "status" "ChangeStatus" NOT NULL DEFAULT 'REQUESTED',
    "current_version_no" INTEGER NOT NULL DEFAULT 0,
    "requested_by_id" UUID NOT NULL,
    "requested_by_client" BOOLEAN NOT NULL DEFAULT false,
    "accepted_version_id" UUID,
    "withdrawn_reason" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "change_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_versions" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "change_request_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "status" "ChangeVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "scope" VARCHAR(5000) NOT NULL DEFAULT '',
    "work_items" VARCHAR(5000),
    "estimate_minutes" INTEGER,
    "price_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 1400,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "new_due_on" DATE,
    "content_hash" CHAR(64),
    "submitted_at" TIMESTAMPTZ(3),
    "approved_at" TIMESTAMPTZ(3),
    "approved_by_id" UUID,
    "sent_at" TIMESTAMPTZ(3),
    "sent_by_id" UUID,
    "budget_before_minor" BIGINT,
    "budget_after_minor" BIGINT,
    "due_before" DATE,
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "change_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "change_decisions" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "decision" "ChangeDecisionKind" NOT NULL,
    "reason" VARCHAR(2000),
    "content_hash" CHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_comments" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "entity_type" VARCHAR(20) NOT NULL,
    "entity_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "edited_at" TIMESTAMPTZ(3),
    "deleted_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_comment_revisions" (
    "id" UUID NOT NULL,
    "comment_id" UUID NOT NULL,
    "body" VARCHAR(2000) NOT NULL,
    "replaced_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_comment_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_accepted_version_id_key" ON "change_requests"("accepted_version_id");

-- CreateIndex
CREATE INDEX "change_requests_project_id_status_idx" ON "change_requests"("project_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_project_id_number_key" ON "change_requests"("project_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_agency_id_id_key" ON "change_requests"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_requests_project_id_id_key" ON "change_requests"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_versions_change_request_id_version_no_key" ON "change_versions"("change_request_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "change_versions_agency_id_id_key" ON "change_versions"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "change_decisions_agency_id_version_id_key" ON "change_decisions"("agency_id", "version_id");

-- CreateIndex
CREATE INDEX "project_comments_project_id_entity_type_entity_id_created_a_idx" ON "project_comments"("project_id", "entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "project_comment_revisions_comment_id_replaced_at_idx" ON "project_comment_revisions"("comment_id", "replaced_at");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_change_request_id_fkey" FOREIGN KEY ("change_request_id") REFERENCES "change_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_agency_id_requested_by_id_fkey" FOREIGN KEY ("agency_id", "requested_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_requests" ADD CONSTRAINT "change_requests_accepted_version_id_fkey" FOREIGN KEY ("accepted_version_id") REFERENCES "change_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_versions" ADD CONSTRAINT "change_versions_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_versions" ADD CONSTRAINT "change_versions_project_id_change_request_id_fkey" FOREIGN KEY ("project_id", "change_request_id") REFERENCES "change_requests"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_versions" ADD CONSTRAINT "change_versions_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_versions" ADD CONSTRAINT "change_versions_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_versions" ADD CONSTRAINT "change_versions_sent_by_id_fkey" FOREIGN KEY ("sent_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_decisions" ADD CONSTRAINT "change_decisions_agency_id_version_id_fkey" FOREIGN KEY ("agency_id", "version_id") REFERENCES "change_versions"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "change_decisions" ADD CONSTRAINT "change_decisions_agency_id_actor_id_fkey" FOREIGN KEY ("agency_id", "actor_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_comments" ADD CONSTRAINT "project_comments_agency_id_author_id_fkey" FOREIGN KEY ("agency_id", "author_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_comment_revisions" ADD CONSTRAINT "project_comment_revisions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "project_comments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written rules (M8).
ALTER TABLE "change_requests"
  ADD CONSTRAINT "change_requests_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "change_requests_description_not_blank" CHECK (length(btrim("description")) > 0),
  ADD CONSTRAINT "change_requests_number_positive" CHECK ("number" > 0),
  ADD CONSTRAINT "change_requests_version_no_non_negative" CHECK ("current_version_no" >= 0),
  ADD CONSTRAINT "change_requests_version_positive" CHECK ("version" > 0),
  -- Withdrawing always says why.
  ADD CONSTRAINT "change_requests_withdrawn_reason" CHECK (("status" = 'WITHDRAWN') = ("withdrawn_reason" IS NOT NULL)),
  -- Accepted means exactly one accepted version is recorded.
  ADD CONSTRAINT "change_requests_accepted_version" CHECK (("status" = 'ACCEPTED') = ("accepted_version_id" IS NOT NULL));

ALTER TABLE "change_versions"
  ADD CONSTRAINT "change_versions_no_positive" CHECK ("version_no" > 0),
  ADD CONSTRAINT "change_versions_price_range" CHECK ("price_minor" >= 0 AND "price_minor" <= 900000000000000),
  ADD CONSTRAINT "change_versions_totals" CHECK ("tax_minor" >= 0 AND "total_minor" = "price_minor" + "tax_minor"),
  ADD CONSTRAINT "change_versions_tax_rate" CHECK ("tax_rate_bp" >= 0 AND "tax_rate_bp" <= 10000),
  ADD CONSTRAINT "change_versions_estimate_range" CHECK ("estimate_minutes" IS NULL OR ("estimate_minutes" >= 0 AND "estimate_minutes" <= 600000)),
  ADD CONSTRAINT "change_versions_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED')),
  ADD CONSTRAINT "change_versions_hash_hex" CHECK ("content_hash" IS NULL OR "content_hash" ~ '^[0-9a-f]{64}$'),
  -- A version is hashed exactly when it is sent.
  ADD CONSTRAINT "change_versions_sent_hashed" CHECK (("sent_at" IS NULL) = ("content_hash" IS NULL)),
  ADD CONSTRAINT "change_versions_version_positive" CHECK ("version" > 0);

ALTER TABLE "change_decisions"
  ADD CONSTRAINT "change_decisions_hash_hex" CHECK ("content_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "change_decisions_reason_on_reject" CHECK ("decision" = 'ACCEPTED' OR length(btrim(coalesce("reason", ''))) > 0);

ALTER TABLE "project_comments"
  ADD CONSTRAINT "project_comments_entity_type" CHECK ("entity_type" IN ('deliverable', 'change')),
  ADD CONSTRAINT "project_comments_body_not_blank" CHECK (length(btrim("body")) > 0),
  ADD CONSTRAINT "project_comments_version_positive" CHECK ("version" > 0);

-- FR-S05: extra work is either an accepted change or a documented exception.
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_change_scope_consistent" CHECK (("scope" = 'CHANGE') = ("change_request_id" IS NOT NULL)),
  ADD CONSTRAINT "tasks_exception_documented" CHECK ("scope" <> 'EXCEPTION' OR length(btrim(coalesce("scope_note", ''))) >= 10);

CREATE OR REPLACE FUNCTION "tasks_change_guard"() RETURNS trigger AS $$
BEGIN
  IF NEW."change_request_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "change_requests" c
    WHERE c."id" = NEW."change_request_id" AND c."project_id" = NEW."project_id" AND c."status" = 'ACCEPTED'
  ) THEN
    RAISE EXCEPTION 'tasks can only reference an accepted change request of the same project' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "tasks_change_accepted_only"
  BEFORE INSERT OR UPDATE OF "change_request_id", "project_id" ON "tasks"
  FOR EACH ROW EXECUTE FUNCTION "tasks_change_guard"();

-- A sent version is what the client saw (FR-S03): its content can never change, it is never
-- deleted, and once decided, superseded or withdrawn it is final.
CREATE OR REPLACE FUNCTION "change_versions_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."content_hash" IS NOT NULL THEN
      RAISE EXCEPTION 'change version % cannot be deleted', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" IN ('ACCEPTED', 'REJECTED', 'SUPERSEDED', 'WITHDRAWN') THEN
    RAISE EXCEPTION 'change version % is final', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."content_hash" IS NOT NULL AND (
       NEW."content_hash" IS DISTINCT FROM OLD."content_hash"
    OR NEW."scope" <> OLD."scope"
    OR NEW."work_items" IS DISTINCT FROM OLD."work_items"
    OR NEW."estimate_minutes" IS DISTINCT FROM OLD."estimate_minutes"
    OR NEW."price_minor" <> OLD."price_minor"
    OR NEW."currency" <> OLD."currency"
    OR NEW."tax_rate_bp" <> OLD."tax_rate_bp"
    OR NEW."tax_minor" <> OLD."tax_minor"
    OR NEW."total_minor" <> OLD."total_minor"
    OR NEW."new_due_on" IS DISTINCT FROM OLD."new_due_on"
    OR NEW."version_no" <> OLD."version_no"
    OR NEW."change_request_id" <> OLD."change_request_id") THEN
    RAISE EXCEPTION 'change version % was sent and is immutable', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "change_versions_immutable"
  BEFORE UPDATE OR DELETE ON "change_versions"
  FOR EACH ROW EXECUTE FUNCTION "change_versions_guard"();

-- Decisions and comment history are append-only, like audit events.
CREATE OR REPLACE FUNCTION "m8_append_only"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only', TG_TABLE_NAME USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "change_decisions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "change_decisions"
  FOR EACH ROW EXECUTE FUNCTION "m8_append_only"();

CREATE TRIGGER "project_comment_revisions_no_update_delete"
  BEFORE UPDATE OR DELETE ON "project_comment_revisions"
  FOR EACH ROW EXECUTE FUNCTION "m8_append_only"();
