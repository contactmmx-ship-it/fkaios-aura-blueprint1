// FKAIOS Shared LLM Router — Phase 6A Step 2
//
// Provider reliability and routing layer. Routes requests, classifies
// failures, manages fallback attempts, and produces structured telemetry.
//
// This module NEVER rewrites prompts, system instructions, tool schemas, or
// makes business decisions — it only decides which provider transports an
// already fully-formed request. Preserve -> Enhance -> Extend.
//
// This file owns every provider adapter (Anthropic, OpenAI). Calling
// functions (e.g. ai-engine) never construct or hold adapters themselves —
// they import buildDefaultRouterConfig() and callLLM(), nothing else.

export type ProviderName = "anthropic" | "openai" | "deepseek" | "glm";

export type FunctionClass =
  | "founder_intelligence" // quality priority
  | "business_agent" // reliability priority
  | "background_agent" // cost efficiency priority
  | "customer_agent"; // balanced priority

export type FailureCategory =
  | "authentication_failure"
  | "rate_limit"
  | "credit_exhaustion"
  | "timeout"
  | "invalid_request"
  | "provider_outage"
  | "invalid_response";

export interface LLMRequest {
  systemPrompt: string;
  userContent: string;
  /** Passed through untouched. The router never edits this. */
  toolSchema?: unknown;
  maxTokens?: number;
  temperature?: number;
  /** Calling engine, e.g. "ai-engine". Used for logging only. */
  functionName: string;
  agentName?: string;
  functionClass: FunctionClass;
}

export interface RawProviderResponse {
  ok: boolean;
  httpStatus: number;
  content?: string;
  toolCall?: unknown;
  rawBody: unknown;
  inputTokens?: number;
  outputTokens?: number;
  latencyMs: number;
}

export interface ClassifiedFailure {
  category: FailureCategory;
  detail: string;
  /** false only for invalid_request in Phase 6A — retrying a malformed request on another provider just fails again identically. */
  shouldFailover: boolean;
}

export interface ProviderHealthSnapshot {
  provider: ProviderName;
  successRate: number | null;
  failureCount: number;
  fallbackFrequency: number | null;
  avgLatencyMs: number | null;
  timeoutRate: number | null;
  costPerSuccessUsd: number | null;
  /** Explainability: callers can see how much evidence backs this snapshot, never a black-box score. */
  sampleSize: number;
}

export interface CallAttempt {
  provider: ProviderName;
  outcome: "success" | "failure";
  failure?: ClassifiedFailure;
  latencyMs: number;
  estimatedCostUsd: number | null;
  wasFallback: boolean;
  timedOut: boolean;
}

export interface LLMCallLogEntry {
  function_name: string;
  agent_name: string | null;
  requested_provider: ProviderName;
  attempted_providers: ProviderName[];
  failure_reason: string | null;
  successful_provider: ProviderName | null;
  latency_ms: number;
  token_usage: { input: number; output: number } | null;
  estimated_cost_usd: number | null;
  final_result_status: "success" | "failed_all_providers" | "invalid_response_received";
}

export interface LLMResult {
  status: "success" | "failed_all_providers" | "invalid_response_received";
  content?: string;
  toolCall?: unknown;
  log: LLMCallLogEntry;
}

/**
 * The interface every provider implementation conforms to. Tests supply mock
 * adapters conforming to this same interface; production callers use the
 * concrete adapters defined below via buildDefaultRouterConfig().
 */
export interface ProviderAdapter {
  name: ProviderName;
  call(request: LLMRequest, timeoutMs: number): Promise<RawProviderResponse>;
  estimateCost(request: LLMRequest, response?: RawProviderResponse): number;
  health(): ProviderHealthSnapshot;
}

export interface CostConfig {
  /** e.g. 0.8 for an 80% warning threshold. */
  warningPct: number;
  limitUsd: Partial<Record<ProviderName, number>>;
}

