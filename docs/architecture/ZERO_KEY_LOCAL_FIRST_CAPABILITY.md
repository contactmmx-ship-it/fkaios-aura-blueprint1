# FKAIOS Zero-Key / Local-First Capability

## Decision

FKAIOS development and routine deterministic execution must not require paid LLM API credits. Paid providers are optional fallbacks, not a prerequisite for building, testing, or operating supported workflows.

## Existing implementation reused

- `supabase/functions/_shared/llm-router.ts` is the canonical provider adapter and fallback layer.
- `self_hosted` is already an OpenAI-compatible adapter intended for Ollama, llama.cpp, vLLM, or another compatible endpoint.
- `prioritizeFreeProviders()` places self-hosted inference first and cloud providers only count as free when their free-tier status is explicitly configured.
- `llm-router.test.ts` uses mock adapters and can exercise fallback without real provider calls.

This change fixes the self-hosted adapter's endpoint resolution so its URL is read at call time, and adds a zero-cloud-key regression test. It does not create a second router.

## Local inference configuration

For a local Ollama instance exposing its OpenAI-compatible API, configure the runtime that executes the Edge Function:

- `SELF_HOSTED_LLM_BASE_URL=http://127.0.0.1:11434/v1` (only when the caller and Ollama share the same machine/network namespace)
- `SELF_HOSTED_LLM_MODEL=qwen2.5:14b` (or a model installed and supported by the local runtime)
- `PROVIDER_SELF_HOSTED_ENABLED=true` (default unless explicitly disabled)
- No `SELF_HOSTED_LLM_API_KEY` is required for a local endpoint.

**Important deployment boundary:** `127.0.0.1` inside a hosted Supabase Edge Function refers to that hosted runtime, not a developer's Windows computer. The local URL works only when the function process can reach the local model. For hosted production, use a secured, reachable self-hosted inference endpoint or keep inference in a local development runtime. Never expose an unauthenticated Ollama port to the public internet. Do not create a paid tunnel or service without explicit authorization.

## Acceptance criteria

1. With all cloud API keys absent and a reachable self-hosted endpoint configured, the router selects only self-hosted inference and can return a model response.
2. Local-first configuration is resolved at request time rather than being frozen when the module is imported.
3. Tests mock network responses; test execution must not consume API credits.
4. When no model provider is configured, FKAIOS must not fabricate a successful reasoning result. Deterministic workflows and tests should still run; an LLM-dependent step must report a specific blocked capability.
5. Provider errors, timeouts, rate limits, and exhausted credits must be recorded truthfully and should lead to eligible fallback, bounded retry, or an explicit blocked result.
6. No production routing policy, paid spend, secret, or live approval state is changed by this feature.
7. Before claiming zero-key operation, run the relevant Deno test suite and validate a local Ollama call in the environment where FKAIOS is actually running.

## Not claimed by this change

This is a focused first implementation step, not proof that the entire FKAIOS objective planner, verifier, or production deployment runs with zero keys. The local endpoint must be reachable from the process making the call, and model quality still requires task-specific evaluation.
