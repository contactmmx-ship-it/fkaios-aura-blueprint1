import { createClient } from "npm:@supabase/supabase-js@2.57.4";
// FKAIOS Shared LLM Router — Phase 6A Step 2
//
// Provider reliability and routing layer. Routes requests, classifies
// failures, manages fallback attempts, and produces structured telemetry.
//
// This module NEVER rewrites prompts, system instructions, tool schemas, or
// makes business decisions — it only decides which provider transports an
// already fully-formed request. Preserve -> Enhance -> Extend.
//
// This file owns every provider adapter (Anthropic, Gemini, OpenAI). Calling
// functions (e.g. ai-engine) never construct or hold adapters themselves —
// they import buildDefaultRouterConfig() and callLLM(), nothing else.

export type ProviderName = "anthropic" | "gemini" | "openai" | "deepseek" | "glm" | "openrouter" | "groq" | "mistral" | "huggingface" | "self_hosted";

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
  | "invalid_response"
  /** The requested model does not exist or is not served for this key (404). Other models of the same provider may still work. */
  | "model_unavailable";

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
  /** Exact model to use for this call. When absent, the adapter's own default resolution applies (unchanged behaviour). */
  model?: string;
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
  /** The exact model identifier this attempt was made with — never inferred by a caller after the fact. */
  model: string;
  /** True when the provider stopped because the output-token limit was reached (the content is a prefix). */
  truncated?: boolean;
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
  inputTokens?: number;
  outputTokens?: number;
  /** The actual model identifier used for this attempt — resolved once, at call time, never re-derived from `provider` afterward. */
  model: string;
  outcome: "success" | "failure";
  failure?: ClassifiedFailure;
  latencyMs: number;
  estimatedCostUsd: number | null;
  wasFallback: boolean;
  timedOut: boolean;
}

