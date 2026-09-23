// FKAIOS llm-router.ts — Phase 6A Step 2 isolated tests.
//
// All providers below are MOCKS. No real network calls are made, no real API
// keys are read or required, and no production function is touched or
// imported. These tests exercise the routing/classification/fallback logic
// in complete isolation.

/// <reference lib="deno.ns" />

import {
  callLLM,
  classifyLLMFailure,
  selectProvider,
  checkCostLimit,
  computeProviderHealth,
  buildLogEntry,
  getConfiguredDefaultProviders,
  anthropicAdapter,
  geminiAdapter,
  openaiAdapter,
  type ProviderAdapter,
  type ProviderName,
  type LLMRequest,
  type RawProviderResponse,
  type RouterConfig,
  type CallAttempt,
} from "./llm-router.ts";

/** Sets an env var for the duration of `fn`, restoring (or deleting) the prior value afterward — even if `fn` throws. */
async function withEnv<T>(vars: Record<string, string | undefined>, fn: () => T | Promise<T>): Promise<T> {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = Deno.env.get(key);
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
    return await fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function baseRequest(overrides: Partial<LLMRequest> = {}): LLMRequest {
  return {
    systemPrompt: "You are a test system prompt.",
    userContent: "Test user content.",
    toolSchema: { name: "emit_test", parameters: { type: "object", properties: { foo: { type: "string" } } } },
    maxTokens: 500,
    temperature: 0.4,
    functionName: "test-function",
    agentName: "test-agent",
    functionClass: "business_agent",
    ...overrides,
  };
}

function baseConfig(providers: ProviderAdapter[]): RouterConfig {
  return {
    providers,
    costConfig: { warningPct: 0.8, limitUsd: {} },
    retryLimitByClass: {
      founder_intelligence: 3,
      business_agent: 3,
      background_agent: 5,
      customer_agent: 2,
    },
    timeoutMsByClass: {
      founder_intelligence: 200,
      business_agent: 200,
      background_agent: 200,
      customer_agent: 100,
    },
  };
}

/** Mirrors llm-router.ts's own per-provider mock model naming, so tests can assert on it without depending on the real (env-overridable) production model strings. */
function mockModelFor(name: ProviderName): string {
  return `mock-${name}-model`;
}

function mockAdapter(
  name: ProviderName,
  impl: (request: LLMRequest, timeoutMs: number) => Promise<RawProviderResponse>,
): ProviderAdapter {
  return {
    name,
    call: impl,
    estimateCost: () => 0.001,
    getModel: () => mockModelFor(name),
    health: () => ({
      provider: name,
      successRate: null,
      failureCount: 0,
      fallbackFrequency: null,
      avgLatencyMs: null,
      timeoutRate: null,
      costPerSuccessUsd: null,
      sampleSize: 0,
    }),
  };
}

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

// ---------------------------------------------------------------------------
// Test 1: Anthropic credit exhaustion
// ---------------------------------------------------------------------------

Deno.test("Test 1: Anthropic credit exhaustion triggers fallback, real response returned", async () => {
  const anthropic = mockAdapter("anthropic", async () => ({
    ok: false,
    httpStatus: 400,
    rawBody: {
      type: "error",
      error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." },
    },
    latencyMs: 10,
    model: mockModelFor("anthropic"),
  }));

  const openai = mockAdapter("openai", async () => ({
    ok: true,
    httpStatus: 200,
    content: "Real fallback response",
    rawBody: { choices: [{ message: { content: "Real fallback response" } }] },
    inputTokens: 20,
    outputTokens: 15,
    latencyMs: 12,
    model: mockModelFor("openai"),
  }));

  const result = await callLLM(baseRequest(), baseConfig([anthropic, openai]));

  assert(result.status === "success", `Expected success, got ${result.status}`);
  assert(result.content === "Real fallback response", "Fallback content missing or wrong");
  assert(result.log.successful_provider === "openai", "Expected openai as successful_provider");
  assert(result.log.successful_model === mockModelFor("openai"), "Expected the successful attempt's actual model to be recorded, not guessed from provider name");
  assert(result.model === mockModelFor("openai"), "Top-level LLMResult.model must reflect the actual model that answered");
  assert(result.log.attempted_providers.includes("anthropic"), "anthropic should appear in attempted_providers");
  assert(!!result.log.failure_reason?.includes("credit_exhaustion"), "failure_reason should record credit_exhaustion");
});

Deno.test("Unit: classifyLLMFailure recognizes the exact live credit-exhaustion message shape", () => {
  const response: RawProviderResponse = {
    ok: false,
    httpStatus: 400,
    rawBody: { error: { message: "Your credit balance is too low to access the Anthropic API." } },
    latencyMs: 5,
    model: mockModelFor("anthropic"),
  };
  const failure = classifyLLMFailure(response);
  assert(failure.category === "credit_exhaustion", `Expected credit_exhaustion, got ${failure.category}`);
  assert(failure.shouldFailover === true, "credit_exhaustion must trigger failover");
});

// ---------------------------------------------------------------------------
// Test 2: Rate limit
// ---------------------------------------------------------------------------

Deno.test("Test 2: Rate limit is classified correctly and fallback works", async () => {
  const primary = mockAdapter("anthropic", async () => ({
    ok: false,
    httpStatus: 429,
    rawBody: { error: { message: "rate limit exceeded" } },
    latencyMs: 5,
    model: mockModelFor("anthropic"),
  }));
  const secondary = mockAdapter("deepseek", async () => ({
    ok: true,
    httpStatus: 200,
    content: "fallback ok",
    rawBody: {},
    latencyMs: 8,
    model: mockModelFor("deepseek"),
  }));

  const result = await callLLM(baseRequest(), baseConfig([primary, secondary]));

  assert(result.status === "success", `Expected success via fallback, got ${result.status}`);
  assert(result.log.successful_provider === "deepseek", "Expected deepseek to succeed after rate limit");
  assert(!!result.log.failure_reason?.includes("rate_limit"), "failure_reason should mention rate_limit");
});

// ---------------------------------------------------------------------------
// Test 3: Timeout (controlled delayed response — never a permanently
// unresolved promise)
// ---------------------------------------------------------------------------

Deno.test("Test 3: Timeout is classified correctly via a controlled delayed response, not a hang", async () => {
  let resolveSlowSettled: () => void;
  const slowSettled = new Promise<void>((resolve) => {
    resolveSlowSettled = resolve;
  });

  const slow = mockAdapter("anthropic", async (_req, timeoutMs) => {
    // Controlled delay deliberately exceeding the configured timeout, so the
    // router's own timeout wins the race — this promise still resolves on
    // its own shortly after, it is never abandoned/unresolved.
    await delay(timeoutMs + 100);
    resolveSlowSettled();
    return { ok: true, httpStatus: 200, content: "too late", rawBody: {}, latencyMs: timeoutMs + 100, model: mockModelFor("anthropic") };
  });

  const fast = mockAdapter("openai", async () => ({
    ok: true,
    httpStatus: 200,
    content: "fast success",
    rawBody: {},
    latencyMs: 5,
    model: mockModelFor("openai"),
  }));

  const config = baseConfig([slow, fast]);
  config.timeoutMsByClass.business_agent = 50;

  const result = await callLLM(baseRequest(), config);

  assert(result.status === "success", `Expected eventual success via fallback, got ${result.status}`);
  assert(result.log.successful_provider === "openai", "openai should have succeeded after anthropic timed out");
  assert(!!result.log.failure_reason?.includes("timeout"), "failure_reason should mention timeout");

  // Drain the deliberately-slow background call so no timer is left pending
  // when the test ends — proves the delay was controlled, not abandoned.
  await slowSettled;
});

// ---------------------------------------------------------------------------
// Test 4: Malformed request — must NOT fail over
// ---------------------------------------------------------------------------

Deno.test("Test 4: Malformed request is classified invalid_request and does not fail over", async () => {
  let secondaryCalled = false;
  const primary = mockAdapter("anthropic", async () => ({
    ok: false,
    httpStatus: 400,
    rawBody: { error: { type: "invalid_request_error", message: "messages: at least one message is required" } },
    latencyMs: 5,
    model: mockModelFor("anthropic"),
  }));
  const secondary = mockAdapter("openai", async () => {
    secondaryCalled = true;
    return { ok: true, httpStatus: 200, content: "should never be reached", rawBody: {}, latencyMs: 3, model: mockModelFor("openai") };
  });

  const result = await callLLM(baseRequest(), baseConfig([primary, secondary]));

  assert(result.status === "failed_all_providers", `Expected failed_all_providers, got ${result.status}`);
  assert(!secondaryCalled, "Secondary provider must NOT be called for an invalid_request failure");
  assert(result.log.attempted_providers.length === 1, "Only one provider should have been attempted");
  assert(!!result.log.failure_reason?.includes("invalid_request"), "failure_reason should mention invalid_request");
});

Deno.test("Unit: classifyLLMFailure marks invalid_request as shouldFailover=false", () => {
  const response: RawProviderResponse = {
    ok: false,
    httpStatus: 400,
    rawBody: { error: { type: "invalid_request_error", message: "bad payload" } },
    latencyMs: 5,
    model: mockModelFor("anthropic"),
  };
  const failure = classifyLLMFailure(response);
  assert(failure.category === "invalid_request", `Expected invalid_request, got ${failure.category}`);
  assert(failure.shouldFailover === false, "invalid_request must not trigger failover in Phase 6A");
});

// ---------------------------------------------------------------------------
// Test 5: HTTP 200 empty response — must never be reported as success
// ---------------------------------------------------------------------------

Deno.test("Test 5: HTTP 200 with empty content is classified invalid_response_received, never success", async () => {
  const onlyProvider = mockAdapter("anthropic", async () => ({
    ok: true,
    httpStatus: 200,
    content: "",
    rawBody: { content: [] },
    latencyMs: 5,
    model: mockModelFor("anthropic"),
  }));

  const result = await callLLM(baseRequest(), baseConfig([onlyProvider]));

  assert(result.status !== "success", "Empty content must never be reported as success");
  assert(result.status === "invalid_response_received", `Expected invalid_response_received, got ${result.status}`);
});

// ---------------------------------------------------------------------------
// Test 6: All providers unavailable — honest failure, no fake intelligence
// ---------------------------------------------------------------------------

Deno.test("Test 6: All providers unavailable returns an honest failure, never fake success", async () => {
  const unavailable = (name: ProviderName) =>
    mockAdapter(name, async () => ({ ok: false, httpStatus: 503, rawBody: { error: "service unavailable" }, latencyMs: 5, model: mockModelFor(name) }));

  const result = await callLLM(baseRequest(), baseConfig([unavailable("anthropic"), unavailable("openai"), unavailable("deepseek")]));

  assert(result.status === "failed_all_providers", `Expected failed_all_providers, got ${result.status}`);
  assert(!result.content, "No content should be returned on total failure");
  assert(result.log.attempted_providers.length === 3, "All three providers should have been attempted");
  assert(result.log.successful_provider === null, "successful_provider must be null on total failure");
});

// ---------------------------------------------------------------------------
// Test 7: Prompt Preservation — the request must reach the provider unchanged
// ---------------------------------------------------------------------------

Deno.test("Test 7: Prompt Preservation — systemPrompt/userContent/toolSchema/temperature/maxTokens pass through unchanged", async () => {
  let captured: LLMRequest | null = null;

  const provider = mockAdapter("anthropic", async (request) => {
    captured = request;
    return { ok: true, httpStatus: 200, content: "ok", rawBody: {}, latencyMs: 5, model: mockModelFor("anthropic") };
  });

  const original = baseRequest({
    systemPrompt: "EXACT system prompt — must not change.",
    userContent: "EXACT user content — must not change.",
    toolSchema: { name: "emit_cycle", parameters: { type: "object", properties: { foo: { type: "string" } } } },
    temperature: 0.37,
    maxTokens: 1234,
  });

  await callLLM(original, baseConfig([provider]));

  assert(captured !== null, "Provider was never called");
  const req = captured as unknown as LLMRequest;
  assert(req.systemPrompt === original.systemPrompt, "systemPrompt was altered");
  assert(req.userContent === original.userContent, "userContent was altered");
  assert(JSON.stringify(req.toolSchema) === JSON.stringify(original.toolSchema), "toolSchema was altered");
  assert(req.temperature === original.temperature, "temperature was altered");
  assert(req.maxTokens === original.maxTokens, "maxTokens was altered");
});

// ---------------------------------------------------------------------------
// Supporting unit tests: routing, cost governance, health scoring
// ---------------------------------------------------------------------------

Deno.test("Unit: selectProvider favors cost for background_agent when health is otherwise equal", () => {
  const health: Partial<Record<ProviderName, ReturnType<typeof computeProviderHealth>>> = {
    anthropic: { provider: "anthropic", successRate: 0.9, failureCount: 1, fallbackFrequency: 0, avgLatencyMs: 500, timeoutRate: 0, costPerSuccessUsd: 0.05, sampleSize: 10 },
    openai: { provider: "openai", successRate: 0.9, failureCount: 1, fallbackFrequency: 0, avgLatencyMs: 500, timeoutRate: 0, costPerSuccessUsd: 0.005, sampleSize: 10 },
  };
  const picked = selectProvider("background_agent", ["anthropic", "openai"], health, []);
  assert(picked === "openai", `Expected openai (cheaper) for background_agent, got ${picked}`);
});

Deno.test("Unit: selectProvider returns null when every candidate is excluded", () => {
  const picked = selectProvider("business_agent", ["anthropic", "openai"], {}, ["anthropic", "openai"]);
  assert(picked === null, "Expected null when all candidates are excluded");
});

Deno.test("Unit: checkCostLimit returns ok/warning/blocked at the correct tiers", () => {
  const config = { warningPct: 0.8, limitUsd: { anthropic: 100 } };
  assert(checkCostLimit("anthropic", 50, config) === "ok", "50/100 should be ok");
  assert(checkCostLimit("anthropic", 85, config) === "warning", "85/100 should be warning");
  assert(checkCostLimit("anthropic", 100, config) === "blocked", "100/100 should be blocked");
  assert(checkCostLimit("openai", 999, config) === "ok", "Unconfigured limit should never gate");
});

Deno.test("Unit: computeProviderHealth is explainable — inputs visible, not just a single score", () => {
  const history: CallAttempt[] = [
    { provider: "anthropic", model: mockModelFor("anthropic"), outcome: "success", latencyMs: 100, estimatedCostUsd: 0.01, wasFallback: false, timedOut: false },
    { provider: "anthropic", model: mockModelFor("anthropic"), outcome: "failure", failure: { category: "rate_limit", detail: "429", shouldFailover: true }, latencyMs: 50, estimatedCostUsd: null, wasFallback: false, timedOut: false },
  ];
  const snapshot = computeProviderHealth("anthropic", history);
  assert(snapshot.sampleSize === 2, "sampleSize should reflect real evidence count");
  assert(snapshot.successRate === 0.5, `Expected successRate 0.5, got ${snapshot.successRate}`);
  assert(snapshot.failureCount === 1, "failureCount should be 1");
});

Deno.test("Unit: computeProviderHealth reports null rather than guessing with zero evidence", () => {
  const snapshot = computeProviderHealth("glm", []);
  assert(snapshot.sampleSize === 0, "sampleSize should be 0");
  assert(snapshot.successRate === null, "successRate must be null, not a guessed number, with no evidence");
});

// ---------------------------------------------------------------------------
// Test 8: Three-provider fallback chain — Anthropic -> Gemini -> OpenAI
// ---------------------------------------------------------------------------

Deno.test("Test 8: Anthropic and Gemini both fail, OpenAI (third provider) succeeds", async () => {
  const anthropic = mockAdapter("anthropic", async () => ({
    ok: false,
    httpStatus: 500,
    rawBody: { error: "anthropic internal error" },
    latencyMs: 5,
    model: mockModelFor("anthropic"),
  }));
  const gemini = mockAdapter("gemini", async () => ({
    ok: false,
    httpStatus: 429,
    rawBody: { error: { message: "gemini rate limit" } },
    latencyMs: 6,
    model: mockModelFor("gemini"),
  }));
  const openai = mockAdapter("openai", async () => ({
    ok: true,
    httpStatus: 200,
    content: "third provider succeeded",
    rawBody: {},
    inputTokens: 10,
    outputTokens: 10,
    latencyMs: 7,
    model: mockModelFor("openai"),
  }));

  const result = await callLLM(baseRequest(), baseConfig([anthropic, gemini, openai]));

  assert(result.status === "success", `Expected success, got ${result.status}`);
  assert(result.log.successful_provider === "openai", "Expected openai to succeed as the third provider");
  assert(
    result.log.attempted_providers.join(",") === "anthropic,gemini,openai",
    `Expected all three providers attempted in order, got ${result.log.attempted_providers.join(",")}`,
  );
  assert(
    result.log.attempts.map((a) => a.model).join(",") === [mockModelFor("anthropic"), mockModelFor("gemini"), mockModelFor("openai")].join(","),
    `Expected each attempt to record its own actual model, got ${JSON.stringify(result.log.attempts)}`,
  );
  assert(result.log.attempts[0].failureCategory === "provider_outage", "First attempt's failure category should be structured, not just embedded in a string");
  assert(result.log.attempts[2].outcome === "success" && result.log.attempts[2].failureCategory === null, "Successful attempt should have no failure category");
});

// ---------------------------------------------------------------------------
// Test 9: Every provider attempt is recorded in failure_reason — not just
// the last one. Regression test for the bug where buildLogEntry only kept
// the most recent failure, silently discarding evidence of earlier failures
// in the same call (see FKAIOS_PHASE6A_CALLLLM_SPECIFICATION.md Section 4).
// ---------------------------------------------------------------------------

Deno.test("Test 9: buildLogEntry records every failed attempt, not just the last failure", () => {
  const attempts: CallAttempt[] = [
    {
      provider: "anthropic",
      model: mockModelFor("anthropic"),
      outcome: "failure",
      failure: { category: "credit_exhaustion", detail: "credit balance too low", shouldFailover: true },
      latencyMs: 10,
      estimatedCostUsd: null,
      wasFallback: false,
      timedOut: false,
    },
    {
      provider: "gemini",
      model: mockModelFor("gemini"),
      outcome: "failure",
      failure: { category: "rate_limit", detail: "429 rate limited", shouldFailover: true },
      latencyMs: 12,
      estimatedCostUsd: null,
      wasFallback: true,
      timedOut: false,
    },
    {
      provider: "openai",
      model: mockModelFor("openai"),
      outcome: "failure",
      failure: { category: "provider_outage", detail: "503 service unavailable", shouldFailover: true },
      latencyMs: 8,
      estimatedCostUsd: null,
      wasFallback: true,
      timedOut: false,
    },
  ];

  const entry = buildLogEntry(baseRequest(), attempts, "failed_all_providers", null);

  assert(!!entry.failure_reason, "failure_reason should not be null");
  assert(entry.failure_reason!.includes("credit_exhaustion"), "Must record the anthropic (first) failure");
  assert(entry.failure_reason!.includes("rate_limit"), "Must record the gemini (second) failure");
  assert(entry.failure_reason!.includes("provider_outage"), "Must record the openai (third, last) failure");
  assert(entry.failure_reason!.includes("anthropic:"), "Each failure should be attributable to its provider");
  assert(entry.failure_reason!.includes("gemini:"), "Each failure should be attributable to its provider");
  assert(entry.failure_reason!.includes("openai:"), "Each failure should be attributable to its provider");
});

Deno.test("Test 9b: end-to-end callLLM — all three providers fail, log records all three failures", async () => {
  const anthropic = mockAdapter("anthropic", async () => ({
    ok: false,
    httpStatus: 400,
    rawBody: { error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API." } },
    latencyMs: 5,
    model: mockModelFor("anthropic"),
  }));
  const gemini = mockAdapter("gemini", async () => ({
    ok: false,
    httpStatus: 429,
    rawBody: { error: { message: "rate limited" } },
    latencyMs: 6,
    model: mockModelFor("gemini"),
  }));
  const openai = mockAdapter("openai", async () => ({
    ok: false,
    httpStatus: 503,
    rawBody: { error: "service unavailable" },
    latencyMs: 7,
    model: mockModelFor("openai"),
  }));

  const result = await callLLM(baseRequest(), baseConfig([anthropic, gemini, openai]));

  assert(result.status === "failed_all_providers", `Expected failed_all_providers, got ${result.status}`);
  assert(result.log.attempted_providers.length === 3, "All three providers should have been attempted");
  assert(!!result.log.failure_reason?.includes("credit_exhaustion"), "Must retain the anthropic failure even though it wasn't last");
  assert(!!result.log.failure_reason?.includes("rate_limit"), "Must retain the gemini failure even though it wasn't last");
  assert(!!result.log.failure_reason?.includes("provider_outage"), "Must record the final openai failure too");
});

// ---------------------------------------------------------------------------
// Test 10: Default provider configuration — Anthropic, Gemini, OpenAI order
// ---------------------------------------------------------------------------

Deno.test("Test 10: getConfiguredDefaultProviders returns Anthropic, Gemini, OpenAI in that order when all keys are set", () => {
  const savedAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
  const savedGemini = Deno.env.get("GEMINI_API_KEY");
  const savedOpenAI = Deno.env.get("OPENAI_API_KEY");
  try {
    Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key");
    Deno.env.set("GEMINI_API_KEY", "test-gemini-key");
    Deno.env.set("OPENAI_API_KEY", "test-openai-key");

    const providers = getConfiguredDefaultProviders();

    assert(providers.length === 3, `Expected 3 configured providers, got ${providers.length}`);
    assert(
      providers.map((p) => p.name).join(",") === "anthropic,gemini,openai",
      `Expected order anthropic,gemini,openai — got ${providers.map((p) => p.name).join(",")}`,
    );
    assert(providers[0] === anthropicAdapter, "First provider should be the anthropicAdapter singleton");
    assert(providers[1] === geminiAdapter, "Second provider should be the geminiAdapter singleton");
    assert(providers[2] === openaiAdapter, "Third provider should be the openaiAdapter singleton");
  } finally {
    if (savedAnthropic === undefined) Deno.env.delete("ANTHROPIC_API_KEY"); else Deno.env.set("ANTHROPIC_API_KEY", savedAnthropic);
    if (savedGemini === undefined) Deno.env.delete("GEMINI_API_KEY"); else Deno.env.set("GEMINI_API_KEY", savedGemini);
    if (savedOpenAI === undefined) Deno.env.delete("OPENAI_API_KEY"); else Deno.env.set("OPENAI_API_KEY", savedOpenAI);
  }
});

// ---------------------------------------------------------------------------
// Test 11: Model identity — single source of truth, env-overridable, and the
// ACTUAL model used (not one guessed from the provider name) is what ends up
// in the log/result. Regression test for the ai-engine mislabeling incident:
// ai-engine used to independently write "claude-3-haiku-20240307" for every
// anthropic call regardless of which model the router actually invoked.
// ---------------------------------------------------------------------------

Deno.test("Test 11: requested/default model differs from an env-overridden actual model, and the actual one is what gets recorded", async () => {
  await withEnv({ ANTHROPIC_MODEL: "claude-opus-4-6-test-override" }, async () => {
    let capturedModelArgSeenByAdapter: string | null = null;
    const anthropic: ProviderAdapter = {
      ...anthropicAdapter,
      call: async (_request, _timeoutMs) => {
        capturedModelArgSeenByAdapter = anthropicAdapter.getModel();
        return { ok: true, httpStatus: 200, content: "real response", rawBody: {}, inputTokens: 5, outputTokens: 5, latencyMs: 5, model: anthropicAdapter.getModel() };
      },
    };

    const result = await callLLM(baseRequest(), baseConfig([anthropic]));

    assert(capturedModelArgSeenByAdapter === "claude-opus-4-6-test-override", "Adapter should resolve the env-overridden model, not a hardcoded default");
    assert(result.model === "claude-opus-4-6-test-override", "LLMResult.model must be the actual (env-overridden) model, never the hardcoded default");
    assert(result.log.successful_model === "claude-opus-4-6-test-override", "log.successful_model must match the actual model used");
    assert(result.model !== "claude-haiku-4-5-20251001", "The stale/default model string must never leak into the result when an override is active");
  });
});

Deno.test("Test 11b: getModel() falls back to the documented default when no env override is set", () => {
  withEnvSync({ ANTHROPIC_MODEL: undefined, GEMINI_MODEL: undefined, OPENAI_MODEL: undefined }, () => {
    assert(anthropicAdapter.getModel() === "claude-haiku-4-5-20251001", `Expected default anthropic model, got ${anthropicAdapter.getModel()}`);
    assert(geminiAdapter.getModel() === "gemini-3.5-flash-lite", `Expected default gemini model, got ${geminiAdapter.getModel()}`);
    assert(openaiAdapter.getModel() === "gpt-5.6-luna", `Expected default openai model, got ${openaiAdapter.getModel()}`);
  });
});

function withEnvSync(vars: Record<string, string | undefined>, fn: () => void): void {
  const saved: Record<string, string | undefined> = {};
  for (const key of Object.keys(vars)) saved[key] = Deno.env.get(key);
  try {
    for (const [key, value] of Object.entries(vars)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
    fn();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) Deno.env.delete(key); else Deno.env.set(key, value);
    }
  }
}

// ---------------------------------------------------------------------------
// Test 14: per-function-class model override (Master Engineering Mandate
// Section 9 — "one reasoning path... provider routing underneath"). Before
// this, `founder_intelligence`'s quality-priority weighting only affected
// which PROVIDER got tried first; every class resolved to the exact same
// model per provider, so routing founder-brain.ts's reason() through this
// module would have silently downgraded it from its current hardcoded
// claude-sonnet-4-6 to this router's own cheaper ANTHROPIC_MODEL default.
// A per-class env var closes that gap without touching any existing class's
// behavior when the var is unset.
// ---------------------------------------------------------------------------

Deno.test("Test 14: a per-class env var takes priority over the global env var, which takes priority over any hardcoded default", () => {
  withEnvSync({ ANTHROPIC_MODEL: "claude-global-env-override", ANTHROPIC_MODEL_FOUNDER_INTELLIGENCE: "claude-per-class-env-override" }, () => {
    assert(anthropicAdapter.getModel("founder_intelligence") === "claude-per-class-env-override", "founder_intelligence must resolve its own per-class env var over the global one");
    assert(anthropicAdapter.getModel("business_agent") === "claude-global-env-override", "a class with no per-class env var must still fall back to the global env var");
    assert(anthropicAdapter.getModel() === "claude-global-env-override", "calling with no class at all must still resolve the global env var, unchanged from before this feature existed");
  });
});

Deno.test("Test 14b: with no env vars set at all, unlisted classes fall back to the shared hardcoded default (today's behavior, unchanged)", () => {
  withEnvSync({ ANTHROPIC_MODEL: undefined, ANTHROPIC_MODEL_FOUNDER_INTELLIGENCE: undefined }, () => {
    assert(anthropicAdapter.getModel("business_agent") === "claude-haiku-4-5-20251001", "business_agent with no override must fall back to the shared default");
    assert(anthropicAdapter.getModel("background_agent") === "claude-haiku-4-5-20251001", "background_agent with no override must fall back to the shared default");
    assert(anthropicAdapter.getModel() === "claude-haiku-4-5-20251001", "no class at all must still fall back to the shared default");
  });
});

Deno.test("Test 14d: with no env vars set at all, founder_intelligence still resolves its own hardcoded quality-tier default across all three providers -- this is the actual fix, not just the env-var plumbing", () => {
  withEnvSync({ ANTHROPIC_MODEL: undefined, ANTHROPIC_MODEL_FOUNDER_INTELLIGENCE: undefined, GEMINI_MODEL: undefined, GEMINI_MODEL_FOUNDER_INTELLIGENCE: undefined, OPENAI_MODEL: undefined, OPENAI_MODEL_FOUNDER_INTELLIGENCE: undefined }, () => {
    assert(anthropicAdapter.getModel("founder_intelligence") === "claude-sonnet-4-6", "founder_intelligence must get the quality-tier Anthropic model with zero configuration required, matching reason()'s own historical hardcoded model");
    assert(geminiAdapter.getModel("founder_intelligence") === "gemini-3.5-flash-lite", "founder_intelligence has no Gemini class default and must fall back to the shared Gemini default");
    assert(openaiAdapter.getModel("founder_intelligence") === "gpt-4o-mini", "founder_intelligence must get the quality-tier OpenAI model with zero configuration required");
    // and it must NOT leak into other classes as a side effect
    assert(anthropicAdapter.getModel("background_agent") === "claude-haiku-4-5-20251001", "founder_intelligence's dedicated default must not affect other classes");
  });
});

Deno.test("Test 14e: GEMINI_MODEL_FOUNDER_INTELLIGENCE still overrides the shared Gemini default for founder_intelligence only", () => {
  withEnvSync({ GEMINI_MODEL: undefined, GEMINI_MODEL_FOUNDER_INTELLIGENCE: "gemini-founder-override" }, () => {
    assert(geminiAdapter.getModel("founder_intelligence") === "gemini-founder-override", "the per-class env var must still win for founder_intelligence");
    assert(geminiAdapter.getModel("background_agent") === "gemini-3.5-flash-lite", "the founder override must not leak into other classes");
  });
});

Deno.test("Test 14c: callLLM() threads the request's functionClass through to the adapter for model resolution", async () => {
  await withEnv({ ANTHROPIC_MODEL: undefined, ANTHROPIC_MODEL_FOUNDER_INTELLIGENCE: "claude-sonnet-4-6-founder-only" }, async () => {
    let modelSeenByAdapter: string | null = null;
    const anthropic: ProviderAdapter = {
      ...anthropicAdapter,
      call: async (request) => {
        modelSeenByAdapter = anthropicAdapter.getModel(request.functionClass);
        return { ok: true, httpStatus: 200, content: "ok", rawBody: {}, inputTokens: 1, outputTokens: 1, latencyMs: 1, model: modelSeenByAdapter };
      },
    };

    const result = await callLLM(baseRequest({ functionClass: "founder_intelligence" }), baseConfig([anthropic]));

    assert(modelSeenByAdapter === "claude-sonnet-4-6-founder-only", `expected the founder_intelligence override, got ${modelSeenByAdapter}`);
    assert(result.model === "claude-sonnet-4-6-founder-only", "the router's own result.model must reflect the class-specific model actually used");
  });
});

Deno.test("Test 11c: failover records the ACTUAL provider and model that answered, not the originally requested one", async () => {
  await withEnv({ ANTHROPIC_MODEL: undefined, GEMINI_MODEL: "gemini-test-override" }, async () => {
    const anthropic = mockAdapter("anthropic", async () => ({
      ok: false, httpStatus: 500, rawBody: { error: "outage" }, latencyMs: 5, model: mockModelFor("anthropic"),
    }));
    const gemini: ProviderAdapter = {
      ...geminiAdapter,
      call: async () => ({ ok: true, httpStatus: 200, content: "gemini answered", rawBody: {}, inputTokens: 3, outputTokens: 3, latencyMs: 4, model: geminiAdapter.getModel() }),
    };

    const result = await callLLM(baseRequest(), baseConfig([anthropic, gemini]));

    assert(result.log.requested_provider === "anthropic", "requested_provider should be the first one tried");
    assert(result.log.successful_provider === "gemini", "The provider that actually answered must be recorded as successful_provider");
    assert(result.log.successful_model === "gemini-test-override", "The actual (env-overridden) model that answered must be recorded, never assumed from the provider name");
    assert(result.model === "gemini-test-override", "Top-level result.model must reflect the actual answering model");
  });
});

// ---------------------------------------------------------------------------
// Test 12: Structured output — an Anthropic tool schema forces tool_choice
// and the tool's input is extracted as toolCall, not left for the caller to
// regex out of free-form text.
// ---------------------------------------------------------------------------

Deno.test("Test 12: Anthropic adapter sends tool_choice and extracts toolCall when a tool schema is supplied", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key", ANTHROPIC_MODEL: "claude-test-model" }, async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(
        JSON.stringify({
          content: [{ type: "tool_use", name: "emit_invoice", input: { line_items: [{ description: "Consulting", quantity: 1, unit_price_inr: 5000 }] } }],
          usage: { input_tokens: 40, output_tokens: 20 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      const request = baseRequest({
        toolSchema: { name: "emit_invoice", description: "Emit the invoice", input_schema: { type: "object", properties: { line_items: { type: "array" } } } },
      });
      const response = await anthropicAdapter.call(request, 5000);

      assert(capturedBody !== null, "fetch should have been called");
      const body = capturedBody as unknown as Record<string, unknown>;
      assert(Array.isArray(body.tools) && body.tools.length === 1, "Request body must include the tool schema in tools[]");
      assert(JSON.stringify(body.tool_choice) === JSON.stringify({ type: "tool", name: "emit_invoice" }), "tool_choice must force the exact tool by name");
      assert(response.ok === true, "Response should be ok");
      assert(
        JSON.stringify(response.toolCall) === JSON.stringify({ line_items: [{ description: "Consulting", quantity: 1, unit_price_inr: 5000 }] }),
        `toolCall should be extracted from the tool_use content block, got ${JSON.stringify(response.toolCall)}`,
      );
      assert(response.model === "claude-test-model", "Response must carry the actual model used");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

Deno.test("Test 12b: Anthropic adapter omits tools entirely when no toolSchema is supplied (unchanged behavior)", async () => {
  await withEnv({ ANTHROPIC_API_KEY: "test-key" }, async () => {
    const originalFetch = globalThis.fetch;
    let capturedBody: Record<string, unknown> | null = null;
    globalThis.fetch = (async (_url: string | URL | Request, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ content: [{ type: "text", text: "plain answer" }], usage: { input_tokens: 5, output_tokens: 5 } }), { status: 200, headers: { "Content-Type": "application/json" } });
    }) as typeof fetch;

    try {
      const request = baseRequest({ toolSchema: undefined });
      const response = await anthropicAdapter.call(request, 5000);
      const body = capturedBody as unknown as Record<string, unknown>;
      assert(!("tools" in body), "tools must not be sent when no toolSchema is provided");
      assert(!("tool_choice" in body), "tool_choice must not be sent when no toolSchema is provided");
      assert(response.content === "plain answer", "Plain text content must still be extracted normally");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

// ---------------------------------------------------------------------------
// Test 13: Provider enablement is configuration (an explicit kill switch),
// not a hardcoded list — used to stop calling a provider known to be
// unavailable (e.g. OpenAI with zero credits) without removing its API key.
// ---------------------------------------------------------------------------

Deno.test("Test 13: PROVIDER_OPENAI_ENABLED=false removes openai from candidates even though its API key is configured", async () => {
  await withEnv(
    { ANTHROPIC_API_KEY: "k1", GEMINI_API_KEY: undefined, OPENAI_API_KEY: "k2", PROVIDER_OPENAI_ENABLED: "false" },
    () => {
      const providers = getConfiguredDefaultProviders();
      assert(providers.map((p) => p.name).join(",") === "anthropic", `Expected openai to be excluded by its kill switch, got ${providers.map((p) => p.name).join(",")}`);
    },
  );
});

Deno.test("Test 10b: getConfiguredDefaultProviders omits providers with no configured key", () => {
  const savedAnthropic = Deno.env.get("ANTHROPIC_API_KEY");
  const savedGemini = Deno.env.get("GEMINI_API_KEY");
  const savedOpenAI = Deno.env.get("OPENAI_API_KEY");
  try {
    Deno.env.set("ANTHROPIC_API_KEY", "test-anthropic-key");
    Deno.env.delete("GEMINI_API_KEY");
    Deno.env.set("OPENAI_API_KEY", "test-openai-key");

    const providers = getConfiguredDefaultProviders();

    assert(
      providers.map((p) => p.name).join(",") === "anthropic,openai",
      `Expected gemini to be skipped when unconfigured — got ${providers.map((p) => p.name).join(",")}`,
    );
  } finally {
    if (savedAnthropic === undefined) Deno.env.delete("ANTHROPIC_API_KEY"); else Deno.env.set("ANTHROPIC_API_KEY", savedAnthropic);
    if (savedGemini === undefined) Deno.env.delete("GEMINI_API_KEY"); else Deno.env.set("GEMINI_API_KEY", savedGemini);
    if (savedOpenAI === undefined) Deno.env.delete("OPENAI_API_KEY"); else Deno.env.set("OPENAI_API_KEY", savedOpenAI);
  }
});
