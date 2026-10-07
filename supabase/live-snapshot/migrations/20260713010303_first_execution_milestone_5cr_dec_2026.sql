-- Applied in production as version 20260713010303 (first_execution_milestone_5cr_dec_2026).
-- Exported read-only from supabase_migrations.schema_migrations on 2026-10-07 (md5 of statements: 369024e41b169c943352d7a9955d7f7c).
-- Record only: do not apply from this folder.

-- FIRST EXECUTION MILESTONE (Constitutional Realignment Directive, 2026-07-13):
-- "₹5 Crore Revenue by 31 December 2026."
--
-- This is a FOUNDER-STATED target, not one I invented. compute_mission_progress()
-- had reported: "The plan has NO intermediate milestones — every target sits in
-- the final year... this engine can report progress but cannot grade it." That
-- gap is now closed by the Founder supplying the first ramp point, so the mission
-- becomes GRADEABLE for the first time.
--
-- Recorded at HOLDING level (enterprise-wide revenue), year 2026. The engine is
-- being reworked in the same change so this does NOT break the double-count
-- reconciliation: that check is scoped to the FINAL year (2030) only. Without
-- that scoping, adding this row would have made holding-sum ₹11,005,000,000 vs
-- subsidiary-sum ₹11,000,000,001 and fired a FALSE "plan does not reconcile"
-- alarm — a self-inflicted false positive, the exact failure mode Silence
-- Monitor v3 had to undo.
INSERT INTO company_revenue_milestones
  (company_id, year, quarter, target_inr, actual_inr, status, owning_department, target_date, risk_notes, recommended_action)
SELECT c.id, 2026, 4, 50000000, 0, 'pending', 'EXECUTIVE', DATE '2026-12-31',
  'Founder-stated first execution milestone. Enterprise revenue to date: ₹0. Leads: 67, of which only 8 are contactable. There is no commercial channel currently capable of producing this number.',
  'Unblock contact data so leads can be reached. Without a reachable audience this milestone has no mechanism by which to be met.'
FROM companies c
WHERE c.company_type = 'holding'
  AND NOT EXISTS (
    SELECT 1 FROM company_revenue_milestones m
    WHERE m.company_id = c.id AND m.year = 2026 AND m.quarter = 4
  );
