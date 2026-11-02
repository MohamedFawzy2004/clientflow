-- CreateEnum
CREATE TYPE "ProjectState" AS ENUM ('PLANNED', 'ACTIVE', 'ON_HOLD', 'COMPLETED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('MANAGER', 'MEMBER');

-- CreateEnum
CREATE TYPE "MilestoneStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'DONE');

-- CreateTable
CREATE TABLE "projects" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "state" "ProjectState" NOT NULL DEFAULT 'PLANNED',
    "deal_id" UUID,
    "baseline_version_id" UUID,
    "contact_id" UUID,
    "client_org_id" UUID,
    "manager_id" UUID NOT NULL,
    "start_on" DATE,
    "due_on" DATE,
    "budget_minor" BIGINT NOT NULL DEFAULT 0,
    "currency" CHAR(3) NOT NULL,
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_members" (
    "project_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "role" "ProjectRole" NOT NULL DEFAULT 'MEMBER',
    "added_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("project_id","user_id")
);

-- CreateTable
CREATE TABLE "project_milestones" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "due_on" DATE,
    "status" "MilestoneStatus" NOT NULL DEFAULT 'PLANNED',
    "sequence" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "project_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "handoff_checklist_items" (
    "id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "label" VARCHAR(200) NOT NULL,
    "sequence" INTEGER NOT NULL,
    "done_at" TIMESTAMPTZ(3),
    "done_by_id" UUID,

    CONSTRAINT "handoff_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "scope" VARCHAR(60) NOT NULL,
    "key" UUID NOT NULL,
    "request_hash" CHAR(64) NOT NULL,
    "result_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_deal_id_key" ON "projects"("deal_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_baseline_version_id_key" ON "projects"("baseline_version_id");

-- CreateIndex
CREATE INDEX "projects_agency_id_state_updated_at_idx" ON "projects"("agency_id", "state", "updated_at" DESC);

-- CreateIndex
CREATE INDEX "projects_agency_id_manager_id_idx" ON "projects"("agency_id", "manager_id");

-- CreateIndex
CREATE UNIQUE INDEX "projects_agency_id_id_key" ON "projects"("agency_id", "id");

-- CreateIndex
CREATE INDEX "project_members_agency_id_user_id_idx" ON "project_members"("agency_id", "user_id");

-- CreateIndex
CREATE INDEX "project_milestones_agency_id_due_on_idx" ON "project_milestones"("agency_id", "due_on");

-- CreateIndex
CREATE UNIQUE INDEX "project_milestones_project_id_sequence_key" ON "project_milestones"("project_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "handoff_checklist_items_project_id_sequence_key" ON "handoff_checklist_items"("project_id", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_agency_id_scope_key_key" ON "idempotency_records"("agency_id", "scope", "key");

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_agency_id_manager_id_fkey" FOREIGN KEY ("agency_id", "manager_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_deal_id_fkey" FOREIGN KEY ("deal_id") REFERENCES "deals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_baseline_version_id_fkey" FOREIGN KEY ("baseline_version_id") REFERENCES "proposal_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_contact_id_fkey" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "projects" ADD CONSTRAINT "projects_client_org_id_fkey" FOREIGN KEY ("client_org_id") REFERENCES "client_organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_agency_id_user_id_fkey" FOREIGN KEY ("agency_id", "user_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_milestones" ADD CONSTRAINT "project_milestones_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_checklist_items" ADD CONSTRAINT "handoff_checklist_items_agency_id_project_id_fkey" FOREIGN KEY ("agency_id", "project_id") REFERENCES "projects"("agency_id", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "handoff_checklist_items" ADD CONSTRAINT "handoff_checklist_items_done_by_id_fkey" FOREIGN KEY ("done_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Hand-written rules (M6).
ALTER TABLE "projects"
  ADD CONSTRAINT "projects_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "projects_budget_range" CHECK ("budget_minor" >= 0 AND "budget_minor" <= 900000000000000),
  ADD CONSTRAINT "projects_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED')),
  ADD CONSTRAINT "projects_dates_ordered" CHECK ("start_on" IS NULL OR "due_on" IS NULL OR "start_on" <= "due_on"),
  -- A project made from a deal always carries the accepted version it was made from, and the reverse.
  ADD CONSTRAINT "projects_deal_has_baseline" CHECK (("deal_id" IS NULL) = ("baseline_version_id" IS NULL)),
  ADD CONSTRAINT "projects_version_positive" CHECK ("version" > 0);

ALTER TABLE "project_milestones"
  ADD CONSTRAINT "project_milestones_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "project_milestones_sequence_non_negative" CHECK ("sequence" >= 0),
  ADD CONSTRAINT "project_milestones_version_positive" CHECK ("version" > 0);

ALTER TABLE "handoff_checklist_items"
  ADD CONSTRAINT "handoff_checklist_label_not_blank" CHECK (length(btrim("label")) > 0),
  ADD CONSTRAINT "handoff_checklist_done_consistent" CHECK (("done_at" IS NULL) = ("done_by_id" IS NULL));

ALTER TABLE "idempotency_records"
  ADD CONSTRAINT "idempotency_records_hash_hex" CHECK ("request_hash" ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT "idempotency_records_scope_not_blank" CHECK (length(btrim("scope")) > 0);
