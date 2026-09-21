-- Applied directly to production on 2026-08-29 (version 20260829142241) and
-- imported into the repo during the FKAIOS production-fix pass to close the
-- drift between deployed migration history and this repo.
--
-- Same class of deterministic/configuration failure as the 3 agents
-- contained in the prior migration, discovered as a follow-on finding:
-- Proposal AI (GENERATE_PROPOSAL) — rejected by ai-engine's
--   NO_PERSISTENCE_JOB_TYPES before any LLM call (zero cost, but
--   permanently unable to succeed as built).
-- Invoice AI (GENERATE_INVOICE) — calls the LLM (real cost) then fails in
--   writeInvoicePersistence() because its schedule payload has no lead_id,
--   identical root cause to Accounts Manager AI (Aura Tech).
-- Both use the same generic "workday_reporting" schedule template, which is
-- structurally wrong for a per-lead/per-deal job type. No unambiguous
-- correct schedule exists to reassign them to without a business decision,
-- so per the "genuine ambiguity -> pause" rule, both are paused rather than
-- having new business logic invented for them.
-- Reversible: set is_active back to true on these 2 schedule_ids.
UPDATE agent_schedules
SET is_active = false
WHERE id IN (
  '93f8a435-606d-4cb3-a427-abeede1d2def', -- Proposal AI
  'f3d7325a-faa4-4659-a06a-229734d878bc'  -- Invoice AI
);
