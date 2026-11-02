-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REVERSAL');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('BANK_TRANSFER', 'CASH', 'CHEQUE', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceLineSource" AS ENUM ('MILESTONE', 'CHANGE', 'OTHER');

-- AlterTable
ALTER TABLE "agencies" ADD COLUMN     "invoice_seq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "client_org_id" UUID NOT NULL,
    "project_id" UUID,
    "number" INTEGER,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" CHAR(3) NOT NULL,
    "tax_rate_bp" INTEGER NOT NULL DEFAULT 1400,
    "due_on" DATE NOT NULL,
    "issued_on" DATE,
    "terms" VARCHAR(2000),
    "internal_note" VARCHAR(2000),
    "subtotal_minor" BIGINT NOT NULL DEFAULT 0,
    "tax_minor" BIGINT NOT NULL DEFAULT 0,
    "total_minor" BIGINT NOT NULL DEFAULT 0,
    "paid_minor" BIGINT NOT NULL DEFAULT 0,
    "billed_to_name" VARCHAR(200),
    "billed_to_contact" VARCHAR(200),
    "issuer_name" VARCHAR(200),
    "issuer_details" VARCHAR(1000),
    "issued_at" TIMESTAMPTZ(3),
    "issued_by_id" UUID,
    "published_at" TIMESTAMPTZ(3),
    "voided_at" TIMESTAMPTZ(3),
    "voided_by_id" UUID,
    "void_reason" VARCHAR(500),
    "created_by_id" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "position" INTEGER NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "quantity_centi" INTEGER NOT NULL,
    "unit_price_minor" BIGINT NOT NULL,
    "line_total_minor" BIGINT NOT NULL,
    "source" "InvoiceLineSource" NOT NULL DEFAULT 'OTHER',
    "source_id" UUID,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "received_on" DATE NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'BANK_TRANSFER',
    "reference" VARCHAR(120),
    "note" VARCHAR(500),
    "reverses_id" UUID,
    "recorded_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cost_rates" (
    "id" UUID NOT NULL,
    "agency_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "hourly_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "effective_from" DATE NOT NULL,
    "set_by_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "cost_rates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "invoices_agency_id_status_due_on_idx" ON "invoices"("agency_id", "status", "due_on");

-- CreateIndex
CREATE INDEX "invoices_project_id_idx" ON "invoices"("project_id");

-- CreateIndex
CREATE INDEX "invoices_agency_id_client_org_id_idx" ON "invoices"("agency_id", "client_org_id");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_agency_id_number_key" ON "invoices"("agency_id", "number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_agency_id_id_key" ON "invoices"("agency_id", "id");

-- CreateIndex
CREATE UNIQUE INDEX "invoice_items_invoice_id_position_key" ON "invoice_items"("invoice_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reverses_id_key" ON "payments"("reverses_id");

-- CreateIndex
CREATE INDEX "payments_invoice_id_created_at_idx" ON "payments"("invoice_id", "created_at");

-- CreateIndex
CREATE INDEX "payments_agency_id_received_on_idx" ON "payments"("agency_id", "received_on");

-- CreateIndex
CREATE INDEX "cost_rates_agency_id_user_id_effective_from_idx" ON "cost_rates"("agency_id", "user_id", "effective_from" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "cost_rates_user_id_effective_from_key" ON "cost_rates"("user_id", "effective_from");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agency_id_client_org_id_fkey" FOREIGN KEY ("agency_id", "client_org_id") REFERENCES "client_organizations"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_agency_id_created_by_id_fkey" FOREIGN KEY ("agency_id", "created_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_issued_by_id_fkey" FOREIGN KEY ("issued_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_voided_by_id_fkey" FOREIGN KEY ("voided_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agency_id_invoice_id_fkey" FOREIGN KEY ("agency_id", "invoice_id") REFERENCES "invoices"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_agency_id_recorded_by_id_fkey" FOREIGN KEY ("agency_id", "recorded_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reverses_id_fkey" FOREIGN KEY ("reverses_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_rates" ADD CONSTRAINT "cost_rates_agency_id_user_id_fkey" FOREIGN KEY ("agency_id", "user_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cost_rates" ADD CONSTRAINT "cost_rates_agency_id_set_by_id_fkey" FOREIGN KEY ("agency_id", "set_by_id") REFERENCES "users"("agency_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;



-- Hand-written rules (M9).
ALTER TABLE "agencies"
  ADD CONSTRAINT "agencies_invoice_seq_non_negative" CHECK ("invoice_seq" >= 0);

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED')),
  ADD CONSTRAINT "invoices_tax_rate" CHECK ("tax_rate_bp" >= 0 AND "tax_rate_bp" <= 10000),
  ADD CONSTRAINT "invoices_totals" CHECK ("subtotal_minor" >= 0 AND "tax_minor" >= 0 AND "total_minor" = "subtotal_minor" + "tax_minor" AND "total_minor" <= 900000000000000),
  -- Never a negative balance or an overpaid invoice (T-PAY-01).
  ADD CONSTRAINT "invoices_paid_range" CHECK ("paid_minor" >= 0 AND "paid_minor" <= "total_minor"),
  -- A number exists exactly when the invoice was issued.
  ADD CONSTRAINT "invoices_number_on_issue" CHECK (("status" = 'DRAFT') = ("number" IS NULL)),
  ADD CONSTRAINT "invoices_number_positive" CHECK ("number" IS NULL OR "number" > 0),
  ADD CONSTRAINT "invoices_issue_recorded" CHECK ("status" = 'DRAFT' OR ("issued_at" IS NOT NULL AND "issued_on" IS NOT NULL AND "issued_by_id" IS NOT NULL)),
  -- Status follows the money exactly.
  ADD CONSTRAINT "invoices_status_matches_paid" CHECK (
    ("status" <> 'ISSUED' OR "paid_minor" = 0) AND
    ("status" <> 'PARTIALLY_PAID' OR ("paid_minor" > 0 AND "paid_minor" < "total_minor")) AND
    ("status" <> 'PAID' OR "paid_minor" = "total_minor") AND
    ("status" <> 'DRAFT' OR "paid_minor" = 0)
  ),
  ADD CONSTRAINT "invoices_void_recorded" CHECK (("status" = 'VOID') = ("void_reason" IS NOT NULL AND "voided_at" IS NOT NULL)),
  ADD CONSTRAINT "invoices_void_unpaid" CHECK ("status" <> 'VOID' OR "paid_minor" = 0),
  ADD CONSTRAINT "invoices_published_after_issue" CHECK ("published_at" IS NULL OR "status" <> 'DRAFT'),
  ADD CONSTRAINT "invoices_version_positive" CHECK ("version" > 0);

ALTER TABLE "invoice_items"
  ADD CONSTRAINT "invoice_items_description_not_blank" CHECK (length(btrim("description")) > 0),
  ADD CONSTRAINT "invoice_items_quantity" CHECK ("quantity_centi" > 0 AND "quantity_centi" <= 10000000),
  ADD CONSTRAINT "invoice_items_price" CHECK ("unit_price_minor" >= 0 AND "line_total_minor" >= 0),
  ADD CONSTRAINT "invoice_items_position" CHECK ("position" >= 0),
  ADD CONSTRAINT "invoice_items_source_id" CHECK (("source" = 'OTHER') = ("source_id" IS NULL));

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_positive" CHECK ("amount_minor" > 0 AND "amount_minor" <= 900000000000000),
  ADD CONSTRAINT "payments_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED')),
  ADD CONSTRAINT "payments_reversal_link" CHECK (("kind" = 'REVERSAL') = ("reverses_id" IS NOT NULL)),
  -- SEC-14: a reference is a bank or receipt reference, never something shaped like a card number.
  ADD CONSTRAINT "payments_no_card_numbers" CHECK ("reference" IS NULL OR "reference" !~ '[0-9]{13,}');

ALTER TABLE "cost_rates"
  ADD CONSTRAINT "cost_rates_amount" CHECK ("hourly_minor" >= 0 AND "hourly_minor" <= 100000000000),
  ADD CONSTRAINT "cost_rates_currency_supported" CHECK ("currency" IN ('EGP', 'USD', 'EUR', 'GBP', 'SAR', 'AED'));

-- An issued invoice is a snapshot (FR-F02): what it bills, to whom and for how much never changes.
-- Only its status, payments total, portal visibility, void fields and the internal note move.
-- A void invoice is final. Drafts can be deleted; issued invoices cannot.
CREATE OR REPLACE FUNCTION "invoices_guard"() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD."status" <> 'DRAFT' THEN
      RAISE EXCEPTION 'invoice % was issued and cannot be deleted', OLD."id" USING ERRCODE = 'check_violation';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD."status" = 'VOID' THEN
    RAISE EXCEPTION 'invoice % is void', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  IF OLD."status" <> 'DRAFT' AND (
       NEW."client_org_id" <> OLD."client_org_id"
    OR NEW."project_id" IS DISTINCT FROM OLD."project_id"
    OR NEW."number" IS DISTINCT FROM OLD."number"
    OR NEW."currency" <> OLD."currency"
    OR NEW."tax_rate_bp" <> OLD."tax_rate_bp"
    OR NEW."due_on" <> OLD."due_on"
    OR NEW."issued_on" IS DISTINCT FROM OLD."issued_on"
    OR NEW."terms" IS DISTINCT FROM OLD."terms"
    OR NEW."subtotal_minor" <> OLD."subtotal_minor"
    OR NEW."tax_minor" <> OLD."tax_minor"
    OR NEW."total_minor" <> OLD."total_minor"
    OR NEW."billed_to_name" IS DISTINCT FROM OLD."billed_to_name"
    OR NEW."billed_to_contact" IS DISTINCT FROM OLD."billed_to_contact"
    OR NEW."issuer_name" IS DISTINCT FROM OLD."issuer_name"
    OR NEW."issuer_details" IS DISTINCT FROM OLD."issuer_details"
    OR NEW."issued_at" IS DISTINCT FROM OLD."issued_at"
    OR NEW."issued_by_id" IS DISTINCT FROM OLD."issued_by_id") THEN
    RAISE EXCEPTION 'invoice % was issued and is immutable', OLD."id" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoices_immutable_after_issue"
  BEFORE UPDATE OR DELETE ON "invoices"
  FOR EACH ROW EXECUTE FUNCTION "invoices_guard"();

-- Lines change only while the invoice is a draft (deleting a draft cascades to its lines).
CREATE OR REPLACE FUNCTION "invoice_items_guard"() RETURNS trigger AS $$
DECLARE
  parent_status "InvoiceStatus";
BEGIN
  SELECT "status" INTO parent_status FROM "invoices"
  WHERE "id" = CASE WHEN TG_OP = 'DELETE' THEN OLD."invoice_id" ELSE NEW."invoice_id" END;
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'lines of an issued invoice are immutable' USING ERRCODE = 'check_violation';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "invoice_items_draft_only"
  BEFORE INSERT OR UPDATE OR DELETE ON "invoice_items"
  FOR EACH ROW EXECUTE FUNCTION "invoice_items_guard"();

-- Payments are history (FR-F03): append-only; a mistake is undone with a reversal row.
CREATE TRIGGER "payments_no_update_delete"
  BEFORE UPDATE OR DELETE ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "m8_append_only"();
