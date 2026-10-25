-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "address" VARCHAR(500),
ADD COLUMN     "contact_email" VARCHAR(254),
ADD COLUMN     "phone" VARCHAR(40),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "working_days" INTEGER[] DEFAULT ARRAY[0, 1, 2, 3, 4]::INTEGER[];


-- Hand-written rules (M5): agency profile values the app relies on.
ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_version_positive" CHECK ("version" > 0),
  ADD CONSTRAINT "agencies_contact_email_normalized" CHECK (
    "contact_email" IS NULL OR ("contact_email" = lower(btrim("contact_email")) AND position('@' in "contact_email") > 1)),
  -- Days are 0 (Sunday) to 6 (Saturday), at least one working day.
  ADD CONSTRAINT "agencies_working_days_valid" CHECK (
    "working_days" IS NOT NULL
    AND cardinality("working_days") BETWEEN 1 AND 7
    AND "working_days" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]),
  ADD CONSTRAINT "agencies_currency_supported" CHECK ("default_currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'));
