# FKAIOS Phase 1 Status — 2026-07-04 (updated)

## Verified live and working
- **9 departments** (Prompt 5), all 27 agents mapped, zero unmapped.
- **Autonomy levels 0-5** (Prompt 3) on every agent. All Accounts + Marketing agents locked at Level 4 (prepare + human approval only).
- **`approvals` table** — MD finance boundary enforced in schema.
- **`execution_log` table** — tokens, cost (INR), latency, status on every logged action.
- **Real Knowledge Vault (Prompt 7)**: pgvector `vector(384)`, Supabase's built-in `gte-small` embeddings (free), sentence-aware chunking, `match_knowledge_chunks()` RPC. Verified: 0.83 similarity on a real query.
- **`brain-chat` rebuilt (v47)**: was silently on Groq `llama-3.1-8b-instant` + keyword `ILIKE` "RAG". Now real `claude-sonnet-4-6` + real vector RAG. Verified end-to-end.
- **`heartbeat-engine` v10**: circuit breaker (stops retrying WhatsApp sends after 3 consecutive auth failures), full execution_log observability.
- **`agent-engine`, `business-engine`, `staff-engine` — real bug fixed**: all three created their Supabase client with only the anon key and never forwarded the caller's JWT. Every insert into RLS-protected tables (`brain_agent_executions`, `brain_business_ideas`, `brain_staff_reports` — all `TO authenticated`) was silently rejected by RLS, surfacing as a generic 500. Fixed by forwarding the Authorization header into the client's global headers. Deployed as v24 on all three.
- **`auto-pilot` v37 and `agent-scheduler` v27**: added an additive shared-secret auth path (same `HEARTBEAT_SECRET` pattern as `heartbeat-engine`/`vault-engine`) so pg_cron can call them without embedding the raw `service_role` key in a cron job body. Original service_role-JWT and admin-JWT auth paths untouched.

## Correction to yesterday's Phase 0 audit (owning this plainly)
Yesterday's audit called `orchestrator`, `orchestrator-engine`, and `auto-pilot` "3 duplicate orchestrator functions" based on their names, without reading the code. This was wrong. On inspection today:
- **`orchestrator`** — CRM/lead lifecycle event router (dispatches agents on lead events, advances pipeline stages, runs due `agent_schedules` batches).
- **`orchestrator-engine`** — a real, already-working **Software Factory pipeline** (Prompt 9): CEO AI decomposes a client request into specialist tasks → specialists execute via Claude personas → manager AI reviews/scores → rework loop → CPO AI merges final deliverable. This was not previously credited in the phase plan; it advances Phase 4 further than assessed.
- **`auto-pilot`** — deterministic (no AI, no `Math.random`) lead-scoring engine: scores new leads on investment size/city tier/source/contact completeness *before* any conversation, distinct from `heartbeat-engine`'s AI-based qualification which reads conversation history *after* contact.
- **`agent-scheduler`** — a generic dispatcher over a different table (`agent_schedules`: cron/interval/event-based) than `heartbeat-engine`'s hardcoded 3-task `scheduled_tasks` table, routing to 10 different specialist functions with retry/auto-deactivation logic.

None of these four are duplicates of each other or of `heartbeat-engine`. Acting on the wrong call, `auto-pilot-5min` and `agent-scheduler-5min` cron triggers were disabled for several hours today before the mistake was caught and both were restored (with the auth fix above, since the original cron definitions — which used a real `service_role` JWT the model does not have access to — were lost when the crons were unscheduled).

## Still duplicated / needs a real consolidation decision (not resolved yet)
- 2 WhatsApp inbound webhooks: `whatsapp-webhook`, `whatsapp-webhook-v2`.
- 2 WhatsApp outbound senders: `whatsapp-outbound`, `whatsapp-send`.
- 5+ knowledge-related functions: `knowledge`, `knowledge-engine`, `knowledge-search`, `document-engine`, `document-ingest` (plus new `vault-engine`, which should become canonical for embeddings/search).

## Removed (Prompt 1: no hardcoded fake data, no backdoors in production)
- `brain-chat`'s `"seed arofur"` fake-data re-injection trigger and `"diag"` debug backdoor.
- 15 fabricated seed documents in `brain_knowledge_documents` — archived (reversible), replaced with one real System Charter document.

## Blocked on external dependency
- WhatsApp permanent System User token: blocked on a new SIM (current WhatsApp Business Account is bound to Meta's fake Test number; the real "Franchisee Kart" WhatsApp Business Account has zero phone numbers attached yet).

## Repo sync note
This commit adds the 5 functions touched today (`brain-chat`, `heartbeat-engine`, `vault-engine` new, `agent-engine`, `business-engine`, `staff-engine`, `auto-pilot`, `agent-scheduler` fixes) plus the governance/vault migration. The live project has 55 deployed functions total; a full pull of the remaining unchanged functions into this repo is still pending as a separate sync.

## Master orchestrator built and verified (2026-07-04, later same day)
Built `orchestrator-brain` — the piece that was still missing: the actual Prompt 3+29 pipeline (understand → classify → retrieve vault → pick agent → plan → autonomy-gate → execute/file-approval → log). Everything else built in Phase 1 (departments, autonomy levels, vault, approvals, execution_log) converges here for the first time.

**v1 bug found and fixed via live testing, not assumption:** v1 forced any request classified into a Level-4 department (Accounts/Marketing) into `awaiting_approval`, even pure read-only questions — verified live by asking "what is the finance rule" and getting it wrongly blocked. Root cause: autonomy level was applied as a blanket override after the model had already made a correct judgment. v2 fix: trust the model's own `requires_approval` field (it's explicitly instructed on the real boundary — action vs. answer), and only hard-force approval when a real INR amount is proposed.

