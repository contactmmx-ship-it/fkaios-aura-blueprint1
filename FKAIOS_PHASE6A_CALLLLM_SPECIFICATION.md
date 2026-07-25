# FKAIOS `callLLM()` Provider Abstraction — Design Specification

**Date:** 2026-07-24
**Status:** Design/specification document only. No code created, no files added inside `supabase/functions`, no existing function modified, nothing deployed, no migrations created, no secrets touched, no cron jobs activated.
**Scope:** This is Phase 6A, Step 1 of `FKAIOS_PHASE6A_EXECUTION_CHECKLIST.md` — "Design shared `callLLM()` abstraction specification... No production integration." It defines *what* the abstraction must do; Step 2 (build + isolated unit test) and the migration steps that follow are separate, later, and each require their own verification before proceeding.

---

## 1. `callLLM()` Purpose

### Why this abstraction exists

Verification Sweep 0 (documented in `FKAIOS_PHASE6A_IMPLEMENTATION_PLAN.md`, Section 1B) found the same multi-provider fallback logic — Anthropic → Gemini → OpenAI/GLM/DeepSeek — independently copy-pasted across **10 separate functions** (`brain-engine`, `brain-chat`, `sales-engine`, `learning-engine`, `business-engine`, `builder-engine`, `agent-engine`, `orchestrator-engine`, `orchestrator-brain`, `training-engine`). Meanwhile, **9 other functions have zero fallback of any kind**, and **2 functions (`ai-engine`, `founder-executive`) have a fallback that is written but never executes** due to a shared code defect. One provider having a billing problem — which is happening live in production right now — therefore breaks different functions in different ways depending on which copy of the logic they happen to have, rather than being handled once, consistently, everywhere.

### Current fallback problems discovered (evidence, not assumption)

- `ai-engine` and `founder-executive`: OpenAI fallback exists in code, but the catch block re-throws immediately whenever the error message is prefixed `"Anthropic API error"` — exactly the shape of the live credit-exhaustion failure — so the fallback code is present but unreachable.
- `lead-discovery`, `evolution-engine`, `opportunity-engine`, `auto-agents-engine`: no fallback at all; confirmed 400/502 failures live today.
- `orchestrator-engine`: has a 5-tier chain on paper, but it is itself degraded — the GLM tier's secret is unreadable and DeepSeek has its own insufficient-balance issue — a "working" fallback chain that quietly stopped working, with nothing to detect it.
- 9 further functions (`closer-engine`, `mis-engine`, `market-intelligence`, `governance-engine`, `avatar-orchestrator`, `knowledge-engine`, `project-review-engine`, `heartbeat-engine`, `whatsapp-webhook-v2`) have zero fallback and are latent risks the moment they're invoked with real work.
- No consistent logging shape exists across any of the above — which is the same root cause that let the `executive-intelligence` cron's 401 run undetected for over a day: a "succeeded" status at one layer (cron dispatch) concealed a failure at another (function auth).

### How this supports FKAIOS principles

- **Truth Before Beauty** — the abstraction's logging must always reflect what actually happened (which provider, real success or failure), never a polished "it worked" that conceals which layer actually succeeded.
- **Evidence Over Claims** — a call is only "successful" if a real, well-formed provider response was received and logged as such; this directly targets the exact gap already found between `cron.job_run_details.status = 'succeeded'` and the real `net._http_response` status code.
- **Preserve → Enhance → Extend** — `callLLM()` is additive routing infrastructure. It transports a request; it does not rewrite the prompt, tool schema, or business logic already tuned into each calling function.
- **No Fake Intelligence** — if every configured provider fails, the caller receives an honest error. The abstraction must never fabricate a plausible-looking answer or silently pass through an empty/garbled response as if it were valid output.

---

## 2. Provider Strategy (Option C — Hybrid Multi-Provider Architecture)

Per the Founder Decision Record's approved AI provider strategy.

