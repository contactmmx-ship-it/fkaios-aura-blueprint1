# FKAIOS MASTER OPERATING MAP — Phase 0 Baseline
Date: 2026-10-06
Repository: contactmmx-ship-it/fkaios-aura-blueprint1
Default branch: main
Console route: /console

## Purpose
This is the frozen Phase 0 reality map. It separates what exists in code/database from what has been proven end-to-end. No item is considered autonomous merely because it is configured, marked ACTIVE, or has historical rows.

## 1. Current Console information architecture
The current AppShell uses FIVE DOORS, not the previously described 23-page structure. The actual current sidebar contains 29 selectable pages.

### TODAY
1. Give an Objective — objective-command
2. Founder Cockpit — founder-cockpit
3. Founder Brain Brief — founder-brain-brief
4. Command Center (Governance) — governance
5. Founder Avatar — founder-avatar

### BUSINESS
6. Revenue Desk — revenue-desk
7. Leads & Pipeline — leads-crm
8. Decision Center — decision-center
9. Executive Council — executive-council
10. Approvals (Invoices) — approvals
11. Operations Dashboard — dashboard
12. Companies — companies

### WORKFORCE
13. Agent Workday — agent-workday
14. Agent Factory — agent-factory
15. Chief of Staff — chief-of-staff
16. AI Company — ai-company

### INTELLIGENCE
17. My Brain — my-brain
18. AI Brain Chat — brain-chat
19. Knowledge Vault — knowledge-vault
20. Research — research
21. Decision Engine — decision-engine
22. Self-Learning — self-learning

### BUILD
23. Builder AI — builder-ai
24. Business Creator — business-creator
25. Product Video Gen — product-video
26. Project Review — project-review
27. AURA Blueprint — aura-blueprint
28. Voice AI — voice-ai
29. Settings — settings

## 2. Console implementation truth
- /console is mounted to AppShell.
- AppShell contains the five-door navigation and 29 page entries.
- Every current sidebar entry maps to a concrete React component in the current code path.
- The old PlaceholderPage and pageDescriptions remain in AppShell as legacy code, but current NAV_DOORS entries do not route through PlaceholderPage.
- UI existence is therefore CONFIRMED for all 29 current entries.
- This does NOT prove every page is backend-connected or operational.

## 3. Runtime/data reality observed in Supabase
Project: nrlsqshkjuuwiovthrnb

Core counts:
- ai_agents: 41
- ai_jobs: 19,300
- ai_outcomes: 6,051
- agent_activity_log: 6,179
- agent_dispatch_log: 12,707
- agent_runs: 0
- agent_schedules: 41
- agent_performance_metrics: 16,159
- orchestration_projects: 248
- orchestration_tasks: 900
- orchestration_milestones: 265
- orchestration_task_allocations: 52
- orchestration_activity_events: 1,361
- orchestrator_requests: 201
- research_runs: 235
- approvals: 459
- execution_log: 10,546
- founder_notifications: 865
- agent_workday: 839
- worker_runs: 19
- worker_handoffs: 20
- work_packages: 56
- objective_contracts: 5
- objective_solution_options: 52
- fkaios_acceptance_matrix: 55
- fkaios_controller_state: 1
- capability_registry: 36
- capability_backlog: 31

Critical interpretation:
41 agents are configured in ai_agents, but agent_runs currently has ZERO rows. Historical dispatch/activity records prove that agent-related activity is being recorded; they do not prove that all 41 agents are independently executing real work end-to-end.

## 4. Edge-function reality
The production Supabase project currently has a large ACTIVE function fleet, including:
ai-engine, founder-brain-tick, founder-objective, orchestrator, agent-engine, job-scheduler, agent-scheduler, auto-pilot, research/market intelligence functions, knowledge functions, governance-dashboard, executive intelligence/brain functions, factory-intake, factory-planner, and supporting CRM/WhatsApp/payment/document functions.

ACTIVE is a deployment state, not an end-to-end acceptance state. Each critical function still needs capability-level and objective-level verification.

## 5. Current capability bottlenecks
Known capability-registry evidence:
- ai-engine: available but workers are restricted to knowledge.search and research.status.
- research-engine: available/paid-active but its authentication configuration needs security hardening and it is not yet a universal worker capability.
- candidate:playwright-mcp: not connected to the FKAIOS worker/edge runtime.
- knowledge-search: dead/superseded path; vault-engine is the newer path.
- fkaios-llm:anthropic: paid_exhausted/unavailable.
- fkaios-llm:gemini: quota_limited/degraded.
- fkaios-llm:openai: unavailable because Edge Function OPENAI_API_KEY is not configured.
- Gmail/Google Calendar/Google Drive connectors: unavailable because required auth/scopes are missing.
- Canva and Figma: configured/available, but Canva has no brand kits configured.
- Netlify: configured, availability not yet proven as an FKAIOS worker capability.
- Vercel/Render: configured/available at connector level; objective-level execution still requires proof.

## 6. Security baseline
Supabase advisory reports two public tables with RLS disabled:
- public.agent_aliases
- public.model_registry

Do NOT enable RLS blindly: policies must be designed first or client access can break. This is a Phase 0 security blocker to be resolved under Governance & Security, not silently ignored.

## 7. Phase 0 status
DONE:
- Repository and production Supabase project identified.
- Console mount identified.
- Current five-door navigation identified.
- Actual current page count corrected to 29.
- Agent/capability/orchestration/database reality captured.
- Deployment state separated from operational proof.
- Major provider/capability blockers captured.
- Security advisory captured.

NOT DONE:
- Every one of the 29 pages has not yet been independently verified against its backend data/actions.
- Every one of the 41 agents has not been individually execution-tested.
- Every capability has not been health-tested through a real worker.
- Quality/rework/completion gates are not yet universally enforced.
- Full autonomous one-line objective acceptance test is not yet passed.

## 8. Rule from this baseline onward
FKAIOS may only report a capability, agent, page, objective, or workflow as WORKING when the required chain is proven:
UI/action -> backend -> capability -> worker/agent -> real output -> verification -> evidence -> persisted state.

Configuration, ACTIVE status, historical rows, HTTP 200, or a generated-looking response alone are insufficient.

## 9. Build sequence
Phase 0 -> Constitution -> Founder Brain -> Objective Engine -> Discovery/Research -> Planner -> Capability Engine -> Agent OS -> Orchestration -> Execution -> Verification -> Quality Intelligence -> Autonomous Rework -> Evidence/Completion -> Memory/Learning -> Decision Center -> Governance/Security -> Automation -> Command Center -> Navigation closure -> Acceptance tests -> Failure tests -> Autonomous E2E -> 100/100 acceptance.
