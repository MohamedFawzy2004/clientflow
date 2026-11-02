-- Payment rules in the database (backend audit, batch 5, F11). recordPayment and reversePayment
-- already keep these rules under the invoice lock; the database now refuses any write that
-- breaks them, whatever sends it. No row is changed.

-- 1. A payment is in its invoice's currency. A reversal undoes exactly one PAYMENT of the same
--    invoice, for the same amount and currency (the unique reverses_id keeps it to one).
CREATE OR REPLACE FUNCTION "payments_match_invoice"() RETURNS trigger AS $$
DECLARE
  inv_currency char(3);
  orig record;
BEGIN
  SELECT "currency" INTO inv_currency FROM "invoices" WHERE "id" = NEW."invoice_id";
  IF inv_currency IS DISTINCT FROM NEW."currency" THEN
    RAISE EXCEPTION 'payment currency % does not match invoice currency %', NEW."currency", inv_currency
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."kind" = 'REVERSAL' THEN
    SELECT "invoice_id", "kind", "amount_minor", "currency" INTO orig
      FROM "payments" WHERE "id" = NEW."reverses_id";
    IF orig IS NULL OR orig."kind" <> 'PAYMENT' OR orig."invoice_id" <> NEW."invoice_id"
       OR orig."amount_minor" <> NEW."amount_minor" OR orig."currency" <> NEW."currency" THEN
      RAISE EXCEPTION 'a reversal must undo one payment of the same invoice, amount and currency'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "payments_match_invoice"
  BEFORE INSERT ON "payments"
  FOR EACH ROW EXECUTE FUNCTION "payments_match_invoice"();

-- 2. An invoice's paid amount is its payments minus its reversals. Checked when the transaction
--    commits (DEFERRABLE INITIALLY DEFERRED), so the service may write the payment and the new
--    total in either order.
CREATE OR REPLACE FUNCTION "invoices_paid_matches_payments"() RETURNS trigger AS $$
DECLARE
  inv_id uuid;
  paid bigint;
  received bigint;
BEGIN
  -- Separate statements: PL/pgSQL resolves NEW's fields only for the branch it runs.
  IF TG_TABLE_NAME = 'payments' THEN
    inv_id := NEW."invoice_id";
  ELSE
    inv_id := NEW."id";
  END IF;
  SELECT "paid_minor" INTO paid FROM "invoices" WHERE "id" = inv_id;
  SELECT COALESCE(SUM(CASE WHEN "kind" = 'PAYMENT' THEN "amount_minor" ELSE -"amount_minor" END), 0)
    INTO received FROM "payments" WHERE "invoice_id" = inv_id;
  IF paid IS DISTINCT FROM received THEN
    RAISE EXCEPTION 'invoice % records % paid, but its payments add up to %', inv_id, paid, received
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER "payments_keep_invoice_paid"
  AFTER INSERT ON "payments"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "invoices_paid_matches_payments"();

CREATE CONSTRAINT TRIGGER "invoices_paid_from_payments"
  AFTER INSERT OR UPDATE OF "paid_minor" ON "invoices"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION "invoices_paid_matches_payments"();

-- 3. Existing data must already follow the rules. If an old row breaks one, the migration stops
--    here and changes nothing (the whole migration is one transaction): fix the data first.
DO $$
DECLARE
  bad bigint;
BEGIN
  SELECT count(*) INTO bad FROM "payments" p JOIN "invoices" i ON i."id" = p."invoice_id"
    WHERE p."currency" <> i."currency";
  IF bad > 0 THEN
    RAISE EXCEPTION '% payments are not in their invoice currency', bad;
  END IF;
  SELECT count(*) INTO bad FROM "payments" r JOIN "payments" o ON o."id" = r."reverses_id"
    WHERE r."kind" = 'REVERSAL' AND (o."kind" <> 'PAYMENT' OR o."invoice_id" <> r."invoice_id"
      OR o."amount_minor" <> r."amount_minor" OR o."currency" <> r."currency");
  IF bad > 0 THEN
    RAISE EXCEPTION '% reversals do not match the payment they undo', bad;
  END IF;
  SELECT count(*) INTO bad FROM "invoices" i
    WHERE i."paid_minor" <> COALESCE((
      SELECT SUM(CASE WHEN p."kind" = 'PAYMENT' THEN p."amount_minor" ELSE -p."amount_minor" END)
      FROM "payments" p WHERE p."invoice_id" = i."id"), 0);
  IF bad > 0 THEN
    RAISE EXCEPTION '% invoices record a paid amount that differs from their payments', bad;
  END IF;
END $$;
