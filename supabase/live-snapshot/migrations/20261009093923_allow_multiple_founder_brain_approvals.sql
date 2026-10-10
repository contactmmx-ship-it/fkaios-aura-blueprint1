-- Applied in production as version 20261009093923 (allow_multiple_founder_brain_approvals).
-- Record-only snapshot to reconcile the live Supabase migration ledger with the repo.
-- The original repository migration is supabase/migrations/20261009091500_allow_multiple_founder_brain_approvals.sql.
-- Its SQL was recovered from commit 6094d1825422dc5ec60f3df941530673f8978da8.
-- Live ledger uses a later version timestamp for the same migration name.
-- Record only: do not apply from this folder.

-- Allow independent Founder Brain objectives to enter awaiting_approval concurrently.
--
-- The previous partial unique index enforced a single awaiting_approval row for
-- the entire founder-brain queue. A stale approval therefore caused unrelated
-- objectives to fail when they legitimately needed to surface a blocker. In
-- production this made the objective loop retry every minute with:
--   duplicate key value violates unique constraint
--   "orchestrator_one_awaiting_founder_brain"
--
-- Each request already has its own UUID. The Decision Center should present
-- multiple pending decisions, not let one unresolved item block all others.
DROP INDEX IF EXISTS public.orchestrator_one_awaiting_founder_brain;
