-- List and search indexes (backend audit, batch 4). Additive only: no row or column changes, and
-- each index can be dropped on its own. Measured on 150k contacts / 50k deals in one agency with
-- the SQL the services send (apps/api/bench/search-ab.bench.ts).
--
-- At pilot volume each CREATE INDEX takes about a second and blocks writes to its table for that
-- long. On a much larger database, run them with CREATE INDEX CONCURRENTLY instead (outside a
-- transaction, one per migration).

-- Deals list: ORDER BY updated_at DESC, id DESC over live deals of one agency. Before, every page
-- was a sequential scan plus a sort (60 ms per page); with this index 0.1-2 ms.
CREATE INDEX "deals_agency_id_updated_at_id_live_idx"
  ON "deals" ("agency_id", "updated_at" DESC, "id" DESC)
  WHERE "archived_at" IS NULL;

-- Contact search: `contains` becomes ILIKE '%term%' on name, company and email, and LIKE on the
-- phone when the term has 3+ digits. Only trigram indexes serve that, and only if every arm of the
-- OR has one; a missing phone index alone sends the whole search back to a sequential scan.
-- Narrow terms: 150-200 ms -> under 1 ms. Very broad terms still scan, which the planner chooses
-- correctly. pg_trgm ships with PostgreSQL and is a trusted extension (PostgreSQL 13+), so the
-- database owner may create it; Render lists it as supported. If the server lacks it, the search
-- indexes are skipped with a warning and search keeps working, only slower.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_trgm') THEN
    RAISE WARNING 'pg_trgm is not available on this server: contact search stays unindexed';
    RETURN;
  END IF;
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE INDEX "contacts_full_name_trgm_idx" ON "contacts" USING gin ("full_name" gin_trgm_ops);
  CREATE INDEX "contacts_company_name_trgm_idx" ON "contacts" USING gin ("company_name" gin_trgm_ops);
  CREATE INDEX "contacts_email_norm_trgm_idx" ON "contacts" USING gin ("email_norm" gin_trgm_ops);
  CREATE INDEX "contacts_phone_norm_trgm_idx" ON "contacts" USING gin ("phone_norm" gin_trgm_ops);
EXCEPTION
  WHEN insufficient_privilege THEN
    RAISE WARNING 'not allowed to create pg_trgm here: contact search stays unindexed';
END $$;
