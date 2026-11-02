-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'BLOCKED', 'IN_REVIEW', 'DONE', 'CANCELED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "FileScanStatus" AS ENUM ('PENDING', 'CLEAN', 'QUARANTINED');

-- CreateEnum
CREATE TYPE "DeliverableStatus" AS ENUM ('DRAFT', 'READY', 'PUBLISHED', 'REVISION_REQUESTED', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "DeliverableDecision" AS ENUM ('APPROVED', 'REVISION_REQUESTED', 'REJECTED');

-- CreateTable
CREATE TABLE "tasks" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "milestone_id" UUID,
    "assignee_id" UUID,
    "created_by_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(5000),
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "due_on" DATE,
    "estimate_minutes" INTEGER,
    "completed_at" TIMESTAMPTZ(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "tasks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_dependencies" (
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "depends_on_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "task_dependencies_pkey" PRIMARY KEY ("task_id","depends_on_id")
);

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "task_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "worked_on" DATE NOT NULL,
    "minutes" INTEGER NOT NULL,
    "billable" BOOLEAN NOT NULL DEFAULT true,
    "note" VARCHAR(1000),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "storage_key" VARCHAR(100) NOT NULL,
    "original_name" VARCHAR(255) NOT NULL,
    "extension" VARCHAR(10) NOT NULL,
    "mime_type" VARCHAR(120) NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "scan_status" "FileScanStatus" NOT NULL DEFAULT 'PENDING',
    "scan_detail" VARCHAR(200),
    "scanned_at" TIMESTAMPTZ(3),
    "enc_iv" BYTEA,
    "enc_tag" BYTEA,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverables" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "milestone_id" UUID,
    "title" VARCHAR(200) NOT NULL,
    "description" VARCHAR(2000),
    "status" "DeliverableStatus" NOT NULL DEFAULT 'DRAFT',
    "review_due_on" DATE,
    "current_version_no" INTEGER NOT NULL DEFAULT 0,
    "published_at" TIMESTAMPTZ(3),
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "deliverables_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_versions" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "deliverable_id" UUID NOT NULL,
    "version_no" INTEGER NOT NULL,
    "file_id" UUID NOT NULL,
    "note" VARCHAR(2000),
    "file_sha256" CHAR(64) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "published_at" TIMESTAMPTZ(3),
    "published_by_id" UUID,

    CONSTRAINT "deliverable_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deliverable_reviews" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "decision" "DeliverableDecision" NOT NULL,
    "reason" VARCHAR(2000),
    "file_sha256" CHAR(64) NOT NULL,
    "occurred_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deliverable_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_portal_shares" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "shared_by_id" UUID NOT NULL,
    "shared_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMPTZ(3),
    "revoked_by_id" UUID,

    CONSTRAINT "project_portal_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "tasks_project_id_status_idx" ON "tasks"("project_id", "status");

-- CreateIndex
CREATE INDEX "tasks_agency_id_assignee_id_status_idx" ON "tasks"("agency_id", "assignee_id", "status");

-- CreateIndex
CREATE INDEX "tasks_agency_id_due_on_idx" ON "tasks"("agency_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_agency_id_id_key" ON "tasks"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "tasks_project_id_id_key" ON "tasks"("project_id", "id");

-- CreateIndex
CREATE INDEX "task_dependencies_depends_on_id_idx" ON "task_dependencies"("depends_on_id");

-- CreateIndex
CREATE INDEX "time_entries_task_id_idx" ON "time_entries"("task_id");

-- CreateIndex
CREATE INDEX "time_entries_agency_id_project_id_worked_on_idx" ON "time_entries"("agency_id", "project_id", "worked_on");

-- CreateIndex
CREATE INDEX "time_entries_agency_id_user_id_worked_on_idx" ON "time_entries"("agency_id", "user_id", "worked_on");

-- CreateIndex
CREATE UNIQUE INDEX "files_storage_key_key" ON "files"("storage_key");

-- CreateIndex
CREATE INDEX "files_project_id_created_at_idx" ON "files"("project_id", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "files_agency_id_id_key" ON "files"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "files_project_id_id_key" ON "files"("project_id", "id");

-- CreateIndex
CREATE INDEX "deliverables_project_id_status_idx" ON "deliverables"("project_id", "status");

-- CreateIndex
CREATE INDEX "deliverables_agency_id_status_review_due_on_idx" ON "deliverables"("agency_id", "status", "review_due_on");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_agency_id_id_key" ON "deliverables"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverables_project_id_id_key" ON "deliverables"("project_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_versions_deliverable_id_version_no_key" ON "deliverable_versions"("deliverable_id", "version_no");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_versions_agency_id_id_key" ON "deliverable_versions"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_versions_project_id_file_id_key" ON "deliverable_versions"("project_id", "file_id");

-- CreateIndex
CREATE UNIQUE INDEX "deliverable_reviews_agency_id_version_id_key" ON "deliverable_reviews"("agency_id", "version_id");

-- CreateIndex
CREATE INDEX "project_portal_shares_agency_id_user_id_idx" ON "project_portal_shares"("agency_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_portal_shares_project_id_user_id_key" ON "project_portal_shares"("project_id", "user_id");

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_assignee_id_fkey" FOREIGN KEY ("assignee_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "tasks"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_project_id_depends_on_id_fkey" FOREIGN KEY ("project_id", "depends_on_id") REFERENCES "tasks"("project_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_project_id_task_id_fkey" FOREIGN KEY ("project_id", "task_id") REFERENCES "tasks"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_agency_id_user_id_fkey" FOREIGN KEY ("agency_id", "user_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_agency_id_uploaded_by_id_fkey" FOREIGN KEY ("agency_id", "uploaded_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_milestone_id_fkey" FOREIGN KEY ("milestone_id") REFERENCES "project_milestones"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverables" ADD CONSTRAINT "deliverables_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_project_id_deliverable_id_fkey" FOREIGN KEY ("project_id", "deliverable_id") REFERENCES "deliverables"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_project_id_file_id_fkey" FOREIGN KEY ("project_id", "file_id") REFERENCES "files"("project_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_versions" ADD CONSTRAINT "deliverable_versions_published_by_id_fkey" FOREIGN KEY ("published_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_reviews" ADD CONSTRAINT "deliverable_reviews_agency_id_version_id_fkey" FOREIGN KEY ("agency_id", "version_id") REFERENCES "deliverable_versions"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deliverable_reviews" ADD CONSTRAINT "deliverable_reviews_agency_id_actor_id_fkey" FOREIGN KEY ("agency_id", "actor_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_portal_shares" ADD CONSTRAINT "project_portal_shares_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_portal_shares" ADD CONSTRAINT "project_portal_shares_agency_id_user_id_fkey" FOREIGN KEY ("agency_id", "user_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_portal_shares" ADD CONSTRAINT "project_portal_shares_agency_id_shared_by_id_fkey" FOREIGN KEY ("agency_id", "shared_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_portal_shares" ADD CONSTRAINT "project_portal_shares_revoked_by_id_fkey" FOREIGN KEY ("revoked_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written rules (M7).
ALTER TABLE "tasks"
  ADD CONSTRAINT "tasks_title_not_blank" CHECK (length(btrim("title")) > 0),
  -- Up to 10,000 hours.
  ADD CONSTRAINT "tasks_estimate_range" CHECK ("estimate_minutes" IS NULL OR ("estimate_minutes" >= 0 AND "estimate_minutes" <= 600000)),
  ADD CONSTRAINT "tasks_completed_consistent" CHECK (("status" = 'DONE') = ("completed_at" IS NOT NULL)),
  ADD CONSTRAINT "tasks_version_positive" CHECK ("version" > 0);

ALTER TABLE "task_dependencies"
  ADD CONSTRAINT "task_dependencies_not_self" CHECK ("task_id" <> "depends_on_id");

ALTER TABLE "time_entries"
  -- One entry is at most one day of work.
  ADD CONSTRAINT "time_entries_minutes_range" CHECK ("minutes" >= 1 AND "minutes" <= 1440),
  ADD CONSTRAINT "time_entries_version_positive" CHECK ("version" > 0);

ALTER TABLE "files"
  -- Hard ceiling of 100 MB; the configured limit (FILE_MAX_BYTES) is lower.
  ADD CONSTRAINT "files_size_range" CHECK ("size_bytes" >= 1 AND "size_bytes" <= 104857600),
  ADD CONSTRAINT "files_sha256_hex" CHECK ("sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "files_extension_format" CHECK ("extension" ~ '^[a-z0-9]{1,10}$'),
  ADD CONSTRAINT "files_name_not_blank" CHECK (length(btrim("original_name")) > 0),
  ADD CONSTRAINT "files_scan_consistent" CHECK (("scan_status" = 'PENDING') = ("scanned_at" IS NULL));

ALTER TABLE "deliverables"
  ADD CONSTRAINT "deliverables_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "deliverables_version_no_non_negative" CHECK ("current_version_no" >= 0),
  ADD CONSTRAINT "deliverables_version_positive" CHECK ("version" > 0),
  -- Nothing reaches the client without an explicit publish (FR-S06).
  ADD CONSTRAINT "deliverables_published_has_date" CHECK ("status" NOT IN ('PUBLISHED', 'REVISION_REQUESTED', 'APPROVED') OR "published_at" IS NOT NULL);

ALTER TABLE "deliverable_versions"
  ADD CONSTRAINT "deliverable_versions_no_positive" CHECK ("version_no" > 0),
  ADD CONSTRAINT "deliverable_versions_sha256_hex" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "deliverable_versions_published_consistent" CHECK (("published_at" IS NULL) = ("published_by_id" IS NULL));

ALTER TABLE "deliverable_reviews"
  ADD CONSTRAINT "deliverable_reviews_sha256_hex" CHECK ("file_sha256" ~ '^[0-9a-f]{64}$'),
  -- Rejecting or asking for a revision always says why (FR-S07).
  ADD CONSTRAINT "deliverable_reviews_reason_required" CHECK ("decision" = 'APPROVED' OR length(btrim(coalesce("reason", ''))) > 0);

ALTER TABLE "project_portal_shares"
  ADD CONSTRAINT "project_portal_shares_revoked_consistent" CHECK (("revoked_at" IS NULL) = ("revoked_by_id" IS NULL));

-- Versions are history (FR-S08): never deleted, and frozen once published. Before publishing,
-- the only change allowed is the publish itself.
CREATE OR REPLACE FUNCTION "deliverable_versions_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'deliverable version % cannot be deleted', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."published_at" IS NOT NULL
     OR NEW."file_id" <> OLD."file_id"
     OR NEW."file_sha256" <> OLD."file_sha256"
     OR NEW."version_no" <> OLD."version_no"
     OR NEW."deliverable_id" <> OLD."deliverable_id"
     OR NEW."project_id" <> OLD."project_id"
     OR NEW."note" IS DISTINCT FROM OLD."note" THEN
    RAISE EXCEPTION 'deliverable version % is immutable', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "deliverable_versions_immutable"
  BEFORE UPDATE OR DELETE ON "deliverable_versions"
  FOR EACH ROW EXECUTE FUNCTION "deliverable_versions_guard"();

-- Client decisions are history: append-only, like audit events.
CREATE OR REPLACE FUNCTION "deliverable_reviews_block_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'deliverable_reviews is append-only' USING ERRCODE = 'check_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "deliverable_reviews_no_update_delete"
  BEFORE UPDATE OR DELETE ON "deliverable_reviews"
  FOR EACH ROW EXECUTE FUNCTION "deliverable_reviews_block_mutation"();

-- A project can only be shared with a CLIENT user of the project's own client organization.
CREATE OR REPLACE FUNCTION "project_portal_shares_guard"() RETURNS trigger AS $$
DECLARE
  ok boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM "users" u JOIN "projects" p ON p."id" = NEW."project_id"
    WHERE u."id" = NEW."user_id"
      AND u."role" = 'CLIENT'
      AND p."client_org_id" IS NOT NULL
      AND u."client_org_id" = p."client_org_id"
  ) INTO ok;
  IF NOT ok THEN
    RAISE EXCEPTION 'projects can only be shared with users of the project''s client organization' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "project_portal_shares_client_only"
  BEFORE INSERT OR UPDATE OF "user_id", "project_id" ON "project_portal_shares"
  FOR EACH ROW EXECUTE FUNCTION "project_portal_shares_guard"();