- **Primary provider selection:** Configurable, not hardcoded per function. Today's de facto default (Anthropic-first, in almost every function that has any fallback at all) is a historical accident of build order, not a deliberate choice — every function picked it independently. The abstraction reads a single configured priority order at call time rather than each function defining its own.
- **Secondary provider fallback:** On a qualifying failure (Section 3), the abstraction automatically tries the next provider in the configured order. Today's inconsistency — some functions are 2-tier, some 3-tier, some 5-tier, each defined separately — is replaced by one canonical ordered list used by every migrated function, with the option for a function to specify a narrower subset if it has a genuine reason to (e.g. a provider whose API shape it can't use).
- **Provider ordering rules:** The order lives in configuration (an env var, project secret, or small config table — a genuine open decision, see Section 7), not in each function's source code. Changing the order — e.g. demoting Anthropic after a repeated billing incident — becomes a config change, not a redeploy of every affected function.
- **Cost-aware routing:** Before a call, check a configurable spend ceiling for the provider about to be used, reusing the existing `agent_performance_metrics.estimated_cost_usd` tracking already read by `getTokenEconomyReport()`. If a provider's accumulated cost for the current period exceeds its ceiling, treat it as unavailable and route to the next provider — even if it hasn't technically errored yet.
- **Failure-aware routing:** Only certain failure types should trigger failover; others should not (Section 3 defines exactly which).

---

## 3. Failure Detection Logic

| Failure type | Detection | Response |
|---|---|---|
| **Credit exhaustion** | Message/error-code pattern match (e.g. "credit balance too low", `insufficient_quota`), regardless of the HTTP status code the provider wraps it in | Classify as **PROVIDER_UNAVAILABLE**, trigger failover immediately, tag distinctly from transient errors — this failure type will not self-resolve on retry |
| **Rate limits** | HTTP 429 | Classify as **PROVIDER_TEMPORARILY_UNAVAILABLE**, fail over to the next provider immediately rather than retrying the same one — business logic generally cannot afford to wait out a rate-limit window |
| **Timeout** | No response within a configured deadline | Classify as **PROVIDER_UNAVAILABLE**, fail over; the abstraction's own timeout must fire before any caller-level timeout, so the caller never hangs indefinitely |
| **Invalid request** | 4xx **not** related to quota/auth (malformed prompt, schema violation) | **Do not fail over.** Retrying an identical malformed request against a different provider wastes cost and fails identically. Return the real error to the caller immediately with full diagnostic detail so the actual defect gets fixed. |
| **Provider outage** | 5xx, connection failure, DNS failure | Classify as **PROVIDER_UNAVAILABLE**, fail over |
| **Authentication failure** | 401/403 from the provider itself (our own key rejected) | Fail over **and** log a distinct `authentication_failure` alert. This must not be silently absorbed the way a routine failover would be — a bad key left undetected means that provider is permanently and invisibly skipped until someone notices, which defeats the purpose of the whole abstraction. Feeds the Founder-notification path already defined in the Implementation Plan's Reliability Framework. |
| **Empty or invalid AI response** | HTTP 200, but empty/malformed content or a response that doesn't match the expected tool-call/schema shape | **Never treated as success just because the transport succeeded.** This is the literal "No Fake Intelligence" case — classify as a failure, either retry on the same/next provider or surface an honest error; never pass a garbled 200 through to the caller as valid business output. |

---

## 4. Logging Design

Every `callLLM()` invocation records, in one consistent shape across every migrated function:

- `function_name` — which engine made the call
- `agent_name` / caller identity — where applicable (some calls are made on behalf of a specific `brain_agents` entry)
- `requested_provider` — what was configured as primary at call time
- `attempted_providers` — the ordered list of every provider actually tried during this call
- `failure_reason` — per failed attempt, using the categories from Section 3 (not a raw error dump alone)
- `successful_provider` — which provider, if any, ultimately produced the result
- `latency_ms` — per attempt, plus total wall-clock time for the whole call
- `token/cost information` — input/output tokens and estimated cost, reusing the existing `estimated_cost_usd` shape already present in `agent_performance_metrics`
- `final_result_status` — a semantic outcome (`success` / `failed_all_providers` / `invalid_response_received`), never just the raw HTTP status of the last attempt

