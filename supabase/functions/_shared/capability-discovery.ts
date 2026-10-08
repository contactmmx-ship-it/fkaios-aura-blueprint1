// CONTINUOUS AI-WORLD DISCOVERY — reads the providers' own model catalogs
// (not news or marketing) and turns them into structured candidates:
//   Gemini    GET /v1beta/models            (key: GEMINI_API_KEY)
//   Anthropic GET /v1/models                (key: ANTHROPIC_API_KEY)
//   OpenAI    GET /v1/models                (key: OPENAI_API_KEY)
//   OpenRouter GET /api/v1/models           (public; pricing, context, free tier)
// Discovery never changes routing. New models enter model_registry as
// 'discovered' and capability_discovery_candidates; configured ones are queued
// for controlled evaluation. Only evaluation + governed adoption can move a
// model into production routing. A registered model the provider stops listing
// for two consecutive runs is retired (never routed to again).

import { modelRef } from "./resource-identity.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

export interface DiscoveredModel {
  provider: string;
  model: string;
  displayName?: string;
  contextWindow?: number | null;
  maxOutputTokens?: number | null;
  costInPerMtok?: number | null;
  costOutPerMtok?: number | null;
  freeTier?: boolean | null;
  source: string;
}

const NON_TEXT = /(embed|embedding|aqa|imagen|veo|tts|image|audio|live|vision-only|robotics|computer-use|learnlm|whisper|dall-e|moderation|transcribe|realtime|search|davinci|babbage|codex-mini|lyria|gemma-3n)/i;