/** A caller-facing, structured record of one attempt — the basis for both cost/telemetry tables and provider-health decisions. Never reconstruct this by parsing `failure_reason` strings. */
export interface AttemptRecord {
  provider: ProviderName;
  model: string;
  outcome: "success" | "failure";
  wasFallback: boolean;
  failureCategory: FailureCategory | null;
  latencyMs?: number;
  estimatedCostUsd?: number | null;
  failureDetail?: string | null;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMCallLogEntry {
  function_name: string;
  agent_name: string | null;
  requested_provider: ProviderName;
  attempted_providers: ProviderName[];
  failure_reason: string | null;
  successful_provider: ProviderName | null;
  /** The actual model that produced the successful response, or null if every attempt failed. */
  successful_model: string | null;
  /** Structured per-attempt outcomes — provider, actual model, and failure category (if any) for every attempt made, in order. */
  attempts: AttemptRecord[];
  latency_ms: number;
  token_usage: { input: number; output: number } | null;
  estimated_cost_usd: number | null;
  final_result_status: "success" | "failed_all_providers" | "invalid_response_received";
}

export interface LLMResult {
  status: "success" | "failed_all_providers" | "invalid_response_received";
  content?: string;
  toolCall?: unknown;
  /** The actual model that produced this result (successful attempt only). Null on failure — see log.attempts for what was actually tried. */
  model?: string;
  /** The successful response stopped at the output-token limit; content is incomplete. */
  truncated?: boolean;
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
  /**
   * The model identifier this adapter will use right now for the given
   * function class (env-overridable per class or globally, resolved lazily
   * — see getAnthropicModel() etc. below). Exists so a failed attempt that
   * never got as far as a RawProviderResponse (a thrown network error, a
   * timeout) can still be attributed to the correct model. functionClass is
   * optional so existing callers with no class in scope still resolve the
   * global/default model exactly as before.
   */
  getModel(functionClass?: FunctionClass): string;
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
// Provider Adapters — Anthropic, Gemini, OpenAI
//
// Concrete implementations owned entirely by this module, placed before the
// router execution functions below. Those functions operate only against the
// ProviderAdapter interface and never call a provider's HTTP endpoint
// directly themselves.
//
// API keys are read lazily (per call) rather than cached into module-level
// constants at import time — this lets tests (and a Supabase Edge Function
// warm start) observe env vars set after the module first loads, which
// matters for getConfiguredDefaultProviders() below.
// ---------------------------------------------------------------------------

function getAnthropicApiKey(): string {
  return Deno.env.get("ANTHROPIC_API_KEY") ?? "";
}
function getGeminiApiKey(): string {
  return Deno.env.get("GEMINI_API_KEY") ?? "";
}
function getOpenAIApiKey(): string {
  return Deno.env.get("OPENAI_API_KEY") ?? "";
}
function getOpenRouterApiKey(): string { return Deno.env.get("OPENROUTER_API_KEY") ?? ""; }
function getGroqApiKey(): string { return Deno.env.get("GROQ_API_KEY") ?? ""; }
function getMistralApiKey(): string { return Deno.env.get("MISTRAL_API_KEY") ?? ""; }
function getHuggingFaceApiKey(): string { return Deno.env.get("HUGGINGFACE_API_KEY") ?? ""; }
function getSelfHostedBaseUrl(): string { return Deno.env.get("SELF_HOSTED_LLM_BASE_URL") ?? ""; }
function getSelfHostedApiKey(): string { return Deno.env.get("SELF_HOSTED_LLM_API_KEY") ?? ""; }
function getSelfHostedModel(functionClass?: FunctionClass): string { return resolveModel("SELF_HOSTED_LLM_MODEL", "qwen2.5:14b", {}, functionClass); }

const HEALTH_COOLDOWN_MS: Record<FailureCategory, number> = {
  authentication_failure: 24 * 60 * 60 * 1000,
  rate_limit: 2 * 60 * 1000,
  credit_exhaustion: 6 * 60 * 60 * 1000,
  timeout: 5 * 60 * 1000,
  invalid_request: 0,
  provider_outage: 5 * 60 * 1000,
  invalid_response: 10 * 60 * 1000,
  // Model-scoped, recorded on the model's own registry row, not the provider.
  model_unavailable: 0,
};

function healthDb() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return null;
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

async function loadRuntimeProviderHealth(providers: ProviderName[]): Promise<Partial<Record<ProviderName, { status: string; unavailable_until: string | null }>>> {
  const db = healthDb();
  if (!db || providers.length === 0) return {};
  try {
    const { data } = await db.from("provider_health_state").select("provider,status,unavailable_until").in("provider", providers);
    const out: Partial<Record<ProviderName, { status: string; unavailable_until: string | null }>> = {};
    for (const row of data ?? []) out[row.provider as ProviderName] = { status: String(row.status ?? ""), unavailable_until: row.unavailable_until ?? null };
    return out;
  } catch { return {}; }
}

async function persistRuntimeProviderFailure(provider: ProviderName, failure: ClassifiedFailure): Promise<void> {
  const db = healthDb();
  if (!db) return;
  const cooldown = HEALTH_COOLDOWN_MS[failure.category];
  const unavailableUntil = cooldown > 0 ? new Date(Date.now() + cooldown).toISOString() : null;
  try {
    const { data: existing } = await db.from("provider_health_state").select("consecutive_failures").eq("provider", provider).maybeSingle();
    const nextFailures = Number(existing?.consecutive_failures ?? 0) + 1;
    const update = {
      status: failure.category === "rate_limit" || failure.category === "invalid_response" ? "degraded" : "unavailable",
      failure_category: failure.category,
      reason: failure.detail.slice(0, 500),
      unavailable_until: unavailableUntil,
      consecutive_failures: nextFailures,
      last_failure_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data: updated } = await db.from("provider_health_state").update(update).eq("provider", provider).select("provider");
    if (!updated || updated.length === 0) {
      await db.from("provider_health_state").insert({ provider, ...update });
    }
  } catch { /* telemetry must never break execution */ }
}

async function persistRuntimeProviderSuccess(provider: ProviderName): Promise<void> {
  const db = healthDb();
  if (!db) return;
  try {
    // provider_health_state_status_check allows only available/degraded/
    // unavailable. "healthy" was rejected (400) and the error was never read,
    // so a recovered provider was never marked available again.
    const { error } = await db.from("provider_health_state").update({
      status: "available", failure_category: null, reason: null, unavailable_until: null,
      consecutive_failures: 0, last_success_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    }).eq("provider", provider);
    if (error) console.warn(JSON.stringify({ level: "WARN", message: "provider health success write failed", provider, error: error.message }));
  } catch { /* telemetry must never break execution */ }
}

// ---------------------------------------------------------------------------
// Model identity — SINGLE SOURCE OF TRUTH. Every model string this module (or
// any caller) ever logs, prices, or displays is resolved through these three
// functions and nothing else. No other file may hardcode a model literal for
// these providers — see FKAIOS production-fix telemetry incident: ai-engine
// used to independently guess "claude-3-haiku-20240307" from the provider
// name alone, which drifted from the model actually being called the moment
// this constant changed. Env-overridable so a model migration is a config
// change, not a code change scattered across callers.
//
// PER-CLASS MODEL (Master Engineering Mandate Section 9, "one reasoning
// path... provider routing underneath"): `founder_intelligence` has always
// been documented here as the quality-priority class (CLASS_PRIORITY below
// weights it quality:1.0), but until now that priority only affected WHICH
// PROVIDER got tried first — every class shared the exact same per-provider
// model, so "quality priority" never actually meant "a stronger model."
// Routing founder-brain.ts's reason() through this router (a real
// consolidation the codebase's own reasoning-duplication problem calls for)
// would have been a silent quality regression without this: `reason()`
// currently hardcodes claude-sonnet-4-6/gemini-2.5-flash/gpt-4o-mini, while
// this router's own defaults are the smaller/cheaper claude-haiku-4-5/
// gemini-3.5-flash-lite/gpt-5.6-luna.
//
// Resolution order, most to least specific — an operator's explicit env
// var always wins over any hardcoded default, class-specific or not, so a
// deliberate provider-wide override (e.g. during an incident) still applies
// everywhere:
//   1. Per-class env var       (e.g. ANTHROPIC_MODEL_FOUNDER_INTELLIGENCE)
//   2. Global env var          (e.g. ANTHROPIC_MODEL)
//   3. Per-class hardcoded default (CLASS_MODEL_DEFAULTS below)
//   4. Global hardcoded default
// Deliberately NOT env-var-dependent for correctness: this module has no
// access to Supabase project secrets, so making founder_intelligence's
// quality depend on an operator remembering to set an env var would be the
// exact "looks connected, isn't" gap this mandate exists to close. With no
// env var set anywhere (today's actual state), every existing class other
// than founder_intelligence resolves identically to before this change.
// ---------------------------------------------------------------------------
const ANTHROPIC_CLASS_DEFAULTS: Partial<Record<FunctionClass, string>> = {
  founder_intelligence: "claude-sonnet-4-6", // matches founder-brain.ts reasonCore()'s own historical hardcoded model
};
// founder_intelligence deliberately has NO Gemini class default: it resolves
// GEMINI_MODEL_FOUNDER_INTELLIGENCE -> GEMINI_MODEL -> the shared default in
// getGeminiModel() below. Its former quality-tier default, gemini-2.5-flash,
// hit its quota on 2026-09-23 while Anthropic and OpenAI were both out of
// credit, which left the Founder Brain with no working provider at all; the
// shared default is the model ai-engine was succeeding with at the time.
const GEMINI_CLASS_DEFAULTS: Partial<Record<FunctionClass, string>> = {};
const OPENAI_CLASS_DEFAULTS: Partial<Record<FunctionClass, string>> = {
  founder_intelligence: "gpt-4o-mini",
};

function resolveModel(
  globalEnvVar: string,
  hardcodedDefault: string,
  classDefaults: Partial<Record<FunctionClass, string>>,
  functionClass?: FunctionClass,
): string {
  if (functionClass) {
    const perClassEnv = Deno.env.get(`${globalEnvVar}_${functionClass.toUpperCase()}`);
    if (perClassEnv) return perClassEnv;
  }
  const globalEnv = Deno.env.get(globalEnvVar);
  if (globalEnv) return globalEnv;
  if (functionClass && classDefaults[functionClass]) return classDefaults[functionClass]!;
  return hardcodedDefault;
}
function getAnthropicModel(functionClass?: FunctionClass): string {
  return resolveModel("ANTHROPIC_MODEL", "claude-haiku-4-5-20251001", ANTHROPIC_CLASS_DEFAULTS, functionClass);
}
function getGeminiModel(functionClass?: FunctionClass): string {
  return resolveModel("GEMINI_MODEL", "gemini-3.5-flash-lite", GEMINI_CLASS_DEFAULTS, functionClass);
}
function getOpenAIModel(functionClass?: FunctionClass): string {
  return resolveModel("OPENAI_MODEL", "gpt-5.6-luna", OPENAI_CLASS_DEFAULTS, functionClass);
}
function getOpenRouterModel(functionClass?: FunctionClass): string { return resolveModel("OPENROUTER_MODEL", "openrouter/free", {}, functionClass); }
function getGroqModel(functionClass?: FunctionClass): string { return resolveModel("GROQ_MODEL", "openai/gpt-oss-120b", {}, functionClass); }
function getMistralModel(functionClass?: FunctionClass): string { return resolveModel("MISTRAL_MODEL", "mistral-small-latest", {}, functionClass); }
function getHuggingFaceModel(functionClass?: FunctionClass): string { return resolveModel("HUGGINGFACE_MODEL", "meta-llama/Llama-3.1-8B-Instruct", {}, functionClass); }

// Pricing reflects each adapter's current model (see getXModel() above) —
// current as of the last model migration, per-provider published pricing,
// $/1M tokens. If ANTHROPIC_MODEL/GEMINI_MODEL/OPENAI_MODEL is overridden to
// a differently-priced model, this pricing table is stale until updated to
// match — it is keyed by provider, not by model, in Phase 6A.
const DEFAULT_PRICING = {
  anthropic: { inputPerMtok: 1.00, outputPerMtok: 5.00 }, // claude-haiku-4-5
  gemini: { inputPerMtok: 0.30, outputPerMtok: 2.50 }, // gemini-3.5-flash-lite
  openai: { inputPerMtok: 1.00, outputPerMtok: 6.00 }, // gpt-5.6-luna
} as const;

/** Anthropic tool definitions are `{name, description, input_schema}` — narrow enough to detect without importing Anthropic's SDK types. */
function isAnthropicToolSchema(schema: unknown): schema is { name: string; description?: string; input_schema: unknown } {
  return !!schema && typeof schema === "object" && typeof (schema as { name?: unknown }).name === "string" && "input_schema" in (schema as Record<string, unknown>);
}

/**
 * Provider-neutral structured output. Anthropic answers through a forced
 * tool; other providers are given the same JSON schema as an instruction and
 * their reply is parsed and checked here. A reply that does not satisfy the
 * schema's required fields is not a result: the adapter returns no content, so
 * the call is classified invalid_response and fails over to the next resource.
 */
export function structuredOutputInstruction(schema: unknown): string {
  if (!isAnthropicToolSchema(schema)) return "";
  return `\n\nOUTPUT FORMAT (mandatory): respond with ONLY one JSON object, no prose and no code fences, that is the input of the function "${schema.name}"${schema.description ? ` (${schema.description})` : ""} and matches this JSON Schema:\n${JSON.stringify(schema.input_schema)}`;
}

export function parseStructuredOutput(text: string, schema: unknown): Record<string, unknown> | null {
  if (!isAnthropicToolSchema(schema)) return null;
  const cleaned = text.replace(/^\s*```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  let value: unknown;
  try { value = JSON.parse(cleaned.slice(start, end + 1)); } catch { return null; }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const required = ((schema.input_schema as { required?: unknown })?.required ?? []) as unknown[];
  for (const key of required) if (!(String(key) in (value as Record<string, unknown>))) return null;
  return value as Record<string, unknown>;
}

export const anthropicAdapter: ProviderAdapter = {
  name: "anthropic",
  getModel: getAnthropicModel,
  async call(request) {
    // API-key validation before making any HTTP request — an honest,
    // immediate failure rather than firing a request with a blank
    // Authorization header.
    const apiKey = getAnthropicApiKey();
    const model = request.model ?? getAnthropicModel(request.functionClass);
    if (!apiKey) {
      return { ok: false, httpStatus: 401, rawBody: { error: "ANTHROPIC_API_KEY is not configured" }, latencyMs: 0, model };
    }
    const maxTokens = request.maxTokens ?? 4096;
    // Structured output: when the caller supplies an Anthropic tool schema,
    // force the model to answer through that tool instead of free-form text.
    // This is strictly additive — callers that never set toolSchema get the
    // exact same request body as before.
    const useTool = isAnthropicToolSchema(request.toolSchema);
    const body: Record<string, unknown> = {
      model,
      max_tokens: maxTokens,
      system: request.systemPrompt,
      messages: [{ role: "user", content: request.userContent }],
    };
    if (request.temperature !== undefined) body.temperature = request.temperature;
    if (useTool) {
      body.tools = [request.toolSchema];
      body.tool_choice = { type: "tool", name: (request.toolSchema as { name: string }).name };
    }
    const start = Date.now();
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      let parsedBody: unknown = text;
      try { parsedBody = JSON.parse(text); } catch { /* keep as raw text */ }
      return { ok: false, httpStatus: response.status, rawBody: parsedBody, latencyMs, model };
    }
    const data = await response.json();
    const blocks: unknown[] = Array.isArray(data?.content) ? data.content : [];
    const toolUseBlock = useTool
      ? (blocks.find((b): b is { type: string; input: unknown } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "tool_use") as { input?: unknown } | undefined)
      : undefined;
    const textBlock = blocks.find((b): b is { type: string; text: string } => !!b && typeof b === "object" && (b as { type?: unknown }).type === "text") as { text?: string } | undefined;
    return {
      ok: true,
      httpStatus: response.status,
      content: textBlock?.text ?? "",
      toolCall: toolUseBlock?.input,
      rawBody: data,
      inputTokens: data?.usage?.input_tokens ?? 0,
      outputTokens: data?.usage?.output_tokens ?? 0,
      latencyMs,
      model,
      truncated: data?.stop_reason === "max_tokens",
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
  getModel: getOpenAIModel,
  async call(request) {
    const apiKey = getOpenAIApiKey();
    const model = request.model ?? getOpenAIModel(request.functionClass);
    if (!apiKey) {
      return { ok: false, httpStatus: 401, rawBody: { error: "OPENAI_API_KEY is not configured" }, latencyMs: 0, model };
    }
    const maxTokens = request.maxTokens ?? 8192;
    const start = Date.now();
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: request.systemPrompt + structuredOutputInstruction(request.toolSchema) }, { role: "user", content: request.userContent }] }),
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      let parsedBody: unknown = text;
      try { parsedBody = JSON.parse(text); } catch { /* keep as raw text */ }
      return { ok: false, httpStatus: response.status, rawBody: parsedBody, latencyMs, model };
    }
    const data = await response.json();
    return {
      ok: true,
      httpStatus: response.status,
      content: isAnthropicToolSchema(request.toolSchema) ? (parseStructuredOutput(data?.choices?.[0]?.message?.content ?? "", request.toolSchema) ? data?.choices?.[0]?.message?.content ?? "" : "") : data?.choices?.[0]?.message?.content ?? "",
      toolCall: isAnthropicToolSchema(request.toolSchema) ? parseStructuredOutput(data?.choices?.[0]?.message?.content ?? "", request.toolSchema) ?? undefined : undefined,
      rawBody: data,
      inputTokens: data?.usage?.prompt_tokens ?? 0,
      outputTokens: data?.usage?.completion_tokens ?? 0,
      latencyMs,
      model,
      truncated: data?.choices?.[0]?.finish_reason === "length",
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


// OpenAI-compatible resilience adapters: each provider is optional and is
// automatically skipped when its key is absent or explicitly disabled.
function buildOpenAICompatibleAdapter(
  name: ProviderName,
  envKey: () => string,
  modelResolver: (fc?: FunctionClass) => string,
  baseUrl: string,
  extraHeaders: Record<string,string> = {},
  /** Local servers (Ollama, llama.cpp, vLLM) usually need no key: the base URL is the credential. */
  keyOptional = false,
): ProviderAdapter {
  return {
    name,
    getModel: modelResolver,
    async call(request) {
      const apiKey = envKey();
      const model = request.model ?? modelResolver(request.functionClass);
      if (!baseUrl) return {ok:false,httpStatus:401,rawBody:{error:"base URL not configured"},latencyMs:0,model};
      if (!apiKey && !keyOptional) return {ok:false,httpStatus:401,rawBody:{error:"API key not configured"},latencyMs:0,model};
      const start=Date.now();
      const response=await fetch(baseUrl+"/chat/completions",{
        method:"POST",
        headers:{...(apiKey?{Authorization:"Bearer "+apiKey}:{}),"Content-Type":"application/json",...extraHeaders},
        body:JSON.stringify({model,max_tokens:request.maxTokens??4096,messages:[{role:"system",content:request.systemPrompt+structuredOutputInstruction(request.toolSchema)},{role:"user",content:request.userContent}],temperature:request.temperature}),
      });
      const latencyMs=Date.now()-start;
      if(!response.ok){
        const text=await response.text(); let parsed:unknown=text; try{parsed=JSON.parse(text)}catch{}
        return {ok:false,httpStatus:response.status,rawBody:parsed,latencyMs,model};
      }
      const data=await response.json();
      const text:string=data?.choices?.[0]?.message?.content??"";
      const toolCall=isAnthropicToolSchema(request.toolSchema)?parseStructuredOutput(text,request.toolSchema):undefined;
      return {ok:true,httpStatus:response.status,content:isAnthropicToolSchema(request.toolSchema)?(toolCall?text:""):text,toolCall:toolCall??undefined,rawBody:data,inputTokens:data?.usage?.prompt_tokens??0,outputTokens:data?.usage?.completion_tokens??0,latencyMs,model,truncated:data?.choices?.[0]?.finish_reason==="length"};
    },
    estimateCost(_request,response){ return 0; },
    health(){ return {provider:name,successRate:null,failureCount:0,fallbackFrequency:null,avgLatencyMs:null,timeoutRate:null,costPerSuccessUsd:null,sampleSize:0}; },
  };
}
export const openRouterAdapter=buildOpenAICompatibleAdapter("openrouter",getOpenRouterApiKey,getOpenRouterModel,"https://openrouter.ai/api/v1",{"HTTP-Referer":"https://fkaios.app","X-Title":"FKAIOS"});
export const groqAdapter=buildOpenAICompatibleAdapter("groq",getGroqApiKey,getGroqModel,"https://api.groq.com/openai/v1");
export const mistralAdapter=buildOpenAICompatibleAdapter("mistral",getMistralApiKey,getMistralModel,"https://api.mistral.ai/v1");
export const huggingFaceAdapter=buildOpenAICompatibleAdapter("huggingface",getHuggingFaceApiKey,getHuggingFaceModel,"https://router.huggingface.co/v1");

export const geminiAdapter: ProviderAdapter = {
  name: "gemini",
  getModel: getGeminiModel,
  async call(request) {
    const apiKey = getGeminiApiKey();
    const model = request.model ?? getGeminiModel(request.functionClass);
    if (!apiKey) {
      return { ok: false, httpStatus: 401, rawBody: { error: "GEMINI_API_KEY is not configured" }, latencyMs: 0, model };
    }
    const maxTokens = request.maxTokens ?? 8192;
    const structured = isAnthropicToolSchema(request.toolSchema);
    const start = Date.now();
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
      method: "POST",
      headers: { "x-goog-api-key": apiKey, "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: request.systemPrompt + structuredOutputInstruction(request.toolSchema) }] },
        contents: [{ role: "user", parts: [{ text: request.userContent }] }],
        generationConfig: { maxOutputTokens: maxTokens, temperature: request.temperature, ...(structured ? { responseMimeType: "application/json" } : {}) },
      }),
    });
    const latencyMs = Date.now() - start;
    if (!response.ok) {
      const text = await response.text();
      let parsedBody: unknown = text;
      try { parsedBody = JSON.parse(text); } catch { /* keep as raw text */ }
      return { ok: false, httpStatus: response.status, rawBody: parsedBody, latencyMs, model };
    }
    const data = await response.json();
    const text = ((data?.candidates?.[0]?.content?.parts ?? []) as Array<{ text?: string; thought?: boolean }>).filter((p) => !p.thought).map((p) => p.text ?? "").join("");
    const toolCall = structured ? parseStructuredOutput(text, request.toolSchema) : undefined;
    return {
      ok: true,
      httpStatus: response.status,
      content: structured ? (toolCall ? text : "") : text,
      toolCall: toolCall ?? undefined,
      rawBody: data,
      inputTokens: data?.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data?.usageMetadata?.candidatesTokenCount ?? 0,
      latencyMs,
      model,
      truncated: data?.candidates?.[0]?.finishReason === "MAX_TOKENS",
    };
  },
  estimateCost(_request, response) {
    const pricing = DEFAULT_PRICING.gemini;
    return ((response?.inputTokens ?? 0) / 1_000_000) * pricing.inputPerMtok + ((response?.outputTokens ?? 0) / 1_000_000) * pricing.outputPerMtok;
  },
  health() {
    return { provider: "gemini", successRate: null, failureCount: 0, fallbackFrequency: null, avgLatencyMs: null, timeoutRate: null, costPerSuccessUsd: null, sampleSize: 0 };
  },
};


export const selfHostedAdapter: ProviderAdapter = buildOpenAICompatibleAdapter(
  "self_hosted",
  getSelfHostedApiKey,
  getSelfHostedModel,
  getSelfHostedBaseUrl().replace(/\/+$/, ""),
  {},
  true,
);

/**
 * Explicit operator kill switch, independent of whether an API key happens
 * to be configured. Defaults to enabled — this only ever REMOVES a provider
 * that would otherwise be a candidate (e.g. PROVIDER_OPENAI_ENABLED=false
 * while OPENAI_API_KEY is still set, because OpenAI has no credits in this
 * deployment and every call to it is a guaranteed, wasted failure). Provider
 * enablement is therefore configuration, never a hardcoded list in code.
 */
function isProviderEnabled(envVar: string): boolean {
  const value = Deno.env.get(envVar);
  return value !== "false" && value !== "0";
}

/** Providers with a configured API key AND not explicitly disabled, in default fallback order: Anthropic, then Gemini, then OpenAI. */
export function getConfiguredDefaultProviders(): ProviderAdapter[] {
  const providers: ProviderAdapter[] = [];
  if (getAnthropicApiKey() && isProviderEnabled("PROVIDER_ANTHROPIC_ENABLED")) providers.push(anthropicAdapter);
  if (getGeminiApiKey() && isProviderEnabled("PROVIDER_GEMINI_ENABLED")) providers.push(geminiAdapter);
  if (getOpenAIApiKey() && isProviderEnabled("PROVIDER_OPENAI_ENABLED")) providers.push(openaiAdapter);
  if (getOpenRouterApiKey() && isProviderEnabled("PROVIDER_OPENROUTER_ENABLED")) providers.push(openRouterAdapter);
  if (getGroqApiKey() && isProviderEnabled("PROVIDER_GROQ_ENABLED")) providers.push(groqAdapter);
  if (getMistralApiKey() && isProviderEnabled("PROVIDER_MISTRAL_ENABLED")) providers.push(mistralAdapter);
  if (getHuggingFaceApiKey() && isProviderEnabled("PROVIDER_HUGGINGFACE_ENABLED")) providers.push(huggingFaceAdapter);
  if (getSelfHostedBaseUrl() && isProviderEnabled("PROVIDER_SELF_HOSTED_ENABLED")) providers.push(selfHostedAdapter);
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
    // One bounded attempt per configured provider. The router excludes a provider after
    // failure, so this must be high enough to traverse the full configured fallback
    // chain (premium -> free/open cloud -> self-hosted) instead of stopping after
    // Anthropic/Gemini/OpenAI and falsely blocking while later providers are healthy.
    retryLimitByClass: { founder_intelligence: 8, business_agent: 8, background_agent: 8, customer_agent: 8 },
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

const MODEL_UNAVAILABLE_PATTERNS = [
  /model[^"]{0,40}(not found|does not exist|is not supported|not available|deprecated|decommissioned)/i,
  /not_found_error/i,
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

  if (response.httpStatus === 404 || (response.httpStatus === 400 && MODEL_UNAVAILABLE_PATTERNS.some((p) => p.test(bodyText)))) {
    // The model itself is missing/retired/not served for this key. Unlike a
    // malformed request, another model or provider can still answer it.
    return { category: "model_unavailable", detail: bodyText.slice(0, 300), shouldFailover: true };
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

/**
 * Renders every failed attempt into the log, not just the most recent one —
 * per FKAIOS_PHASE6A_CALLLLM_SPECIFICATION.md Section 4 ("failure_reason —
 * per failed attempt"). A three-provider failover chain must leave a record
 * of what each of the three providers actually did, not just what killed the
 * last one — otherwise a persistently-failing provider earlier in the chain
 * goes invisible the moment a later provider also fails.
 */
function formatFailureReason(attempts: CallAttempt[]): string | null {
  const failures = attempts.filter((a): a is CallAttempt & { failure: ClassifiedFailure } => a.failure !== undefined);
  if (failures.length === 0) return null;
  return failures.map((a) => `${a.provider}: ${a.failure.category}: ${a.failure.detail}`).join(" | ");
}

export function buildLogEntry(
  request: LLMRequest,
  attempts: CallAttempt[],
  status: LLMCallLogEntry["final_result_status"],
  tokenUsage: { input: number; output: number } | null,
): LLMCallLogEntry {
  const successfulAttempt = attempts.find((a) => a.outcome === "success");
  const totalLatency = attempts.reduce((sum, a) => sum + a.latencyMs, 0);
  const totalCost = attempts.reduce((sum, a) => sum + (a.estimatedCostUsd ?? 0), 0);

  return {
    function_name: request.functionName,
    agent_name: request.agentName ?? null,
    requested_provider: attempts[0]?.provider ?? ("anthropic" as ProviderName),
    attempted_providers: attempts.map((a) => a.provider),
    failure_reason: formatFailureReason(attempts),
    successful_provider: successfulAttempt?.provider ?? null,
    successful_model: successfulAttempt?.model ?? null,
    attempts: attempts.map((a) => ({
      provider: a.provider,
      model: a.model,
      outcome: a.outcome,
      wasFallback: a.wasFallback,
      failureCategory: a.failure?.category ?? null,
      latencyMs: a.latencyMs,
      estimatedCostUsd: a.estimatedCostUsd,
      failureDetail: a.failure?.detail?.slice(0, 300) ?? null,
      inputTokens: a.inputTokens,
      outputTokens: a.outputTokens,
    })),
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
  let timeoutId: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      adapter.call(request, timeoutMs),
      new Promise<RawProviderResponse>((_, reject) => {
        timeoutId = setTimeout(() => reject(new TimeoutError(`Provider ${adapter.name} exceeded ${timeoutMs}ms`)), timeoutMs);
      }),
    ]);
  } finally {
    // Clear the losing timer once the race settles — otherwise a fast
    // success/failure still leaves a dangling timeout running in the
    // background for the rest of `timeoutMs`, one per call, forever.
    clearTimeout(timeoutId!);
  }
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
  const runtimeHealth = await loadRuntimeProviderHealth(candidates);
  const excluded: ProviderName[] = [];
  for (const [provider, state] of Object.entries(runtimeHealth) as [ProviderName, {status:string; unavailable_until:string|null}][]) {
    if (state.status === "unavailable" && state.unavailable_until && new Date(state.unavailable_until).getTime() > Date.now()) excluded.push(provider);
  }
  const attempts: CallAttempt[] = [];
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
    // The model actually targeted by this attempt — from the response when
    // one exists (every adapter branch sets it, success or failure), or from
    // the adapter's own resolver when the attempt never got a response at
    // all (a thrown network error or a timeout raced ahead of it).
    const attemptedModel = response?.model ?? adapter.getModel(request.functionClass);

    if (response && response.ok && !isEmptyOrInvalidContent(response)) {
      // Real success — a genuine, usable response was received.
      tokenUsage = { input: response.inputTokens ?? 0, output: response.outputTokens ?? 0 };
      const cost = adapter.estimateCost(request, response);
      attempts.push({ provider: providerName, model: attemptedModel, outcome: "success", latencyMs, estimatedCostUsd: cost, wasFallback, timedOut: false, inputTokens: response.inputTokens ?? 0, outputTokens: response.outputTokens ?? 0 });
      await persistRuntimeProviderSuccess(providerName);
      return {
        status: "success",
        content: response.content,
        toolCall: response.toolCall,
        model: attemptedModel,
        truncated: response.truncated === true,
        log: buildLogEntry(request, attempts, "success", tokenUsage),
      };
    }

    // Failure path: thrown, non-ok response, or empty/invalid content.
    const failure = timedOut
      ? { category: "timeout" as const, detail: `No response within ${timeoutMs}ms`, shouldFailover: true }
      : classifyLLMFailure(response, thrown);

    await persistRuntimeProviderFailure(providerName, failure);
    attempts.push({
      provider: providerName,
      model: attemptedModel,
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

// ---------------------------------------------------------------------------
// Resource-level routing
// ---------------------------------------------------------------------------

/** One concrete execution resource: a specific model of a specific provider. */
export interface ExecutionResource {
  /** Canonical identity, model:<provider>:<model>. */
  ref: string;
  provider: ProviderName;
  model: string;
}

/**
 * Failures that say nothing about other models of the same provider. A quota
 * hit or a missing model on one model leaves the provider's other models
 * usable (free-tier quotas are per model); everything else (no credit, bad
 * key, outage) makes the whole provider unusable for this call.
 */
const RESOURCE_SCOPED_FAILURES: ReadonlySet<FailureCategory> = new Set(["rate_limit", "model_unavailable", "invalid_response", "timeout"]);

/**
 * Calls an ordered list of resources (chosen by resource-selection.ts), trying
 * the next one when an attempt fails. Same validation and honesty rules as
 * callLLM: a 200 with no usable content is a failure, and every attempt is
 * logged with its provider, exact model and failure category.
 */
export async function callLLMOnResources(
  request: LLMRequest,
  config: RouterConfig,
  resources: ExecutionResource[],
): Promise<LLMResult & { resource?: ExecutionResource }> {
  const timeoutMs = config.timeoutMsByClass[request.functionClass];
  const attempts: CallAttempt[] = [];
  const deadProviders = new Set<ProviderName>();
  let tokenUsage: { input: number; output: number } | null = null;

  for (const resource of resources) {
    if (deadProviders.has(resource.provider)) continue;
    const adapter = config.providers.find((p) => p.name === resource.provider);
    if (!adapter) continue; // provider not configured in this runtime
    const start = Date.now();
    let response: RawProviderResponse | null = null;
    let thrown: unknown;
    try {
      response = await callWithTimeout(adapter, { ...request, model: resource.model }, timeoutMs);
    } catch (err) {
      thrown = err;
    }
    const latencyMs = Date.now() - start;
    const timedOut = thrown instanceof TimeoutError;
    const wasFallback = attempts.length > 0;

    if (response && response.ok && !isEmptyOrInvalidContent(response)) {
      tokenUsage = { input: response.inputTokens ?? 0, output: response.outputTokens ?? 0 };
      const cost = adapter.estimateCost(request, response);
      attempts.push({ provider: resource.provider, model: resource.model, outcome: "success", latencyMs, estimatedCostUsd: cost, wasFallback, timedOut: false, inputTokens: response.inputTokens ?? 0, outputTokens: response.outputTokens ?? 0 });
      await persistRuntimeProviderSuccess(resource.provider);
      return {
        status: "success",
        content: response.content,
        toolCall: response.toolCall,
        model: resource.model,
        truncated: response.truncated === true,
        resource,
        log: buildLogEntry(request, attempts, "success", tokenUsage),
      };
    }

    const failure = timedOut
      ? { category: "timeout" as const, detail: `No response within ${timeoutMs}ms`, shouldFailover: true }
      : classifyLLMFailure(response, thrown);
    attempts.push({ provider: resource.provider, model: resource.model, outcome: "failure", failure, latencyMs, estimatedCostUsd: response ? adapter.estimateCost(request, response) : null, wasFallback, timedOut });
    if (!RESOURCE_SCOPED_FAILURES.has(failure.category)) {
      deadProviders.add(resource.provider);
      await persistRuntimeProviderFailure(resource.provider, failure);
    }
    if (!failure.shouldFailover) {
      return { status: "failed_all_providers", log: buildLogEntry(request, attempts, "failed_all_providers", tokenUsage) };
    }
  }

  const anyInvalidResponse = attempts.some((a) => a.failure?.category === "invalid_response");
  const finalStatus = anyInvalidResponse ? "invalid_response_received" : "failed_all_providers";
  return { status: finalStatus, log: buildLogEntry(request, attempts, finalStatus, tokenUsage) };
}
