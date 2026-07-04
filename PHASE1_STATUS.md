# FKAIOS Phase 1 Status — 2026-07-04

## Verified live and working
- **9 departments** created (Prompt 5), all 27 agents mapped, zero unmapped.
- **Autonomy levels 0-5** live on every agent (Prompt 3). All Accounts + Marketing agents locked at Level 4 (prepare + human approval only — never execute money movement or ad spend).
- **`approvals` table** — MD finance boundary enforced in schema, not just policy.
- **`execution_log` table** — every agent action logs tokens, cost (INR), latency, status.
- **Cron consolidated**: 3 duplicate autonomy loops (`auto-pilot-5min`, `agent-scheduler-5min`, `aeos-heartbeat`) reduced to 1 (`aeos-heartbeat` only). The two duplicate functions remain deployed but untriggered (non-destructive retirement).
- **Real Knowledge Vault (Prompt 7)**: pgvector `vector(384)` embeddings via Supabase's built-in `gte-small` model (free, no external API cost), sentence-aware chunking, `match_knowledge_chunks()` semantic search RPC. Verified live: 0.83 similarity match on a real query.
- **`brain-chat` rebuilt (v47)**: was silently running on Groq `llama-3.1-8b-instant` with keyword `ILIKE` "RAG" instead of Claude. Now uses real `claude-sonnet-4-6` + real vector RAG. Verified end-to-end with a real request/response pair logged in `execution_log`.
- **Circuit breaker** added to `heartbeat-engine`: after 3 consecutive WhatsApp auth failures for the same message, stops retrying (was burning a Claude call every 30 min drafting replies that could never send, due to the WhatsApp token being a temporary "Try it out" token against a Test WhatsApp Business Account, not a permanent System User token against the real number).

## Removed (Prompt 1: no hardcoded fake data, no backdoors in production)
- `brain-chat`'s `"seed arofur"` message trigger — re-inserted 5 fabricated fake-brand research documents into the Knowledge Vault on demand. Removed entirely.
- `brain-chat`'s `"diag"` debug backdoor.
- 15 pre-existing fabricated seed documents in `brain_knowledge_documents` (fake "Arofur" brand, fake franchise agreement/SOP templates with no real content) — archived, not deleted (reversible), replaced with one real System Charter document.

## Known duplication not yet resolved (flagged, not yet consolidated)
- 3 orchestrator functions: `orchestrator`, `orchestrator-engine`, `auto-pilot` — need one canonical winner.
- 2 WhatsApp inbound webhooks: `whatsapp-webhook`, `whatsapp-webhook-v2`.
- 2 WhatsApp outbound senders: `whatsapp-outbound`, `whatsapp-send`.
- 5 knowledge-related functions: `knowledge`, `knowledge-engine`, `knowledge-search`, `document-engine`, `document-ingest` (plus new `vault-engine`, which should become canonical).

## Broken, found during this session (not caused by Phase 1 changes — flagged for next audit)
- `staff-engine` — HTTP 500 on POST.
- `business-engine` — HTTP 500 on POST (both recent attempts).
- `agent-engine` — HTTP 404 on POST.

## Blocked on external dependency
- WhatsApp permanent System User token: blocked on a new SIM (current WhatsApp Business Account is bound to Meta's fake `+1 555-643-6522` Test number; the real "Franchisee Kart" WhatsApp Business Account has zero phone numbers attached). Once the SIM is active and the number is added + verified in Meta Business Settings, generate a Never-expiring System User token and the circuit breaker auto-releases.

## Repo sync note
This commit syncs the 3 functions rebuilt/created during Phase 1 (`brain-chat`, `heartbeat-engine`, `vault-engine`) plus the governance/vault migration. The live Supabase project has 55 deployed functions total; the remaining ~44 unchanged functions are pending a full pull into this repo in a follow-up sync so GitHub fully matches production.
