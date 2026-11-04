-- Database backstops for deal outcomes (backend audit, batch 1). Additive only: no row is changed.

-- A deal has at most one accepted proposal. Client acceptance locks the deal row first; this index
-- catches anything that does not. An accepted proposal never changes status again (it cannot be
-- revised, and proposal_versions_guard keeps its version ACCEPTED).
CREATE UNIQUE INDEX "proposals_one_accepted_per_deal" ON "proposals" ("deal_id") WHERE "status" = 'ACCEPTED';

-- A won deal rests on a client-accepted proposal or a manager's documented override (spec §9).
-- Added NOT VALID, then validated: existing rows are checked without holding a long write lock,
-- and the migration stops here, changing nothing, if an old row breaks the rule.
ALTER TABLE "deals" ADD CONSTRAINT "deals_won_has_basis" CHECK (
  "status" <> 'WON' OR "accepted_proposal_version_id" IS NOT NULL OR "won_override_reason" IS NOT NULL
) NOT VALID;
ALTER TABLE "deals" VALIDATE CONSTRAINT "deals_won_has_basis";
