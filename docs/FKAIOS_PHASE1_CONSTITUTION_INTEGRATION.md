# FKAIOS Phase 1 — Constitution Integration

FKAIOS already had a constitutional/governance foundation in Supabase. Phase 1 therefore extends that existing system instead of introducing a duplicate constitution table.

## Existing constitutional foundation
- founder_identity
- founder_principles
- engineering_constitution
- governed_decisions
- constitution_violations
- governance-engine
- governance-dashboard
- founder-brain / founder-brain-tick

## Phase 1 additions
The objective contract is now the enforcement boundary for downstream autonomous work.

Added to objective_contracts:
- risk_level
- constraints
- deliverables
- evidence_requirements
- founder_approval_required
- version

Added database completion gate:
- public.fkaios_objective_completion_allowed(uuid)

The gate requires a verified contract, explicit acceptance criteria, explicit evidence requirements, and blocks high/critical objectives requiring founder approval.

## Rule
Configured != Working != Verified != Completed.

An objective may not be treated as complete merely because tasks, jobs, UI state, or deployments exist. Completion requires evidence against the contract.
