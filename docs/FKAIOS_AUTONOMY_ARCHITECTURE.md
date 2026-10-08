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
| Output-limit continuation | ai-engine `callLLM` | a truncated response becomes a checkpoint handed to the next call |
| Canonical objective state | `fkaios_objective_state_apply` (SQL) | `fkaios_objective_state`, `fkaios_objective_state_history`; compare-and-swap version and an explicit phase state machine |
| Capability graph | `v_fkaios_capability_graph` | derived from policies, registry and verified performance; never hand-maintained |
| Discovery | `_shared/capability-discovery.ts`, hourly from founder-brain-tick | Gemini, Anthropic and OpenAI model APIs and the OpenRouter public catalog → `model_registry`, `capability_discovery_candidates`, `capability_test_queue` |
| Golden evaluation | `fkaios_eval_cases` | versioned cases with deterministic checks |
| Leased test queue | `fkaios_claim_capability_test`, `fkaios_finish_capability_test` | `capability_test_queue` (lease, SKIP LOCKED, owner-checked finish, crash reclaim) |

## Governance rules built into the schema

- `capability_benchmarks.verified = true` requires a `verification_evidence_id`.
- Adoption proposals in state approve or adopted require an approval row; every decision records who and when.
- Only one active routing policy per task class. Every policy version records its reason, its evidence and its rollback target.
- Discovered models are never routed in production until they have been evaluated.
- A model that production routing depends on is never auto-retired. It becomes `degraded`.

## Status log

- **8 Oct, foundation:** schema applied to production as migrations `20261008141652`–`20261008142810`. Each repo file is byte-identical to what production ran. Code is in PR-1. Operational status is recorded per component after the deploy has been verified.
