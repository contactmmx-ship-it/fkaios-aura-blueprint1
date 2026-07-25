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
  type ProviderAdapter,
  type ProviderName,
  type LLMRequest,
  type RawProviderResponse,
  type RouterConfig,
  type CallAttempt,
} from "./llm-router.ts";

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

function mockAdapter(
  name: ProviderName,
  impl: (request: LLMRequest, timeoutMs: number) => Promise<RawProviderResponse>,
): ProviderAdapter {
  return {
    name,
    call: impl,
    estimateCost: () => 0.001,
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
  }));

  const openai = mockAdapter("openai", async () => ({
    ok: true,
    httpStatus: 200,
    content: "Real fallback response",
    rawBody: { choices: [{ message: { content: "Real fallback response" } }] },
    inputTokens: 20,
    outputTokens: 15,
    latencyMs: 12,
  }));

  const result = await callLLM(baseRequest(), baseConfig([anthropic, openai]));

  assert(result.status === "success", `Expected success, got ${result.status}`);
  assert(result.content === "Real fallback response", "Fallback content missing or wrong");
  assert(result.log.successful_provider === "openai", "Expected openai as successful_provider");
  assert(result.log.attempted_providers.includes("anthropic"), "anthropic should appear in attempted_providers");
  assert(!!result.log.failure_reason?.includes("credit_exhaustion"), "failure_reason should record credit_exhaustion");
});

Deno.test("Unit: classifyLLMFailure recognizes the exact live credit-exhaustion message shape", () => {
  const response: RawProviderResponse = {
    ok: false,
    httpStatus: 400,
    rawBody: { error: { message: "Your credit balance is too low to access the Anthropic API." } },
    latencyMs: 5,
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
  }));
  const secondary = mockAdapter("deepseek", async () => ({
    ok: true,
    httpStatus: 200,
    content: "fallback ok",
    rawBody: {},
    latencyMs: 8,
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
    return { ok: true, httpStatus: 200, content: "too late", rawBody: {}, latencyMs: timeoutMs + 100 };
  });

  const fast = mockAdapter("openai", async () => ({
    ok: true,
    httpStatus: 200,
    content: "fast success",
    rawBody: {},
    latencyMs: 5,
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
  }));
  const secondary = mockAdapter("openai", async () => {
    secondaryCalled = true;
    return { ok: true, httpStatus: 200, content: "should never be reached", rawBody: {}, latencyMs: 3 };
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
    mockAdapter(name, async () => ({ ok: false, httpStatus: 503, rawBody: { error: "service unavailable" }, latencyMs: 5 }));

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
    return { ok: true, httpStatus: 200, content: "ok", rawBody: {}, latencyMs: 5 };
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
    { provider: "anthropic", outcome: "success", latencyMs: 100, estimatedCostUsd: 0.01, wasFallback: false, timedOut: false },
    { provider: "anthropic", outcome: "failure", failure: { category: "rate_limit", detail: "429", shouldFailover: true }, latencyMs: 50, estimatedCostUsd: null, wasFallback: false, timedOut: false },
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