export interface RouterConfig {
  providers: ProviderAdapter[];
  costConfig: CostConfig;
  retryLimitByClass: Record<FunctionClass, number>;
  timeoutMsByClass: Record<FunctionClass, number>;
}

// ---------------------------------------------------------------------------
// Provider Adapters — Anthropic, OpenAI
//
// Concrete implementations owned entirely by this module, placed before the
// router execution functions below. Those functions operate only against the
// ProviderAdapter interface and never call a provider's HTTP endpoint
// directly themselves.
// ---------------------------------------------------------------------------

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") ?? "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") ?? "";

const DEFAULT_PRICING = {
  anthropic: { inputPerMtok: 0.25, outputPerMtok: 1.25 },
  openai: { inputPerMtok: 0.15, outputPerMtok: 0.60 },
} as const;

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",
  async call(request) {
    // API-key validation before making any HTTP request — an honest,
    // immediate failure rather than firing a request with a blank
    // Authorization header.
    if (!ANTHROPIC_API_KEY) {
      return { ok: false, httpStatus: 401, rawBody: { error: "ANTHROPIC_API_KEY is not configured" }, latencyMs: 0 };
    }
    const model = "claude-3-haiku-20240307";
    const maxTokens = request.maxTokens ?? 4096;
    const start = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: request.systemPrompt, messages: [{ role: "user", content: request.userContent }] }),
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      let parsedBody: unknown = text;
      try { parsedBody = JSON.parse(text); } catch { /* keep as raw text */ }
      return { ok: false, httpStatus: response.status, rawBody: parsedBody, latencyMs };
    }
    const data = await response.json();
    return {
      ok: true,
      httpStatus: response.status,
      content: data?.content?.[0]?.text ?? "",
      rawBody: data,
      inputTokens: data?.usage?.input_tokens ?? 0,
      outputTokens: data?.usage?.output_tokens ?? 0,
      latencyMs,
    };
  },
  estimateCost(_request, response) {
    const pricing = DEFAULT_PRICING.anthropic;
    return ((response?.inputTokens ?? 0) / 1_000_000) * pricing.inputPerMtok + ((response?.outputTokens ?? 0) / 1_000_000) * pricing.outputPerMtok;
  },
  health() {
    // No rolling health history wired in yet — an honest "no evidence"
    // snapshot rather than a guessed number.
    return { provider: "anthropic", successRate: null, failureCount: 0, fallbackFrequency: null, avgLatencyMs: null, timeoutRate: null, costPerSuccessUsd: null, sampleSize: 0 };
  },
};

export const openaiAdapter: ProviderAdapter = {
  name: "openai",
  async call(request) {
    if (!OPENAI_API_KEY) {
      return { ok: false, httpStatus: 401, rawBody: { error: "OPENAI_API_KEY is not configured" }, latencyMs: 0 };
    }
    const model = "gpt-4o-mini";
    const maxTokens = request.maxTokens ?? 8192;
    const start = Date.now();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: request.systemPrompt }, { role: "user", content: request.userContent }] }),
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      let parsedBody: unknown = text;
      try { parsedBody = JSON.parse(text); } catch { /* keep as raw text */ }
      return { ok: false, httpStatus: response.status, rawBody: parsedBody, latencyMs };
    }
    const data = await response.json();
    return {
      ok: true,
      httpStatus: response.status,
      content: data?.choices?.[0]?.message?.content ?? "",
      rawBody: data,
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      latencyMs,
    };
  },
  estimateCost(_request, response) {
    const pricing = DEFAULT_PRICING.openai;
    return ((response?.inputTokens ?? 0) / 1_000_000) * pricing.inputPerMtok + ((response?.outputTokens ?? 0) / 1_000_000) * pricing.outputPerMtok;
  },
  health() {
    return { provider: "openai", successRate: null, failureCount: 0, fallbackFrequency: null, avgLatencyMs: null, timeoutRate: null, costPerSuccessUsd: null, sampleSize: 0 };
  },
};

