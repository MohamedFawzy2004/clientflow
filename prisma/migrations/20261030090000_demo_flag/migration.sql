-- Marks a demo workspace (ADR-066). Only the demo reset sets it; a reset refuses an agency without it.
ALTER TABLE "agencies" ADD COLUMN "is_demo" BOOLEAN NOT NULL DEFAULT false;