export function parseGeminiModels(body: unknown): DiscoveredModel[] {
  const models = (body as { models?: unknown[] })?.models ?? [];
  const out: DiscoveredModel[] = [];
  for (const m of models as Array<Record<string, unknown>>) {
    const name = String(m.name ?? "").replace(/^models\//, "");
    const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.map(String) : [];
    if (!name || !methods.includes("generateContent") || NON_TEXT.test(name)) continue;
    out.push({ provider: "gemini", model: name, displayName: String(m.displayName ?? name), contextWindow: Number(m.inputTokenLimit) || null, maxOutputTokens: Number(m.outputTokenLimit) || null, source: "provider_api:gemini" });
  }
  return out;
}

/**
 * Speech resources a provider lists. They are not text models, so they never
 * enter the text evaluation path; they are registered per capability in
 * fkaios_resource_capabilities instead (discovery is not trust: lifecycle
 * starts at 'discovered').
 */
export interface DiscoveredSpeechResource { capability: "speech_to_text" | "text_to_speech"; provider: string; model: string; displayName: string }

export function parseGeminiSpeechModels(body: unknown): DiscoveredSpeechResource[] {
  const models = (body as { models?: unknown[] })?.models ?? [];
  const out: DiscoveredSpeechResource[] = [];
  for (const m of models as Array<Record<string, unknown>>) {
    const name = String(m.name ?? "").replace(/^models\//, "");
    const methods = Array.isArray(m.supportedGenerationMethods) ? m.supportedGenerationMethods.map(String) : [];
    if (!name || !methods.includes("generateContent")) continue;
    if (/tts/i.test(name)) out.push({ capability: "text_to_speech", provider: "gemini", model: name, displayName: String(m.displayName ?? name) });
  }
  return out;
}

export function parseAnthropicModels(body: unknown): DiscoveredModel[] {
  const data = (body as { data?: unknown[] })?.data ?? [];
  return (data as Array<Record<string, unknown>>)
    .filter((m) => typeof m.id === "string")
    .map((m) => ({ provider: "anthropic", model: String(m.id), displayName: String(m.display_name ?? m.id), source: "provider_api:anthropic" }));
}

export function parseOpenAIModels(body: unknown): DiscoveredModel[] {
  const data = (body as { data?: unknown[] })?.data ?? [];
  return (data as Array<Record<string, unknown>>)
    .map((m) => String(m.id ?? ""))
    .filter((id) => /^(gpt-|o\d)/.test(id) && !NON_TEXT.test(id) && !/-\d{4}-\d{2}-\d{2}$/.test(id))
    .map((id) => ({ provider: "openai", model: id, source: "provider_api:openai" }));
}

/** A local OpenAI-compatible server (Ollama, llama.cpp, vLLM): every listed model is free of API cost. */
export function parseSelfHostedModels(body: unknown): DiscoveredModel[] {
  const data = (body as { data?: unknown[] })?.data ?? [];
  return (data as Array<Record<string, unknown>>)
    .map((m) => String(m.id ?? ""))
    .filter((id) => id && !/(embed|embedding|rerank|whisper|tts)/i.test(id))
    .map((id) => ({ provider: "self_hosted", model: id, source: "provider_api:self_hosted", freeTier: true, costInPerMtok: 0, costOutPerMtok: 0 }));
}

/** OpenRouter prices are USD per token as strings; we store USD per 1M tokens. */
export function parseOpenRouterModels(body: unknown, limit = 40): DiscoveredModel[] {
  const data = (body as { data?: unknown[] })?.data ?? [];
  const out: DiscoveredModel[] = [];
  for (const m of data as Array<Record<string, unknown>>) {
    const id = String(m.id ?? "");
    const pricing = (m.pricing ?? {}) as Record<string, unknown>;
    const pin = Number(pricing.prompt), pout = Number(pricing.completion);
    const free = pin === 0 && pout === 0;
    // Only free models are tracked from this catalog: they are the capacity
    // FKAIOS could add at zero cost (an OpenRouter key is all that is missing).
    if (!id || !free || NON_TEXT.test(id)) continue;
    const top = (m.top_provider ?? {}) as Record<string, unknown>;
    out.push({ provider: "openrouter", model: id, displayName: String(m.name ?? id), contextWindow: Number(m.context_length) || null, maxOutputTokens: Number(top.max_completion_tokens) || null, costInPerMtok: 0, costOutPerMtok: 0, freeTier: true, source: "provider_api:openrouter" });
    if (out.length >= limit) break;
  }
  return out;
}

/** Evaluation priority: stable before preview/experimental, newer families first, flash/lite (cheap, high quota) before pro. */
export function evaluationPriority(model: string): number {
  let p = 50;
  if (/preview|exp|experimental/i.test(model)) p -= 15;
  const v = /(\d+(?:\.\d+)?)/.exec(model);
  if (v) p += Math.min(20, Math.round(Number(v[1]) * 4));
  if (/flash-lite|lite|mini|haiku/i.test(model)) p += 8;
  else if (/flash/i.test(model)) p += 6;
  if (/pro|opus/i.test(model)) p -= 3;
  return Math.max(1, Math.min(99, p));
}

interface ProviderListing { provider: string; ok: boolean; models: DiscoveredModel[]; speech?: DiscoveredSpeechResource[]; error?: string }

async function fetchJson(url: string, headers: Record<string, string>): Promise<unknown> {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(15000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return await res.json();
}

async function listProviders(env: (k: string) => string | undefined): Promise<ProviderListing[]> {
  const jobs: Array<Promise<ProviderListing>> = [];
  const gem = env("GEMINI_API_KEY");
  if (gem) jobs.push((async () => {
    const all: DiscoveredModel[] = [];
    const speech: DiscoveredSpeechResource[] = [];
    let token = "";
    for (let page = 0; page < 5; page++) {
      const body = await fetchJson(`https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`, { "x-goog-api-key": gem }) as { nextPageToken?: string };
      all.push(...parseGeminiModels(body));
      speech.push(...parseGeminiSpeechModels(body));
      token = body.nextPageToken ?? "";
      if (!token) break;
    }
    return { provider: "gemini", ok: true, models: all, speech };
  })().catch((e) => ({ provider: "gemini", ok: false, models: [], error: String(e) })));
  const ant = env("ANTHROPIC_API_KEY");
  if (ant) jobs.push(fetchJson("https://api.anthropic.com/v1/models?limit=100", { "x-api-key": ant, "anthropic-version": "2023-06-01" })
    .then((b) => ({ provider: "anthropic", ok: true, models: parseAnthropicModels(b) }))
    .catch((e) => ({ provider: "anthropic", ok: false, models: [], error: String(e) })));
  const oai = env("OPENAI_API_KEY");
  if (oai) jobs.push(fetchJson("https://api.openai.com/v1/models", { Authorization: `Bearer ${oai}` })
    .then((b) => ({ provider: "openai", ok: true, models: parseOpenAIModels(b) }))
    .catch((e) => ({ provider: "openai", ok: false, models: [], error: String(e) })));
  const local = (env("SELF_HOSTED_LLM_BASE_URL") ?? "").replace(/\/+$/, "");
  if (local) {
    const key = env("SELF_HOSTED_LLM_API_KEY");
    jobs.push(fetchJson(`${local}/models`, key ? { Authorization: `Bearer ${key}` } : {})
      .then((b) => ({ provider: "self_hosted", ok: true, models: parseSelfHostedModels(b) }))
      .catch((e) => ({ provider: "self_hosted", ok: false, models: [], error: String(e) })));
  }
  jobs.push(fetchJson("https://openrouter.ai/api/v1/models", {})
    .then((b) => ({ provider: "openrouter", ok: true, models: parseOpenRouterModels(b) }))
    .catch((e) => ({ provider: "openrouter", ok: false, models: [], error: String(e) })));
  return await Promise.all(jobs);
}

/** Access state from the runtime: key present, and whether the provider is known to be out of credit. */
async function accessStates(db: Db, env: (k: string) => string | undefined): Promise<Record<string, string>> {
  const { data } = await db.from("provider_health_state").select("provider,failure_category,status");
  const noCredit = new Set(((data ?? []) as Array<{ provider: string; failure_category: string | null; status: string }>)
    .filter((h) => h.failure_category === "credit_exhaustion" && h.status !== "available").map((h) => h.provider));
  const key: Record<string, string> = { gemini: "GEMINI_API_KEY", anthropic: "ANTHROPIC_API_KEY", openai: "OPENAI_API_KEY", openrouter: "OPENROUTER_API_KEY", self_hosted: "SELF_HOSTED_LLM_BASE_URL" };
  const out: Record<string, string> = {};
  for (const [p, k] of Object.entries(key)) out[p] = !env(k) ? "no_credential" : noCredit.has(p) ? "no_credit" : "configured";
  return out;
}

export interface DiscoveryReport {
  providers: Array<{ provider: string; ok: boolean; listed: number; error?: string }>;
  newModels: string[];
  retired: string[];
  queued: string[];
}

export const MAX_ACTIVE_TESTS = 3;

export async function runCapabilityDiscovery(db: Db, env: (k: string) => string | undefined = (k) => Deno.env.get(k), now = new Date()): Promise<DiscoveryReport> {
  const listings = await listProviders(env);
  const access = await accessStates(db, env);
  const report: DiscoveryReport = { providers: [], newModels: [], retired: [], queued: [] };
  const { data: existingRows } = await db.from("model_registry").select("model,provider,resource_ref,lifecycle_state,metadata,source");
  const existing = new Map(((existingRows ?? []) as Array<Record<string, unknown>>).map((r) => [String(r.resource_ref), r]));

  for (const listing of listings) {
    report.providers.push({ provider: listing.provider, ok: listing.ok, listed: listing.models.length, error: listing.error });
    if (!listing.ok) continue;
    for (const sp of listing.speech ?? []) {
      const ref = modelRef(sp.provider, sp.model);
      const { data: known } = await db.from("fkaios_resource_capabilities").select("id,metadata").eq("capability", sp.capability).eq("resource_ref", ref).maybeSingle();
      if (!known) {
        const { error } = await db.from("fkaios_resource_capabilities").insert({
          capability: sp.capability, resource_ref: ref, provider: sp.provider, display_name: sp.displayName,
          tier: "free_external", credential_ref: "GEMINI_API_KEY", privacy_class: "external",
          cost_model: { api_usd: 0, note: "free tier where the provider offers one; quota-limited" },
          operations: sp.capability === "text_to_speech" ? ["synthesize", "voice_selection"] : ["transcribe"],
          lifecycle_state: "discovered", source: `provider_api:${sp.provider}`, metadata: { first_seen_at: now.toISOString(), last_seen_at: now.toISOString() },
        });
        if (!error) report.newModels.push(`${ref} (${sp.capability})`);
      } else {
        await db.from("fkaios_resource_capabilities").update({ metadata: { ...((known.metadata as Record<string, unknown>) ?? {}), last_seen_at: now.toISOString() }, updated_at: now.toISOString() }).eq("id", known.id);
      }
    }
    const seen = new Set<string>();
    for (const m of listing.models) {
      const ref = modelRef(m.provider, m.model);
      seen.add(ref);
      const row = existing.get(ref);
      const common = {
        context_window: m.contextWindow ?? null, max_output_tokens: m.maxOutputTokens ?? null,
        access_state: access[m.provider] ?? "unknown", last_seen_at: now.toISOString(), updated_at: now.toISOString(),
        ...(m.costInPerMtok != null ? { cost_in_per_mtok: m.costInPerMtok, cost_out_per_mtok: m.costOutPerMtok } : {}),
        ...(m.freeTier != null ? { free_tier: m.freeTier } : {}),
      };
      if (!row) {
        const { error } = await db.from("model_registry").insert({
          model: m.model, provider: m.provider, available: access[m.provider] === "configured", lifecycle_state: "discovered",
          source: m.source, notes: `Discovered from ${m.source} on ${now.toISOString().slice(0, 10)}. Not routed until evaluated and adopted.`,
          metadata: { display_name: m.displayName ?? m.model, missing_count: 0 }, ...common,
        });
        if (!error) report.newModels.push(ref);
      } else {
        const meta: Record<string, unknown> = { ...((row.metadata as Record<string, unknown>) ?? {}), missing_count: 0, display_name: m.displayName ?? m.model };
        if (row.lifecycle_state === "retired") meta.reappeared_at = now.toISOString();
        await db.from("model_registry").update({ ...common, metadata: meta }).eq("resource_ref", ref);
      }
      const candidateMeta = { context_window: m.contextWindow ?? null, max_output_tokens: m.maxOutputTokens ?? null, free_tier: m.freeTier ?? null, access_state: access[m.provider] ?? "unknown" };
      const accessStatus = access[m.provider] === "configured" ? "eligible" : "blocked";
      const { data: cand } = await db.from("capability_discovery_candidates").select("id,status").eq("resource_key", ref).maybeSingle();
      if (!cand) {
        await db.from("capability_discovery_candidates").insert({ resource_key: ref, candidate_type: "model", provider: m.provider, model: m.model, source: m.source, status: accessStatus, metadata: candidateMeta });
      } else {
        // Evaluation outcomes (testing/verified/rejected) are never overwritten by a re-listing.
        const status = ["discovered", "eligible", "blocked"].includes(String(cand.status)) ? accessStatus : cand.status;
        await db.from("capability_discovery_candidates").update({ status, last_seen_at: now.toISOString(), metadata: candidateMeta }).eq("id", cand.id);
      }
    }
    // Retirement: registered models of this provider that the provider's own
    // catalog no longer lists, two runs in a row.
    for (const [ref, row] of existing) {
      if (row.provider !== listing.provider || seen.has(ref) || row.lifecycle_state === "retired" || row.lifecycle_state === "degraded") continue;
      const meta = { ...((row.metadata as Record<string, unknown>) ?? {}) };
      const missing = Number(meta.missing_count ?? 0) + 1;
      meta.missing_count = missing;
      if (missing >= 2 && ["adopted", "monitored"].includes(String(row.lifecycle_state))) {
        // Production routing depends on it: never silently retire. Degrade it
        // (still routable by its policy, health decides per call) and let the
        // adoption/rollback process replace it with evidence.
        if (row.lifecycle_state !== "degraded") {
          await db.from("model_registry").update({ lifecycle_state: "degraded", metadata: meta,
            blocked_reason: `In production routing but no longer listed by the ${listing.provider} model API (checked ${missing} times, last ${now.toISOString()}). Replacement needed.`, updated_at: now.toISOString() }).eq("resource_ref", ref);
          report.retired.push(`${ref} (degraded: in production routing)`);
        }
      } else if (missing >= 2) {
        await db.from("model_registry").update({ lifecycle_state: "retired", retired_at: now.toISOString(), available: false, metadata: meta,
          blocked_reason: `No longer listed by the ${listing.provider} model API (checked ${missing} times, last ${now.toISOString()}).`, updated_at: now.toISOString() }).eq("resource_ref", ref);
        report.retired.push(ref);
      } else {
        await db.from("model_registry").update({ metadata: meta, updated_at: now.toISOString() }).eq("resource_ref", ref);
      }
    }
  }

  // Controlled evaluation: queue configured, not-yet-evaluated models, a few at a time.
  const { count: active } = await db.from("capability_test_queue").select("id", { count: "exact", head: true }).in("status", ["queued", "running"]);
  let slots = Math.max(0, MAX_ACTIVE_TESTS - (active ?? 0));
  if (slots > 0) {
    const { data: candidates } = await db.from("capability_discovery_candidates").select("id,resource_key,model,status")
      .eq("status", "eligible").eq("candidate_type", "model");
    const { data: registry } = await db.from("model_registry").select("resource_ref,lifecycle_state").in("lifecycle_state", ["discovered", "available"]);
    const untested = new Set(((registry ?? []) as Array<{ resource_ref: string }>).map((r) => r.resource_ref));
    const ranked = ((candidates ?? []) as Array<{ id: string; resource_key: string; model: string }>)
      .filter((c) => untested.has(c.resource_key))
      .sort((a, b) => evaluationPriority(b.model) - evaluationPriority(a.model));
    for (const c of ranked) {
      if (slots <= 0) break;
      const { data: prior } = await db.from("capability_test_queue").select("id").eq("candidate_id", c.id).eq("benchmark_suite", "fkaios_core").in("status", ["queued", "running", "passed", "failed"]).limit(1);
      if ((prior ?? []).length) continue; // evaluated before; re-tests come from monitoring, not discovery
      const { error } = await db.from("capability_test_queue").insert({ candidate_id: c.id, benchmark_suite: "fkaios_core", priority: evaluationPriority(c.model), status: "queued" });
      if (!error) {
        slots--;
        report.queued.push(c.resource_key);
        await db.from("model_registry").update({ lifecycle_state: "testing", updated_at: now.toISOString() }).eq("resource_ref", c.resource_key).in("lifecycle_state", ["discovered", "available"]);
        await db.from("capability_discovery_candidates").update({ status: "testing", last_test_enqueued_at: now.toISOString() }).eq("id", c.id);
      }
    }
  }
  return report;
}

export const DISCOVERY_INTERVAL_MIN = 60;

/** Runs discovery at most once per interval; the run itself is recorded as a discovery evidence step. */
export async function runDiscoveryIfDue(db: Db, now = new Date()): Promise<DiscoveryReport | { skipped: string }> {
  const { data: last } = await db.from("fkaios_execution_steps").select("created_at").eq("step_kind", "discovery")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (last?.created_at && now.getTime() - new Date(last.created_at).getTime() < DISCOVERY_INTERVAL_MIN * 60_000) {
    return { skipped: `last discovery at ${last.created_at}` };
  }
  const started = Date.now();
  // Claim the interval first so overlapping ticks do not both run discovery.
  const { data: step } = await db.from("fkaios_execution_steps").insert({
    step_kind: "discovery", resource_ref: "tool:fkaios:capability-discovery", tool_ref: "tool:fkaios:capability-discovery",
    started_at: new Date(started).toISOString(), outcome: "attempted",
  }).select("id").single();
  try {
    const report = await runCapabilityDiscovery(db, (k) => Deno.env.get(k), now);
    await db.from("fkaios_execution_steps").update({
      outcome: "completed", finished_at: new Date().toISOString(), duration_ms: Date.now() - started,
      selection: { providers: report.providers, new_models: report.newModels, retired: report.retired, queued: report.queued },
    }).eq("id", step?.id);
    return report;
  } catch (err) {
    await db.from("fkaios_execution_steps").update({ outcome: "failed", finished_at: new Date().toISOString(), duration_ms: Date.now() - started, error: err instanceof Error ? err.message : String(err) }).eq("id", step?.id);
    throw err;
  }
}