/** Providers with a configured API key, in default preference order (Anthropic first). */
export function getConfiguredDefaultProviders(): ProviderAdapter[] {
  const providers: ProviderAdapter[] = [];
  if (ANTHROPIC_API_KEY) providers.push(anthropicAdapter);
  if (OPENAI_API_KEY) providers.push(openaiAdapter);
  return providers;
}

/**
 * Ready-to-use RouterConfig built from whichever provider keys are actually
 * configured. Calling functions import and pass this straight to callLLM() —
 * they never assemble their own provider list or adapters.
 */
export function buildDefaultRouterConfig(): RouterConfig {
  return {
    providers: getConfiguredDefaultProviders(),
    costConfig: { warningPct: 0.8, limitUsd: {} },
    retryLimitByClass: { founder_intelligence: 3, business_agent: 3, background_agent: 2, customer_agent: 2 },
    timeoutMsByClass: { founder_intelligence: 60000, business_agent: 60000, background_agent: 30000, customer_agent: 15000 },
  };
}

// ---------------------------------------------------------------------------
// Failure Classification
// ---------------------------------------------------------------------------

const CREDIT_EXHAUSTION_PATTERNS = [
  /credit balance is too low/i,
  /insufficient_quota/i,
  /insufficient quota/i,
  /insufficient balance/i,
];

const AUTH_FAILURE_STATUS = new Set([401, 403]);
const OUTAGE_STATUS_MIN = 500;

/**
 * Classifies a failed provider response into one of the seven failure
 * categories, and whether that category should trigger failover to the next
 * configured provider. HTTP success is not, on its own, evidence of
 * intelligence success — callers must check for empty/invalid content
 * separately (see isEmptyOrInvalidContent) before treating a 200 as real.
 */
export function classifyLLMFailure(response: RawProviderResponse | null, error?: unknown): ClassifiedFailure {
  if (!response) {
    // Thrown before any response was received (connection failure, DNS, etc.)
    // Timeouts are classified explicitly by the caller (see callLLM), not here.
    const message = error instanceof Error ? error.message : String(error ?? "unknown error");
    return { category: "provider_outage", detail: message, shouldFailover: true };
  }

  const bodyText = safeStringify(response.rawBody);

  if (CREDIT_EXHAUSTION_PATTERNS.some((p) => p.test(bodyText))) {
    return { category: "credit_exhaustion", detail: bodyText.slice(0, 300), shouldFailover: true };
  }

  if (response.httpStatus === 429) {
    return { category: "rate_limit", detail: bodyText.slice(0, 300), shouldFailover: true };
  }

  if (AUTH_FAILURE_STATUS.has(response.httpStatus)) {
    // Fail over so the call still has a chance to succeed, but this is logged
    // as a distinct category so a persistently-failing key doesn't hide as a
    // routine failover — see FKAIOS_PHASE6A_CALLLLM_SPECIFICATION.md, Section 3.
    return { category: "authentication_failure", detail: bodyText.slice(0, 300), shouldFailover: true };
  }

  if (response.httpStatus >= OUTAGE_STATUS_MIN) {
    return { category: "provider_outage", detail: bodyText.slice(0, 300), shouldFailover: true };
  }

  if (!response.ok && response.httpStatus >= 400 && response.httpStatus < 500) {
    // Any remaining 4xx (not auth, not rate limit) is a malformed/invalid
    // request. Never fail over — retrying an identical bad request against a
    // different provider wastes cost and fails identically.
    return { category: "invalid_request", detail: bodyText.slice(0, 300), shouldFailover: false };
  }

  if (response.ok && isEmptyOrInvalidContent(response)) {
    // HTTP success but no usable content: the "No Fake Intelligence" case.
    // Worth trying the next provider (this looks like a provider-quality
    // issue, not a bug in our request), but this response itself must never
    // be treated as success by the caller.
    return {
      category: "invalid_response",
      detail: "HTTP success but empty, malformed, or unusable response content",
      shouldFailover: true,
    };
  }

  // Defensive fallback — should be unreachable if callers only invoke this on
  // an actual failure path.
  return { category: "provider_outage", detail: `Unclassified failure at status ${response.httpStatus}`, shouldFailover: true };
}