This directly answers the Reliability Framework question already raised in the Implementation Plan — "how does FKAIOS know an AI employee is unavailable" — by giving every engine's provider health a single, consistent, queryable shape instead of the current situation where each function logs (or doesn't log) this differently, if at all.

---

## 5. Safety Rules

- **The abstraction routes only — it does not change prompts.** `callLLM()`'s interface treats the fully-formed request (system prompt, user content, tool/function-calling schema, temperature, token limits) as an opaque payload. It selects which provider transports that payload; it does not edit, improve, or "help" with what's inside it.
- **Existing function intelligence must remain unchanged.** Migrating a function onto `callLLM()` means replacing its own duplicated provider-calling code with a call to the shared module — not touching the prompt engineering, business logic, or decision-making already tuned into that function. This is Preserve → Enhance → Extend applied literally: enhance the transport layer, preserve everything built on top of it.
- **No hidden fallback failures.** If the primary provider fails and a fallback succeeds, that fact must be visible in the logging (Section 4) — a Founder or engineer must be able to tell, after the fact, that failover occurred at all, even if the calling function's own output looked fine.
- **No silent empty success responses.** Covered concretely in Section 3's "empty or invalid AI response" row — a technically-200 response with unusable content must never be passed upstream disguised as a real result.

---

## 6. Testing Plan

Per Step 2 of `FKAIOS_PHASE6A_EXECUTION_CHECKLIST.md`: all five tests below run against the standalone abstraction module **in isolation** — no production function connected during this testing.

1. **Anthropic credit failure** — simulate the exact "credit balance too low" response shape observed live in production today. Confirm the abstraction classifies it as `PROVIDER_UNAVAILABLE` (not invalid-request), fails over, and logs the distinct failure reason.
2. **Rate limit** — simulate a 429. Confirm immediate failover to the next provider, with no same-provider retry loop that would compound latency.
3. **Timeout** — simulate a hung/non-responding provider. Confirm the abstraction's own timeout fires before any caller-level timeout would, and that it fails over rather than hanging.
4. **Malformed request** — simulate a 4xx unrelated to quota or auth. Confirm the abstraction does **not** fail over, and instead surfaces the real error immediately — proving it doesn't waste cost repeating the same bug against every configured provider.
5. **Successful fallback execution** — deliberately disable/deprioritize the primary provider in test configuration and confirm a real, usable result is produced by the next provider in line, with the full call correctly logged end to end (requested vs. attempted vs. successful providers, latency, cost).

---

## 7. Open Decisions (require Founder approval before implementation)

These are not decided in this specification — they are flagged explicitly for Founder review, consistent with treating provider strategy, cost, and retry behavior as deliberate choices rather than inherited defaults:

- **Provider order:** what the default priority sequence should be. Today's de facto order (Anthropic-first almost everywhere) was never a deliberate choice — should it remain the default, or should OpenAI become primary given it is the one provider already proven stable in production (`executive-intelligence`)?
- **Cost thresholds:** what daily/period spend ceiling applies per provider, and what happens when one is hit — a hard stop (treat as unavailable) or a soft warning that still allows the call through?
- **Logging storage choice:** whether the call-log data (Section 4) extends the existing `agent_performance_metrics` table's shape, or becomes a new dedicated table/view. This is a real schema decision with Phase 6C implications — any new table needs its own row-level-security posture designed in from the start, not retrofitted later, given everything already found in `FKAIOS_SECURITY_HARDENING_PLAN.md`.
- **Retry limits:** the maximum number of providers to attempt per call, bounding worst-case latency and cost. A full 5-tier chain retried in sequence on every failure could add significant latency before a call ultimately fails — what ceiling is acceptable for FKAIOS's actual use cases (cron-triggered background work vs. interactive Founder-facing chat may reasonably need different limits)?

---

## Confirmation

Document created. No code was changed. No files were created inside `supabase/functions`. No existing function was modified. No deployment was performed. No migrations were created. No secrets were touched. No cron jobs were activated.

**Waiting for Founder Approval before implementation.**
