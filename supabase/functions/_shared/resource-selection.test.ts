import { assertEquals, assert } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { configuredLocalModelEntry, configuredProviderNames, rankResources } from "./resource-selection.ts";

Deno.test("configured local model is synthesized without a database catalog row", () => {
  const local = configuredLocalModelEntry((key) => ({
    SELF_HOSTED_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    SELF_HOSTED_LLM_MODEL: "qwen2.5:7b",
  } as Record<string, string>)[key]);
  assert(local);
  assertEquals(local.resource_ref, "model:self_hosted:qwen2.5:7b");
  assertEquals(local.lifecycle_state, "candidate");
  assertEquals(local.access_state, "configured");
  assertEquals(local.free_tier, true);
});

Deno.test("local candidate is not synthesized when endpoint is missing or explicitly disabled", () => {
  assertEquals(configuredLocalModelEntry(() => undefined), null);
  assertEquals(configuredLocalModelEntry((key) => ({
    SELF_HOSTED_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    PROVIDER_SELF_HOSTED_ENABLED: "false",
  } as Record<string, string>)[key]), null);
});

Deno.test("bridge flag enables a local candidate without a direct hosted URL", () => {
  const local = configuredLocalModelEntry((key) => ({
    FKAIOS_LOCAL_INFERENCE_BRIDGE_ENABLED: "true",
    SELF_HOSTED_LLM_MODEL: "qwen2.5:7b",
  } as Record<string, string>)[key]);
  assert(local);
  assertEquals(local.resource_ref, "model:self_hosted:qwen2.5:7b");
  assertEquals(configuredLocalModelEntry((key) => ({
    FKAIOS_LOCAL_INFERENCE_BRIDGE_ENABLED: "true",
    PROVIDER_SELF_HOSTED_ENABLED: "false",
  } as Record<string, string>)[key]), null);
});

Deno.test("bridge mode blocks cloud providers unless fallback is explicitly enabled", () => {
  const env = (values: Record<string, string>) => (key: string) => values[key];
  assertEquals(configuredProviderNames(env({
    FKAIOS_LOCAL_INFERENCE_BRIDGE_ENABLED: "true",
    GEMINI_API_KEY: "present",
    OPENAI_API_KEY: "present",
  })), ["self_hosted"]);
  assertEquals(configuredProviderNames(env({
    FKAIOS_LOCAL_INFERENCE_BRIDGE_ENABLED: "true",
    FKAIOS_ALLOW_CLOUD_FALLBACK: "true",
    GEMINI_API_KEY: "present",
  })).sort(), ["gemini", "self_hosted"]);
});

Deno.test("configured local model precedes active cloud-only policy resources", () => {
  const local = configuredLocalModelEntry((key) => ({
    SELF_HOSTED_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    SELF_HOSTED_LLM_MODEL: "qwen2.5:7b",
  } as Record<string, string>)[key]);
  assert(local);
  const decision = rankResources({
    taskClass: "planning",
    catalog: [
      local,
      {
        resource_ref: "model:gemini:gemini-3.5-flash-lite",
        provider: "gemini",
        model: "gemini-3.5-flash-lite",
        lifecycle_state: "adopted",
        access_state: "configured",
        health_status: "available",
        unavailable_until: null,
        free_tier: true,
        cost_in_per_mtok: 0,
        context_window: 1000000,
      },
      {
        resource_ref: "model:anthropic:claude-haiku-4-5-20251001",
        provider: "anthropic",
        model: "claude-haiku-4-5-20251001",
        lifecycle_state: "monitored",
        access_state: "configured",
        health_status: "unknown",
        unavailable_until: null,
        free_tier: false,
        cost_in_per_mtok: 1,
        context_window: 200000,
      },
    ],
    policy: {
      id: "policy-planning",
      task_class: "planning",
      version: 1,
      resource_refs: [
        "model:gemini:gemini-3.5-flash-lite",
        "model:anthropic:claude-haiku-4-5-20251001",
      ],
    },
    performance: [],
    configuredProviders: ["self_hosted", "gemini", "anthropic"],
    unavailableProviders: [],
  });
  assertEquals(decision.resources[0]?.ref, "model:self_hosted:qwen2.5:7b");
  assert(decision.reasons.some((reason) => reason.includes("policy planning v1")));
});

Deno.test("explicit hard exclusion still blocks the local model", () => {
  const local = configuredLocalModelEntry((key) => ({
    SELF_HOSTED_LLM_BASE_URL: "http://127.0.0.1:11434/v1",
    SELF_HOSTED_LLM_MODEL: "qwen2.5:7b",
  } as Record<string, string>)[key]);
  assert(local);
  const decision = rankResources({
    taskClass: "planning",
    catalog: [local],
    policy: null,
    performance: [],
    configuredProviders: ["self_hosted"],
    unavailableProviders: [],
    options: { exclude: [local.resource_ref] },
  });
  assertEquals(decision.resources.length, 0);
  assertEquals(decision.skipped[0]?.reason, "excluded by caller");
});