function isEmptyOrInvalidContent(response: RawProviderResponse): boolean {
  const hasText = typeof response.content === "string" && response.content.trim().length > 0;
  const hasToolCall = response.toolCall !== undefined && response.toolCall !== null;
  return !hasText && !hasToolCall;
}

function safeStringify(value: unknown): string {
  if (typeof value === "string") return value;
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

// ---------------------------------------------------------------------------
// Routing
// ---------------------------------------------------------------------------

/**
 * Priority weighting per function class, per the Founder-approved routing
 * strategy (PHASE6A_CALLLLM_APPROVAL_REVIEW.md, Section 2.1). Intentionally
 * simple and explainable — not a hidden scoring model. Ties are broken by
 * whichever provider was declared first in RouterConfig.providers.
 */
const CLASS_PRIORITY: Record<FunctionClass, { quality: number; reliability: number; cost: number; latency: number }> = {
  founder_intelligence: { quality: 1.0, reliability: 0.4, cost: 0.1, latency: 0.3 },
  business_agent: { quality: 0.5, reliability: 1.0, cost: 0.3, latency: 0.3 },
  background_agent: { quality: 0.3, reliability: 0.4, cost: 1.0, latency: 0.1 },
  customer_agent: { quality: 0.6, reliability: 0.6, cost: 0.4, latency: 0.7 },
};

/**
 * Selects the next provider to try, given the calling function's class,
 * whatever health evidence exists so far, and providers already excluded
 * (e.g. because they already failed this call). Returns null when no
 * candidate remains.
 */
export function selectProvider(
  functionClass: FunctionClass,
  candidates: ProviderName[],
  health: Partial<Record<ProviderName, ProviderHealthSnapshot>>,
  excluded: ProviderName[] = [],
): ProviderName | null {
  const priority = CLASS_PRIORITY[functionClass];
  const available = candidates.filter((p) => !excluded.includes(p));
  if (available.length === 0) return null;

  let best: ProviderName = available[0];
  let bestScore = -Infinity;

  for (const provider of available) {
    const snapshot = health[provider];
    // With no evidence yet, treat a provider as neutral (0.5) on every
    // dimension rather than penalizing it for lack of data.
    const reliability = snapshot?.successRate ?? 0.5;
    const costScore = snapshot?.costPerSuccessUsd != null ? 1 / (1 + snapshot.costPerSuccessUsd) : 0.5;
    const latencyScore = snapshot?.avgLatencyMs != null ? 1 / (1 + snapshot.avgLatencyMs / 1000) : 0.5;
    // Output quality cannot be measured directly by this router (that would
    // require grading responses, out of scope for Step 2); expressed as a
    // neutral constant until a real quality signal is defined.
    const quality = 0.5;

    const score =
      priority.quality * quality +
      priority.reliability * reliability +
      priority.cost * costScore +
      priority.latency * latencyScore;

    if (score > bestScore) {
      bestScore = score;
      best = provider;
    }
  }

  return best;
}

// ---------------------------------------------------------------------------
// Cost Governance — telemetry hooks only. No database writes, no Supabase
// calls, no migrations, no persistence of any kind in Phase 6A Step 2.
// ---------------------------------------------------------------------------

export function estimateCost(adapter: ProviderAdapter, request: LLMRequest, response?: RawProviderResponse): number {
  return adapter.estimateCost(request, response);
}

/** Tiered per the Founder-approved cost policy: warning at ~80%, blocked at 100%. No limits are hardcoded — both come from RouterConfig. */
export function checkCostLimit(provider: ProviderName, periodCostUsd: number, config: CostConfig): "ok" | "warning" | "blocked" {
  const limit = config.limitUsd[provider];
  if (limit === undefined || limit <= 0) return "ok"; // no configured limit = no gating
  const ratio = periodCostUsd / limit;
  if (ratio >= 1) return "blocked";
  if (ratio >= config.warningPct) return "warning";
  return "ok";
}

/**
 * Telemetry-only accumulator. Records a cost observation into whatever
 * in-memory structure the caller supplies. Does not write to a database,
 * call Supabase, or persist anything — persistence is explicitly out of
 * scope for Phase 6A Step 2.
 */
export function recordCost(accumulator: Partial<Record<ProviderName, number>>, provider: ProviderName, costUsd: number): void {
  accumulator[provider] = (accumulator[provider] ?? 0) + costUsd;
}

// ---------------------------------------------------------------------------
// Provider Health — explainable. Every input is visible on the snapshot;
// there is no opaque combined score.
// ---------------------------------------------------------------------------

export function computeProviderHealth(provider: ProviderName, callHistory: CallAttempt[]): ProviderHealthSnapshot {
  const relevant = callHistory.filter((c) => c.provider === provider);
  const sampleSize = relevant.length;

  if (sampleSize === 0) {
    return {
      provider,
      successRate: null,
      failureCount: 0,
      fallbackFrequency: null,
      avgLatencyMs: null,
      timeoutRate: null,
      costPerSuccessUsd: null,
      sampleSize: 0,
    };
  }

  const successes = relevant.filter((c) => c.outcome === "success");
  const failures = relevant.filter((c) => c.outcome === "failure");
  const fallbacks = relevant.filter((c) => c.wasFallback);
  const timeouts = relevant.filter((c) => c.timedOut);
  const totalLatency = relevant.reduce((sum, c) => sum + c.latencyMs, 0);
  const successCosts = successes.map((c) => c.estimatedCostUsd).filter((c): c is number => c != null);

  return {
    provider,
    successRate: successes.length / sampleSize,
    failureCount: failures.length,
    fallbackFrequency: fallbacks.length / sampleSize,
    avgLatencyMs: totalLatency / sampleSize,
    timeoutRate: timeouts.length / sampleSize,
    costPerSuccessUsd: successCosts.length > 0 ? successCosts.reduce((a, b) => a + b, 0) / successCosts.length : null,
    sampleSize,
  };
}

// ---------------------------------------------------------------------------
// Logging
// ---------------------------------------------------------------------------

export function buildLogEntry(
  request: LLMRequest,
  attempts: CallAttempt[],
  status: LLMCallLogEntry["final_result_status"],
  tokenUsage: { input: number; output: number } | null,
): LLMCallLogEntry {
  const successfulAttempt = attempts.find((a) => a.outcome === "success");
  const lastFailure = [...attempts].reverse().find((a) => a.failure)?.failure;
  const totalLatency = attempts.reduce((sum, a) => sum + a.latencyMs, 0);
  const totalCost = attempts.reduce((sum, a) => sum + (a.estimatedCostUsd ?? 0), 0);

  return {
    function_name: request.functionName,
    agent_name: request.agentName ?? null,
    requested_provider: attempts[0]?.provider ?? ("anthropic" as ProviderName),
    attempted_providers: attempts.map((a) => a.provider),
    failure_reason: lastFailure ? `${lastFailure.category}: ${lastFailure.detail}` : null,
    successful_provider: successfulAttempt?.provider ?? null,
    latency_ms: totalLatency,
    token_usage: tokenUsage,
    estimated_cost_usd: attempts.length > 0 ? totalCost : null,
    final_result_status: status,
  };
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

class TimeoutError extends Error {}

async function callWithTimeout(adapter: ProviderAdapter, request: LLMRequest, timeoutMs: number): Promise<RawProviderResponse> {
  return await Promise.race([
    adapter.call(request, timeoutMs),
    new Promise<RawProviderResponse>((_, reject) => {
      setTimeout(() => reject(new TimeoutError(`Provider ${adapter.name} exceeded ${timeoutMs}ms`)), timeoutMs);
    }),
  ]);
}

/**
 * The single entry point. Selects a provider, calls it, validates the
 * response (HTTP success is not intelligence success), classifies any
 * failure, and fails over according to the calling function's class policy.
 * Never returns a fabricated success. The request payload (prompt, tool
 * schema, temperature, max tokens) passes through completely unchanged to
 * whichever provider is selected.
 */
export async function callLLM(request: LLMRequest, config: RouterConfig): Promise<LLMResult> {
  const timeoutMs = config.timeoutMsByClass[request.functionClass];
  const retryLimit = config.retryLimitByClass[request.functionClass];

  const health: Partial<Record<ProviderName, ProviderHealthSnapshot>> = {};
  for (const adapter of config.providers) {
    health[adapter.name] = adapter.health();
  }

  const candidates = config.providers.map((p) => p.name);
  const attempts: CallAttempt[] = [];
  const excluded: ProviderName[] = [];
  let tokenUsage: { input: number; output: number } | null = null;

  while (attempts.length < retryLimit) {
    const providerName = selectProvider(request.functionClass, candidates, health, excluded);
    if (providerName === null) break; // no more providers left to try

    const adapter = config.providers.find((p) => p.name === providerName)!;
    const wasFallback = attempts.length > 0;
    const start = Date.now();

    let response: RawProviderResponse | null = null;
    let thrown: unknown;
    try {
      response = await callWithTimeout(adapter, request, timeoutMs);
    } catch (err) {
      thrown = err;
    }

    const latencyMs = Date.now() - start;
    const timedOut = thrown instanceof TimeoutError;

    if (response && response.ok && !isEmptyOrInvalidContent(response)) {
      // Real success — a genuine, usable response was received.
      tokenUsage = { input: response.inputTokens ?? 0, output: response.outputTokens ?? 0 };
      const cost = adapter.estimateCost(request, response);
      attempts.push({ provider: providerName, outcome: "success", latencyMs, estimatedCostUsd: cost, wasFallback, timedOut: false });
      return {
        status: "success",
        content: response.content,
        toolCall: response.toolCall,
        log: buildLogEntry(request, attempts, "success", tokenUsage),
      };
    }

    // Failure path: thrown, non-ok response, or empty/invalid content.
    const failure = timedOut
      ? { category: "timeout" as const, detail: `No response within ${timeoutMs}ms`, shouldFailover: true }
      : classifyLLMFailure(response, thrown);

    attempts.push({
      provider: providerName,
      outcome: "failure",
      failure,
      latencyMs,
      estimatedCostUsd: response ? adapter.estimateCost(request, response) : null,
      wasFallback,
      timedOut,
    });

    if (!failure.shouldFailover) {
      // invalid_request in Phase 6A: stop immediately, do not try another
      // provider — retrying an identical malformed request elsewhere just
      // fails again at someone else's cost.
      return { status: "failed_all_providers", log: buildLogEntry(request, attempts, "failed_all_providers", tokenUsage) };
    }

    excluded.push(providerName);
  }

  // Every configured provider (up to the retry limit) has now failed. Report
  // honestly which kind of failure this was: garbled-but-present responses
  // (invalid_response_received) are a different situation from every
  // provider being genuinely unavailable (failed_all_providers) — never
  // collapse the two into a generic success-adjacent status.
  const anyInvalidResponse = attempts.some((a) => a.failure?.category === "invalid_response");
  const finalStatus = anyInvalidResponse ? "invalid_response_received" : "failed_all_providers";
  return { status: finalStatus, log: buildLogEntry(request, attempts, finalStatus, tokenUsage) };
}