**v2 verified live, both cases correct:**
- "What is our finance boundary rule...?" → classified ACCOUNTS, `answered_only`, real grounded answer returned, no approval filed.
- "Send a payment link for Rs 50000..." → classified ACCOUNTS, risk `high`, `filed_for_approval`, ₹50,000 captured in the `approvals` table, nothing executed.

New table: `orchestrator_requests` (full request lifecycle log: classification, department, plan, risk, autonomy level required, action taken, tokens/cost).

## Real UI entry point built (2026-07-04, same day)
Discovered while looking for the frontend to extend: **13+ Vercel projects** exist, all named some variant of "fkaios" (fkaios, fkaios-live, fkaios-deploy, fkaios-original, fk-aios-aura-blueprint, fkaio-app, fk-aos-verified-build, and more) with no reliable signal for which is production. Rather than guess and risk deploying to the wrong one, built `orchestrator-ui` — a standalone page served directly by Supabase (same place everything else lives). Live now at:

https://nrlsqshkjuuwiovthrnb.supabase.co/functions/v1/orchestrator-ui

Verified live: HTTP 200, full page renders, calls `orchestrator-brain` directly. This is the first way to actually use the master orchestrator without writing SQL.

**Flagging for a real decision, not a technical one:** the 13+ Vercel projects should be audited and pruned to one canonical deployment before Phase 2. This is deferred, not resolved.

## "Knowledge duplication" investigated — turned out not to be duplication (2026-07-04)
Earlier flagged `knowledge`, `knowledge-engine`, `knowledge-search`, `document-engine`, `document-ingest` as possibly-duplicate. Read each instead of guessing:

- **`knowledge-search`** — DEAD CODE. Depends on a SQL function `semantic_search_knowledge()`, a table `knowledge_search_log`, and a `metrics` table. None exist in the database. Every call fails immediately.
- **`document-ingest`** — DEAD CODE. Depends on tables `knowledge_sources`, `knowledge_chunks`, `knowledge_embeddings` and a storage bucket `knowledge-docs`. None exist. Every call fails on step 1.
- **`knowledge-engine`** — REAL AND WORKING. Queries the real `brain_knowledge_documents` table with real Claude calls (keyword search → cited answer, or document summarization). Genuinely complementary to `vault-engine`, not competing: `vault-engine` does raw semantic chunk retrieval for RAG grounding; `knowledge-engine` does a conversational, cited answer for direct human use. Both worth keeping.
- **`knowledge`, `document-engine`** — not individually re-verified line by line, but strongly inferred dead (same abandoned "Knowledge OS / Phase 9" package as `knowledge-search`/`document-ingest`: same `_shared/metrics.ts` import, same non-`brain_`-prefixed schema that was never finished). Flagging as inferred, not confirmed.

**No functions were deleted** — I have no delete capability for Supabase edge functions in this toolset (a deliberate safety boundary). This section exists so no future session wastes time trying to "fix" or debug code that was never wired to real tables in the first place. If you want them physically removed, that's a manual step in the Supabase dashboard (Edge Functions → select → Delete).

**Conclusion: the canonical knowledge stack is `vault-engine` (semantic retrieval for RAG) + `knowledge-engine` (human-facing cited Q&A). Both real, both complementary, no consolidation needed.**

## WhatsApp sender duplication investigated — real security gap found, not just duplication (2026-07-04)
`whatsapp-send` and `whatsapp-outbound` both genuinely work, but are NOT interchangeable:

| | whatsapp-send | whatsapp-outbound |
|---|---|---|
| JWT verification | Real HMAC-SHA256 signature check (cryptographically verified) | Decodes payload only — does NOT verify the signature. A JWT with a fabricated payload but no valid signature would currently pass this check. |
| Access control | Admin/super_admin role required | Any authenticated user |
| Rate limiting | None | Yes — 10 messages/phone/hour via `agent_memory` |
| Message types | template, text, interactive (buttons) | template, text only |

**Not resolved yet — deliberately deferred, not forgotten.** The honest fix is merging capabilities (real signature verification + admin restriction from `whatsapp-send`, rate limiting from `whatsapp-outbound`) into one canonical sender before Phase 2's WhatsApp work goes live. Low urgency while WhatsApp itself is blocked on the SIM purchase, but must be done before either function handles real customer messages, since `whatsapp-outbound`'s unverified-signature gap is a real security issue once anyone else has a valid-looking (but not cryptographically real) token.
