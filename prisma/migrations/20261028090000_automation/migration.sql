-- CreateEnum
CREATE TYPE "NotificationCategory" AS ENUM ('CLIENT_ACTIVITY', 'APPROVALS', 'TASKS', 'FOLLOW_UPS', 'INVOICES');

-- CreateEnum
CREATE TYPE "JobState" AS ENUM ('PENDING', 'RUNNING', 'DONE', 'DEAD');

-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "import_run_id" UUID;

-- AlterTable
ALTER TABLE "deals" ADD COLUMN     "import_run_id" UUID;

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "type" VARCHAR(60) NOT NULL,
    "title" VARCHAR(300) NOT NULL,
    "link" VARCHAR(300) NOT NULL,
    "entity_type" VARCHAR(40),
    "entity_id" UUID,
    "actor_id" UUID,
    "dedupe_key" VARCHAR(200),
    "in_app" BOOLEAN NOT NULL DEFAULT true,
    "read_at" TIMESTAMPTZ(3),
    "emailed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "user_id" UUID NOT NULL,
    "category" "NotificationCategory" NOT NULL,
    "in_app" BOOLEAN NOT NULL,
    "email" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("user_id","category")
);

-- CreateTable
CREATE TABLE "outbox_jobs" (
    "id" UUID NOT NULL,
    "agency_id" UUID,
    "kind" VARCHAR(60) NOT NULL,
    "payload" JSONB NOT NULL,
    "state" "JobState" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "max_attempts" INTEGER NOT NULL DEFAULT 6,
    "available_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_until" TIMESTAMPTZ(3),
    "last_error" VARCHAR(300),
    "dedupe_key" VARCHAR(200),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),

    CONSTRAINT "outbox_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_runs" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "kind" VARCHAR(20) NOT NULL,
    "filename" VARCHAR(200),
    "file_sha256" CHAR(64) NOT NULL,
    "rows_total" INTEGER NOT NULL,
    "rows_created" INTEGER NOT NULL,
    "rows_skipped" INTEGER NOT NULL,
    "rows_failed" INTEGER NOT NULL,
    "undone_at" TIMESTAMPTZ(3),
    "undone_by_id" UUID,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_in_app_created_at_idx" ON "notifications"("recipient_id", "in_app", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_at_idx" ON "notifications"("recipient_id", "read_at");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_recipient_id_dedupe_key_key" ON "notifications"("recipient_id", "dedupe_key");

-- CreateIndex
CREATE UNIQUE INDEX "outbox_jobs_dedupe_key_key" ON "outbox_jobs"("dedupe_key");

-- CreateIndex
CREATE INDEX "outbox_jobs_state_available_at_idx" ON "outbox_jobs"("state", "available_at");

-- CreateIndex
CREATE INDEX "import_runs_agency_id_created_at_idx" ON "import_runs"("agency_id", "created_at" DESC);

-- CreateIndex
CREATE INDEX "contacts_import_run_id_idx" ON "contacts"("import_run_id");

-- CreateIndex
CREATE INDEX "deals_import_run_id_idx" ON "deals"("import_run_id");

-- AddForeignKey
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deals" ADD CONSTRAINT "deals_import_run_id_fkey" FOREIGN KEY ("import_run_id") REFERENCES "import_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_agency_id_recipient_id_fkey" FOREIGN KEY ("agency_id", "recipient_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_agency_id_fkey" FOREIGN KEY ("agency_id") REFERENCES "agencies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_runs" ADD CONSTRAINT "import_runs_agency_id_actor_id_fkey" FOREIGN KEY ("agency_id", "actor_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Checks (spec §8.2: validate at the database too).
ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_link_in_app" CHECK ("link" LIKE '/app/%' AND "link" NOT LIKE '%//%'),
  ADD CONSTRAINT "notifications_title_not_blank" CHECK (length(btrim("title")) > 0),
  ADD CONSTRAINT "notifications_entity_pair" CHECK (("entity_type" IS NULL) = ("entity_id" IS NULL));

ALTER TABLE "outbox_jobs"
  ADD CONSTRAINT "outbox_jobs_attempts" CHECK ("attempts" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempts" <= "max_attempts"),
  ADD CONSTRAINT "outbox_jobs_payload_small" CHECK (pg_column_size("payload") <= 4096),
  ADD CONSTRAINT "outbox_jobs_running_locked" CHECK (("state" = 'RUNNING') = ("locked_until" IS NOT NULL)),
  ADD CONSTRAINT "outbox_jobs_finished" CHECK (("state" IN ('DONE', 'DEAD')) = ("finished_at" IS NOT NULL));

ALTER TABLE "import_runs"
  ADD CONSTRAINT "import_runs_kind" CHECK ("kind" IN ('contacts', 'deals')),
  ADD CONSTRAINT "import_runs_counts" CHECK ("rows_total" >= 0 AND "rows_created" >= 0 AND "rows_skipped" >= 0 AND "rows_failed" >= 0 AND "rows_created" + "rows_skipped" + "rows_failed" = "rows_total"),
  ADD CONSTRAINT "import_runs_undo_recorded" CHECK (("undone_at" IS NULL) = ("undone_by_id" IS NULL));
