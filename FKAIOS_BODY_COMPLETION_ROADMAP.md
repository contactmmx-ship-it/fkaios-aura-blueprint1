# FKAIOS Body Completion Roadmap

**Date:** 2026-07-27
**Companion documents:** `FKAIOS_ORGANISM_AUDIT_REPORT.md`, `FKAIOS_CAPABILITY_REALITY_REPORT.md`
**Rule applied throughout:** no isolated features, no UI without working capability behind it, no fabricated completion states, every item states how it makes FKAIOS sense, think, act, or learn.

---

## LEVEL 1 — Make FKAIOS alive

*Must have: memory, observation, communication, action capability, learning loop.*

| Priority | Item | Organ(s) | Status after this session | What it takes |
|---|---|---|---|---|
| **1** | **Learning loop: capture every job's outcome** | Digestive 🍽️, Brain 🧠 | ✅ **Implemented this session** — see below | `ai_outcomes` write on every `ai-engine` job completion/failure. Uses the existing, empty, correctly-shaped table. No new table, no new schedule, no new cost. |
| 2 | Activate the Eyes: schedule `market-intelligence` | Eyes 👁️, Heart ❤️ | 🟠 Prepared, **not applied** — needs founder approval | Fully real, fully built, simply never on a cron. **Deliberately not auto-scheduled** — the codebase's own precedent (`20260717000000_schedule_founder_brain_tick_cron.sql`) explicitly reserves turning on new recurring LLM-calling jobs for founder approval, not silent activation. Migration prepared below for review. |
| 3 | Give the Hands real tools | Hands 🖐️ | 🔴 Not started — largest Level-1 gap remaining | `ai_agents.tools` (jsonb) already exists in schema but is read only for UI display. `ai-engine`'s `executeJob()` needs real tool-calling (Anthropic tool-use, mirroring the pattern already proven in `market-intelligence`/`governance-engine`) so a subset of agents can take one real, scoped action (e.g. update a lead's stage) instead of only producing text. Sequencing note: do this *after* item 1 has run long enough to show which job types most need real hands, so the first tool given is evidence-driven, not guessed. |
| 4 | Confirm/activate one real communication channel | Ears 👂, Mouth 🗣️ | 🟠 Dormant — external, not code | WhatsApp webhook + outbound code are both real and complete. Activation is a Meta Business Platform configuration step (webhook registration, number verification) outside this codebase — flagged, not attempted here. |
| 5 | Compound Brain memory volume | Brain 🧠 | 🟡 Ongoing | Knowledge base (2 chunks) and executive-cycle history (21 rows) grow only through continued real operation — not a one-time build. Item 1 directly feeds this (outcomes become memory). |

---

## LEVEL 2 — Make FKAIOS useful

*Must perform: website creation, CRM creation, marketing automation, sales automation, reporting.*

Gated on Level 1 items 2–3 landing first — none of these should be attempted while the Hands are still empty, or "automation" means the same silent LLM-opinion pattern Phase 0.1 just spent an entire pass removing from three job types.

| Item | Organ(s) | Depends on |
|---|---|---|
| Sales automation: close the Lead → Meeting → Proposal → Invoice → Payment loop for real | Hands, Digestive | Level 1 #3 (real tools), and a deliberate rebuild of `GENERATE_INVOICE`/`GENERATE_PROPOSAL`/`SCHEDULE_MEETING` as real persistence (not the honest-failure state Phase 0.1 left them in) |
| Marketing automation: turn Eyes signals into real campaigns | Eyes, Hands | Level 1 #2 (Eyes active) + #3 (Hands) |
| Reporting: connect `governance_kpis`/`ceo_daily_briefing` to real revenue | Heart | `company_revenue_actuals` populated (depends on the sales loop above actually closing once) |
| Website/SaaS/landing-page/CRM generation | Hands (software factory) | Independent track — the existing `build_projects`/`factory_tasks` activity should be audited on its own before claiming this capability; out of scope for this pass |

---

## LEVEL 3 — Make FKAIOS autonomous

*Must: plan, execute, improve, manage business functions.*

Only meaningful once Level 2's loops have closed at least once for real, and only once `ai_evolution` has real rows (agents provably improving from `ai_outcomes`, not just accumulating them). Attempting Level 3 (broader autonomy, less human-in-the-loop) before the Digestive System has actually taught the workforce anything would mean scaling up a workforce that has never been shown to get better — the opposite of the founder's own "newborn learns before it acts alone" framing.

---

## What was implemented in this session

**Digestive System — first bite.** `ai-engine`'s `runJobs()` now writes a real `ai_outcomes` row on every job completion *and* every failure — not just successes, since a failure is exactly the kind of experience the digestive system exists to process. Each row carries `job_id`, `agent_id`, `outcome_type` (`completed`/`failed`/`retry`), the real `result`/`error`, and a short plain-language `outcome` summary. This is deliberately the *first* organ, not the whole system: it captures experience. It does not yet analyze it, score it, or feed it back into a prompt — that's `ai_evolution`'s job, and building that honestly requires enough real `ai_outcomes` rows to reason from, which don't exist until this ships. Implementation detail, verification, and live evidence are in the code change and the deploy log for this session.

**Deliberately not implemented this session, and why:**
- Scheduling `market-intelligence` — real capability, but turning on a new recurring LLM-calling cron is a standing decision this project's own history reserves for founder approval (see the note in `20260717000000_schedule_founder_brain_tick_cron.sql`). A ready-to-review migration is included below.
- Real tool-calling for the general agent workforce (Level 1 #3) — the single largest remaining gap, but it's a genuine design decision (which agents, which tools, what scope of real-world write access) that deserves its own dedicated pass with founder sign-off, not a rushed addition alongside three other changes.

### Prepared, not applied: `market-intelligence` cron

```sql
-- NOT APPLIED. For founder review — see Level 1 item 2 above for rationale.
SELECT cron.unschedule(jobname) FROM cron.job WHERE jobname = 'fkaios-market-intelligence-daily';

SELECT cron.schedule(
  'fkaios-market-intelligence-daily',
  '0 5 * * *', -- once daily, staggered after the other 04:xx-05:xx daily cells
  $$
  SELECT net.http_post(
    url := 'https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/market-intelligence?secret=REPLACE_WITH_MARKET_INTEL_SECRET',
    headers := jsonb_build_object('Content-Type', 'application/json'),
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
```
