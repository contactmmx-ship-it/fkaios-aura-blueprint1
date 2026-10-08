/// <reference lib="deno.ns" />
function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n     got ${a}`);
}
import { classifyTaskClass, modelRef, parseRef } from "./resource-identity.ts";
import { type CatalogEntry, configuredProviderNames, MIN_LEARNING_SAMPLES, rankResources, type RoutingPolicy } from "./resource-selection.ts";
import { stepRowsFromLog } from "./execution-evidence.ts";
import { evaluationPriority, parseGeminiModels, parseOpenAIModels, parseOpenRouterModels } from "./capability-discovery.ts";
import { callLLMOnResources, classifyLLMFailure, type ProviderAdapter, type RawProviderResponse, type RouterConfig } from "./llm-router.ts";

const entry = (provider: string, model: string, over: Partial<CatalogEntry> = {}): CatalogEntry => ({
  resource_ref: modelRef(provider, model), provider, model, lifecycle_state: "verified", access_state: "configured",
  health_status: "available", unavailable_until: null, free_tier: true, cost_in_per_mtok: 0, context_window: 1_000_000, ...over,
});
const policy = (refs: string[]): RoutingPolicy => ({ id: "p1", task_class: "reasoning", version: 3, resource_refs: refs });
const base = { taskClass: "reasoning", performance: [], configuredProviders: ["gemini", "anthropic"], unavailableProviders: [] as string[] };

Deno.test("identity: refs round-trip and reject unknown kinds", () => {
  assertEquals(modelRef("gemini", "gemini-2.5-flash"), "model:gemini:gemini-2.5-flash");
  assertEquals(parseRef("model:openrouter:meta/llama:free"), { kind: "model", provider: "openrouter", name: "meta/llama:free" });
  assertEquals(parseRef("worker:abc")?.kind, "worker");
  assertEquals(parseRef("gemini-2.5-flash"), null);
});

Deno.test("identity: task classes come from the task text", () => {
  assertEquals(classifyTaskClass("Verify the claims against sources"), "verification");
  assertEquals(classifyTaskClass("Research distributor market in Pune"), "research_synthesis");
  assertEquals(classifyTaskClass("Write the final report"), "writing");
  assertEquals(classifyTaskClass("Extract the three governance rules", "list the rules"), "extraction");
  assertEquals(classifyTaskClass("Implement the API endpoint in TypeScript"), "coding");
  assertEquals(classifyTaskClass("Hello"), "general");
});

Deno.test("selection: active policy order wins; retired and unconfigured resources are never chosen", () => {
  const d = rankResources({ ...base, catalog: [entry("gemini", "a"), entry("gemini", "b"), entry("gemini", "old", { lifecycle_state: "retired" }), entry("openai", "x")], policy: policy(["model:gemini:b", "model:gemini:a"]) });
  assertEquals(d.resources.map((r) => r.ref), ["model:gemini:b", "model:gemini:a"]);
  assert(d.skipped.some((s) => s.ref === "model:gemini:old" && s.reason === "retired"));
  assert(d.skipped.some((s) => s.ref === "model:openai:x" && /not configured/.test(s.reason)));
  assertEquals(d.policyVersion, 3);
});

Deno.test("selection: a model in quota cooldown moves behind healthy models (not dropped)", () => {
  const future = new Date(Date.now() + 10 * 60_000).toISOString();
  const d = rankResources({ ...base, catalog: [entry("gemini", "a", { unavailable_until: future }), entry("gemini", "b")], policy: policy(["model:gemini:a", "model:gemini:b"]) });
  assertEquals(d.resources.map((r) => r.ref), ["model:gemini:b", "model:gemini:a"]);
});

Deno.test("selection: a provider with no credit goes last", () => {
  const d = rankResources({ ...base, catalog: [entry("anthropic", "h", { access_state: "no_credit", lifecycle_state: "adopted" }), entry("gemini", "a")], policy: policy(["model:anthropic:h", "model:gemini:a"]) });
  assertEquals(d.resources[0].ref, "model:gemini:a");
});

Deno.test("selection: discovered models are used for evaluation but never in production", () => {
  const catalog = [entry("gemini", "new", { lifecycle_state: "discovered" }), entry("gemini", "a", { lifecycle_state: "adopted" })];
  assertEquals(rankResources({ ...base, catalog, policy: null }).resources.map((r) => r.ref), ["model:gemini:a"]);
  assertEquals(rankResources({ ...base, catalog, policy: null, options: { purpose: "evaluation" } }).resources.length, 2);
});

Deno.test("selection: avoid list is soft, exclude list is hard", () => {
  const catalog = [entry("gemini", "a"), entry("gemini", "b")];
  const p = policy(["model:gemini:a", "model:gemini:b"]);
  assertEquals(rankResources({ ...base, catalog, policy: p, options: { avoid: ["model:gemini:a"] } }).resources.map((r) => r.ref), ["model:gemini:b", "model:gemini:a"]);
  assertEquals(rankResources({ ...base, catalog, policy: p, options: { exclude: ["model:gemini:a"] } }).resources.map((r) => r.ref), ["model:gemini:b"]);
});

Deno.test("learning: thin evidence never reorders; clear verified underperformance demotes", () => {
  const catalog = [entry("gemini", "a"), entry("gemini", "b")];
  const p = policy(["model:gemini:a", "model:gemini:b"]);
  const thin = [{ resource_ref: "model:gemini:a", task_class: "reasoning", sample_size: MIN_LEARNING_SAMPLES - 1, verified_count: 0, avg_quality: 0.1 },
                { resource_ref: "model:gemini:b", task_class: "reasoning", sample_size: MIN_LEARNING_SAMPLES - 1, verified_count: 4, avg_quality: 0.9 }];
  assertEquals(rankResources({ ...base, catalog, policy: p, performance: thin }).resources[0].ref, "model:gemini:a");
  const clear = [{ resource_ref: "model:gemini:a", task_class: "reasoning", sample_size: 10, verified_count: 4, avg_quality: 0.4 },
                 { resource_ref: "model:gemini:b", task_class: "reasoning", sample_size: 10, verified_count: 9, avg_quality: 0.9 }];
  const d = rankResources({ ...base, catalog, policy: p, performance: clear });
  assertEquals(d.resources[0].ref, "model:gemini:b");
  assert(d.reasons.some((r) => r.startsWith("learning: demoted model:gemini:a")));
  // Evidence for another task class is ignored.
  const other = clear.map((c) => ({ ...c, task_class: "writing" }));
  assertEquals(rankResources({ ...base, catalog, policy: p, performance: other }).resources[0].ref, "model:gemini:a");
});

Deno.test("selection: configured providers come from present, enabled keys", () => {
  const env: Record<string, string> = { GEMINI_API_KEY: "x", ANTHROPIC_API_KEY: "y", PROVIDER_ANTHROPIC_ENABLED: "false" };
  assertEquals(configuredProviderNames((k) => env[k]), ["gemini"]);
});

Deno.test("evidence: one row per attempt with identity, switch and tokens on success only", () => {
  const rows = stepRowsFromLog({ stepKind: "task_execution", taskId: "t1", objectiveId: "o1", taskClass: "writing", workerRef: "worker:w" }, {
    function_name: "ai-engine", agent_name: null, requested_provider: "gemini", attempted_providers: ["gemini", "gemini"], failure_reason: "x",
    successful_provider: "gemini", successful_model: "b", latency_ms: 30, token_usage: { input: 10, output: 20 }, estimated_cost_usd: 0, final_result_status: "success",
    attempts: [
      { provider: "gemini", model: "a", outcome: "failure", wasFallback: false, failureCategory: "rate_limit", latencyMs: 10, failureDetail: "429" },
      { provider: "gemini", model: "b", outcome: "success", wasFallback: true, failureCategory: null, latencyMs: 20, inputTokens: 10, outputTokens: 20 },
    ],
  }, null, "answer", new Date("2026-10-08T00:00:00Z"));
  assertEquals(rows.length, 2);
  assertEquals(rows[0].resource_ref, "model:gemini:a");
  assertEquals(rows[0].outcome, "failed");
  assertEquals(rows[0].input_tokens, null);
  assertEquals(rows[1].switched_from_ref, "model:gemini:a");
  assertEquals(rows[1].output_tokens, 20);
  assertEquals(rows[1].output_excerpt, "answer");
  assertEquals(rows[1].started_at, "2026-10-08T00:00:00.010Z");
});

Deno.test("discovery: provider catalogs parse into text-model candidates", () => {
  const gem = parseGeminiModels({ models: [
    { name: "models/gemini-2.5-flash", displayName: "Gemini 2.5 Flash", inputTokenLimit: 1048576, outputTokenLimit: 65536, supportedGenerationMethods: ["generateContent", "countTokens"] },
    { name: "models/text-embedding-004", supportedGenerationMethods: ["embedContent"] },
    { name: "models/imagen-4", supportedGenerationMethods: ["generateContent"] },
  ] });
  assertEquals(gem.map((m) => m.model), ["gemini-2.5-flash"]);
  assertEquals(gem[0].contextWindow, 1048576);
  assertEquals(parseOpenAIModels({ data: [{ id: "gpt-4o-mini" }, { id: "gpt-4o-mini-2024-07-18" }, { id: "text-embedding-3-small" }, { id: "o3" }] }).map((m) => m.model), ["gpt-4o-mini", "o3"]);
  const or = parseOpenRouterModels({ data: [
    { id: "meta-llama/llama-3.3-70b-instruct:free", context_length: 131072, pricing: { prompt: "0", completion: "0" } },
    { id: "openai/gpt-4o", pricing: { prompt: "0.0000025", completion: "0.00001" } },
  ] });
  assertEquals(or.map((m) => m.model), ["meta-llama/llama-3.3-70b-instruct:free"]);
  assertEquals(or[0].freeTier, true);
  assert(evaluationPriority("gemini-2.5-flash") > evaluationPriority("gemini-2.5-pro-preview-05-06"));
});

function mockAdapter(name: "gemini" | "anthropic", byModel: Record<string, RawProviderResponse | "throw">): ProviderAdapter {
  return {
    name,
    getModel: () => "default",
    async call(req) {
      const r = byModel[req.model ?? "default"];
      if (r === "throw" || !r) throw new Error("network");
      return { ...r, model: req.model ?? "default" };
    },
    estimateCost: () => 0,
    health: () => ({ provider: name, successRate: null, failureCount: 0, fallbackFrequency: null, avgLatencyMs: null, timeoutRate: null, costPerSuccessUsd: null, sampleSize: 0 }),
  };
}
const cfg = (providers: ProviderAdapter[]): RouterConfig => ({
  providers, costConfig: { warningPct: 0.8, limitUsd: {} },
  retryLimitByClass: { founder_intelligence: 8, business_agent: 8, background_agent: 8, customer_agent: 8 },
  timeoutMsByClass: { founder_intelligence: 1000, business_agent: 1000, background_agent: 1000, customer_agent: 1000 },
});
const req = { systemPrompt: "s", userContent: "u", functionName: "test", functionClass: "background_agent" as const };

Deno.test("routing: a quota hit on one model is served by another model of the same provider", async () => {
  Deno.env.delete("SUPABASE_URL");
  const gem = mockAdapter("gemini", {
    "flash-lite": { ok: false, httpStatus: 429, rawBody: { error: "quota" }, latencyMs: 1, model: "" },
    "flash": { ok: true, httpStatus: 200, content: "done", rawBody: {}, latencyMs: 1, model: "", inputTokens: 5, outputTokens: 7 },
  });
  const r = await callLLMOnResources(req, cfg([gem]), [
    { ref: "model:gemini:flash-lite", provider: "gemini", model: "flash-lite" },
    { ref: "model:gemini:flash", provider: "gemini", model: "flash" },
  ]);
  assertEquals(r.status, "success");
  assertEquals(r.model, "flash");
  assertEquals(r.log.attempts.map((a) => [a.model, a.outcome, a.failureCategory]), [["flash-lite", "failure", "rate_limit"], ["flash", "success", null]]);
  assertEquals(r.log.attempts[1].outputTokens, 7);
});

Deno.test("routing: a provider-wide failure (no credit) skips that provider's other models", async () => {
  const ant = mockAdapter("anthropic", { "h1": { ok: false, httpStatus: 400, rawBody: { error: { message: "Your credit balance is too low" } }, latencyMs: 1, model: "" }, "h2": "throw" });
  const gem = mockAdapter("gemini", { "a": { ok: true, httpStatus: 200, content: "ok", rawBody: {}, latencyMs: 1, model: "" } });
  const r = await callLLMOnResources(req, cfg([ant, gem]), [
    { ref: "model:anthropic:h1", provider: "anthropic", model: "h1" },
    { ref: "model:anthropic:h2", provider: "anthropic", model: "h2" },
    { ref: "model:gemini:a", provider: "gemini", model: "a" },
  ]);
  assertEquals(r.status, "success");
  assertEquals(r.log.attempts.map((a) => a.model), ["h1", "a"]);
});

Deno.test("routing: a missing model is model_unavailable and fails over", () => {
  const f = classifyLLMFailure({ ok: false, httpStatus: 404, rawBody: { error: { message: "models/gemini-9 is not found for API version v1beta" } }, latencyMs: 1, model: "gemini-9" });
  assertEquals(f.category, "model_unavailable");
  assert(f.shouldFailover);
});

Deno.test("routing: truncated output is flagged for continuation", async () => {
  const gem = mockAdapter("gemini", { "a": { ok: true, httpStatus: 200, content: "part", rawBody: {}, latencyMs: 1, model: "", truncated: true } });
  const r = await callLLMOnResources(req, cfg([gem]), [{ ref: "model:gemini:a", provider: "gemini", model: "a" }]);
  assertEquals(r.truncated, true);
});
