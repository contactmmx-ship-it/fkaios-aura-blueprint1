# FKAIOS autonomy architecture

Built from 8 Oct 2026 against the re-audit baseline (`docs/FKAIOS_REAUDIT_2026-10-08.md`). It extends the existing subsystems rather than adding parallel ones.

**Status vocabulary:** a component counts as OPERATIONAL only when it is deployed, invoked by real execution, writing evidence, and changing behaviour. Anything less is stated as such.

## The loop

```
objective ─► objective_contracts (understanding) ─► fkaios_objective_state (canonical state, versioned CAS)
   ─► executive-planner (decomposition) ─► work-engine (allocation, checkpoint/resume)
   ─► resource-selection (policy + health + verified learning) ─► llm-router callLLMOnResources (model-level failover)
   ─► ai-engine (execution, output-limit continuation) ─► fkaios_execution_steps (evidence per attempt)
   ─► objective verifier (independent model + deterministic checks) ─► rectification or completion
   ─► verified outcomes ─► v_fkaios_resource_performance (learning) ─► routing
   capability discovery (provider catalogs) ─► model_registry + candidates ─► capability_test_queue (leased)
   ─► golden evals vs actual incumbent ─► capability_benchmarks (evidence-linked) ─► adoption proposal
   ─► governed adoption ─► fkaios_routing_policies (versioned, rollback) ─► post-adoption monitoring
```

## Components

| Component | Where | Tables |
|---|---|---|
| Resource identity | `_shared/resource-identity.ts` | `model:<provider>:<model>` · `worker:<id>` · `tool:<provider>:<tool>` · `capability:<id>`, enforced by check constraints |
| Resource registry and lifecycle | `model_registry` (extended) | lifecycle: discovered → testing → verified → candidate → adopted → monitored → degraded → retired; per-model health and access |
| Execution evidence | `_shared/execution-evidence.ts`, ai-engine | `fkaios_execution_steps` (one row per attempt: resource, timing, tokens, cost, failure, switch, verification status) |
| Model-level routing | `_shared/llm-router.ts` `callLLMOnResources` | quota/missing-model failures are model-scoped; credit/auth/outage are provider-scoped |
| Resource selection | `_shared/resource-selection.ts` | `fkaios_routing_policies` (active policy), `provider_health_state`, `v_fkaios_resource_performance` (min 5 verified samples before learning reorders) |
| Output-limit continuation | `_shared/continuation.ts`, used by ai-engine `callLLM` | a truncated response becomes a checkpoint handed to the next call (any resource); max 2 continuations, then the task fails for decomposition |
| Canonical objective state | `fkaios_objective_state_apply` (SQL) | `fkaios_objective_state`, `fkaios_objective_state_history`; compare-and-swap version and an explicit phase state machine |
| Capability graph | `v_fkaios_capability_graph` | derived from policies, registry and verified performance; never hand-maintained |
| Discovery | `_shared/capability-discovery.ts`, hourly from founder-brain-tick | Gemini, Anthropic and OpenAI model APIs and the OpenRouter public catalog → `model_registry`, `capability_discovery_candidates`, `capability_test_queue` |
| Golden evaluation | `fkaios_eval_cases` | versioned cases with deterministic checks |
| Checkpoint resume | `work-engine.resumeTaskFromCheckpoint`, objective-loop | a failed task gets a new job for the same task with a checkpoint and the failed resources on the avoid list; a `provider_handoffs` row records it; budget of 2 resumes per task before a replan |
| Independent verification | `_shared/objective-verifier.ts` | verifier model chosen with the producing models avoided; deterministic checks; a "met" criterion needs a quote found in the deliverable; `fkaios_verification_evidence` `objective_verifier:v1`; marks the producing steps verified or rejected |
| Rectification | objective-loop, `work-engine.createRectificationTask` | a rejected deliverable gets up to 2 rectification rounds in the same project (verifier issues in, producers avoided), then a replan, then the founder |
| Golden evaluation and executor | `_shared/capability-evaluation.ts`, background in founder-brain-tick | suite `fkaios_core` v1 (8 cases, 8 task classes, scored by code); resumable leased executor; budget cap; the incumbent is what production routes each class to today |
| Governed adoption and rollback | `fkaios_adopt_routing`, `fkaios_rollback_routing` (SQL, atomic) | autonomous only under policy v1 (no extra cost, configured, no regressions, score ≥ 0.75); otherwise a founder approval (`approvals.action_type = capability_adoption`); 72 h monitoring; automatic rollback on degradation |
| Production self-test | `_shared/self-test.ts`, background in founder-brain-tick | a `fkaios_self_tests` row (status `requested`) makes the next tick run model failover, continuation, verifier reject and verifier pass on real models through the real code paths; no objective, no approval gate |
| Capability → resource index | `fkaios_resource_capabilities` | which resources can provide each capability (speech, communications), with tier (local → self-hosted → free → low-cost → paid), privacy class, cost model, infrastructure needs, credential *reference* (env-var name only, enforced by a check), lifecycle and health |
| Speech capabilities | `_shared/speech.ts` | `speech_to_text` and `text_to_speech` selected per call (local first; paid only with an explicit spend decision), with failover, failure classification and an evidence row per attempt (`capability_ref capability:<name>`). Adapters: Gemini, any OpenAI-compatible speech server (faster-whisper, Kokoro, Piper), ElevenLabs, OpenAI |
| Voice turn | `_shared/voice.ts` | audio → STT → any responder → TTS (→ STT back to check the audio). It holds no business logic: the same brain serves every modality |
| Communications | `_shared/communications.ts`, `founder-objective` action `request_communication`, founder-brain-tick executor | a message is a capability: plan (authorised resource, recipient format, platform rules such as the WhatsApp 24 h session or a pre-approved template) → founder approval (`approvals.action_type external_communication`) → sent once (claimed by compare-and-swap, plan re-checked at send time) → provider message id recorded as `communication:<capability>` evidence. Nothing is sent from a request alone |
| Voice entry points | `founder-objective` actions `transcribe`, `speak`, `voice_turn` (founder session required) | spoken objectives become text through `speech_to_text`, then follow the same objective path as typed text |
| Leased test queue | `fkaios_claim_capability_test`, `fkaios_finish_capability_test` | `capability_test_queue` (lease, SKIP LOCKED, owner-checked finish, crash reclaim) |

## Governance rules built into the schema

- `capability_benchmarks.verified = true` requires a `verification_evidence_id`.
- Adoption proposals in state approve or adopted require an approval row; every decision records who and when.
- Only one active routing policy per task class. Every policy version records its reason, its evidence and its rollback target.
- Evaluation and self-test evidence may have no objective (`requirement_key` `eval:` / `self_test:`); all other verification evidence must name its objective.
- Discovered models are never routed in production until they have been evaluated.
- A model that production routing depends on is never auto-retired. It becomes `degraded`.

## Status log

- **8 Oct, foundation:** schema applied to production as migrations `20261008141652`–`20261008142810`. Each repo file is byte-identical to what production ran. Code is in PR-1. Operational status is recorded per component after the deploy has been verified.
- **8 Oct, foundation deployed** (CI run 93, PR #48). The first production discovery run listed 25 Gemini models (key configured), 14 Anthropic and 48 OpenAI models (keys present, no credit) and 18 free OpenRouter models (no key). They went into `model_registry` and `capability_discovery_candidates`.
- **8 Oct, execution and evolution layers:** migrations `20261008153814` (eval suite) and `20261008153959` (adoption functions) are applied and byte-identical in the repo. Code is in PR-2.
- **8 Oct, PR-2 deployed** (PR #49), plus the fix in PR #50: the evaluator selected the nonexistent column `model_registry.id`, so every candidate was cancelled as unregistered. The voided test was annotated and its candidate restored.
- **8 Oct, evidence and self-test:** migration `20261008154853` (applied, byte-identical) lets eval and self-test evidence exist without an objective. Without it, benchmark evidence could not have been written, so no benchmark could have been verified. Also adds the `fkaios_self_tests` harness. Continuation logic moved into `_shared/continuation.ts`.
- **8 Oct, production self-tests:**
  - Run `ef65c13b` (15:53): model failover, verifier reject and verifier pass passed. Continuation completed, but a too-strict check failed it. The verifier also overstated independence when no producer was known. Both fixed in #52.
  - Run `3e57e289` (15:57): **4/4 passed**. Its text exposed lost spaces at continuation seams. Fixed in #53 by stitching each continuation onto an anchor repeated from the end of the partial output.
- **8 Oct, security and speech:**
  - **Cron secret leak (P0):** cron jobs send `HEARTBEAT_SECRET` as `?secret=` in function URLs, and edge request logs (plus agent-scheduler's own log line) record those URLs. The fix is a header read from Vault through `fkaios_cron_call()`. It was blocked as a secret-store write needing founder approval, so it is not applied; the secret must be rotated either way.
  - **Unauthenticated cron removed:** `ai-engine-run-jobs-5min` (HTTP 401 every 5 minutes) is deactivated by migration `20261008161605`.
  - **Speech layer:** migration `20261008161835` adds `fkaios_resource_capabilities`, alongside the speech and voice modules.
  - **Communications and voice entry points:** migration `20261008162504` lets `communication:` evidence exist without an objective.
