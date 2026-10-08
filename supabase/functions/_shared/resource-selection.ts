// RESOURCE SELECTION — decides which concrete models may execute a piece of
// work, in which order, and records why. Inputs, all from tables of record:
//   model_registry           resource catalog: lifecycle, access, health (per model)
//   provider_health_state    provider-wide availability (credit, auth, outage)
//   fkaios_routing_policies  the active, versioned routing decision per task class
//   v_fkaios_resource_performance  verified outcomes per resource and task class
//
// rankResources() is pure so the routing rules are unit-tested; selectResources()
// only loads the inputs and calls it.

import type { ExecutionResource, ProviderName } from "./llm-router.ts";
import { parseRef } from "./resource-identity.ts";

export interface CatalogEntry {
  resource_ref: string;
  provider: string;
  model: string;
  lifecycle_state: string;
  access_state: string;
  health_status: string;
  unavailable_until: string | null;
  free_tier: boolean | null;
  cost_in_per_mtok: number | null;
  context_window: number | null;
}

export interface PerformanceEntry {
  resource_ref: string;
  task_class: string | null;
  sample_size: number;
  verified_count: number;
  avg_quality: number | null;
}

export interface RoutingPolicy {
  id: string;
  task_class: string;
  version: number;
  resource_refs: string[];
}

export interface SelectionOptions {
  /** Never use these (hard). */
  exclude?: string[];
  /** Prefer anything else first (soft) — e.g. the resources that produced the work being verified. */
  avoid?: string[];
  /** "evaluation" may use discovered-but-untested resources; production may not. */
  purpose?: "production" | "evaluation";
}

export interface SelectionDecision {
  taskClass: string;
  resources: ExecutionResource[];
  policyId: string | null;
  policyVersion: number | null;
  reasons: string[];
  skipped: Array<{ ref: string; reason: string }>;
}

/** Verified-outcome sample size needed before learning may reorder resources. */
export const MIN_LEARNING_SAMPLES = 5;
/** A policy resource is demoted only when it is clearly worse than an alternative. */
export const DEMOTION_MARGIN = 0.2;

const PRODUCTION_LIFECYCLE = new Set(["adopted", "monitored", "verified", "candidate"]);
const EVALUATION_LIFECYCLE = new Set(["adopted", "monitored", "verified", "candidate", "available", "testing", "discovered"]);
const LIFECYCLE_TIER: Record<string, number> = { adopted: 0, monitored: 1, verified: 2, candidate: 2, available: 3, testing: 3, discovered: 4 };

function verifiedRate(p: PerformanceEntry | undefined): number | null {
  if (!p || p.sample_size < MIN_LEARNING_SAMPLES) return null;
  return p.verified_count / p.sample_size;
}

export function rankResources(input: {
  taskClass: string;
  catalog: CatalogEntry[];
  policy: RoutingPolicy | null;
  performance: PerformanceEntry[];
  configuredProviders: string[];
  unavailableProviders: string[];
  options?: SelectionOptions;
  now?: Date;
}): SelectionDecision {
  const now = input.now ?? new Date();
  const opts = input.options ?? {};
  const purpose = opts.purpose ?? "production";
  const allowed = purpose === "evaluation" ? EVALUATION_LIFECYCLE : PRODUCTION_LIFECYCLE;
  const exclude = new Set(opts.exclude ?? []);
  const avoid = new Set(opts.avoid ?? []);
  const reasons: string[] = [];
  const skipped: Array<{ ref: string; reason: string }> = [];
  const perf = new Map(input.performance.filter((p) => p.task_class === input.taskClass).map((p) => [p.resource_ref, p]));
  const byRef = new Map(input.catalog.map((c) => [c.resource_ref, c]));

  // Policy resources may be missing from the catalog (e.g. a provider default
  // never registered); synthesise a minimal entry from the ref itself.
  for (const ref of input.policy?.resource_refs ?? []) {
    if (byRef.has(ref)) continue;
    const parsed = parseRef(ref);
    if (parsed?.kind !== "model" || !parsed.provider) continue;
    byRef.set(ref, { resource_ref: ref, provider: parsed.provider, model: parsed.name, lifecycle_state: "adopted", access_state: "unknown", health_status: "unknown", unavailable_until: null, free_tier: null, cost_in_per_mtok: null, context_window: null });
  }

  type Scored = { entry: CatalogEntry; policyRank: number; tier: number; penalty: number; learned: number | null };
  const scored: Scored[] = [];
  for (const entry of byRef.values()) {
    const ref = entry.resource_ref;
    const policyRank = input.policy?.resource_refs.indexOf(ref) ?? -1;
    if (exclude.has(ref)) { skipped.push({ ref, reason: "excluded by caller" }); continue; }
    if (entry.lifecycle_state === "retired") { skipped.push({ ref, reason: "retired" }); continue; }
    if (policyRank < 0 && !allowed.has(entry.lifecycle_state)) { skipped.push({ ref, reason: `lifecycle ${entry.lifecycle_state} not allowed for ${purpose}` }); continue; }
    if (!input.configuredProviders.includes(entry.provider)) { skipped.push({ ref, reason: `provider ${entry.provider} not configured` }); continue; }
    if (entry.access_state === "no_credential") { skipped.push({ ref, reason: "no credential" }); continue; }
    // Unavailable resources/providers go last instead of being dropped: if
    // everything else fails, an honest attempt beats refusing outright.
    let penalty = 0;
    if (input.unavailableProviders.includes(entry.provider)) penalty += 2;
    if (entry.unavailable_until && new Date(entry.unavailable_until).getTime() > now.getTime()) penalty += 2;
    if (entry.access_state === "no_credit") penalty += 2;
    if (avoid.has(ref)) penalty += 1;
    scored.push({ entry, policyRank: policyRank < 0 ? Number.MAX_SAFE_INTEGER : policyRank, tier: LIFECYCLE_TIER[entry.lifecycle_state] ?? 5, penalty, learned: verifiedRate(perf.get(ref)) });
  }

  // Learning: a policy resource with enough verified evidence that is clearly
  // worse than another eligible resource with enough evidence is demoted
  // behind it. Noisy or thin evidence never reorders anything.
  const bestLearned = Math.max(-1, ...scored.map((s) => s.learned ?? -1));
  for (const s of scored) {
    if (s.learned !== null && bestLearned >= 0 && bestLearned - s.learned >= DEMOTION_MARGIN && s.policyRank !== Number.MAX_SAFE_INTEGER) {
      s.penalty += 0.5; // behind every healthy resource, ahead of unavailable ones
      reasons.push(`learning: demoted ${s.entry.resource_ref} (verified rate ${s.learned.toFixed(2)} vs best ${bestLearned.toFixed(2)}, n>=${MIN_LEARNING_SAMPLES})`);
    }
  }

  scored.sort((a, b) =>
    a.penalty - b.penalty ||
    a.policyRank - b.policyRank ||
    a.tier - b.tier ||
    (b.learned ?? -1) - (a.learned ?? -1) ||
    Number(b.entry.free_tier === true) - Number(a.entry.free_tier === true) ||
    (a.entry.cost_in_per_mtok ?? 0) - (b.entry.cost_in_per_mtok ?? 0) ||
    a.entry.resource_ref.localeCompare(b.entry.resource_ref)
  );

  if (input.policy) reasons.push(`policy ${input.taskClass} v${input.policy.version}: ${input.policy.resource_refs.join(" > ")}`);
  if (avoid.size) reasons.push(`avoiding (soft): ${[...avoid].join(", ")}`);
  const resources = scored.map((s) => ({ ref: s.entry.resource_ref, provider: s.entry.provider as ProviderName, model: s.entry.model }));
  return { taskClass: input.taskClass, resources, policyId: input.policy?.id ?? null, policyVersion: input.policy?.version ?? null, reasons, skipped };
}

// deno-lint-ignore no-explicit-any
type Db = any;

/** Providers whose API key is present in this runtime (the router can call them). */
export function configuredProviderNames(env: (k: string) => string | undefined = (k) => Deno.env.get(k)): string[] {
  const keys: Array<[string, string]> = [
    ["anthropic", "ANTHROPIC_API_KEY"], ["gemini", "GEMINI_API_KEY"], ["openai", "OPENAI_API_KEY"],
    ["openrouter", "OPENROUTER_API_KEY"], ["groq", "GROQ_API_KEY"], ["mistral", "MISTRAL_API_KEY"],
    ["huggingface", "HUGGINGFACE_API_KEY"], ["self_hosted", "SELF_HOSTED_LLM_BASE_URL"],
  ];
  return keys.filter(([p, k]) => !!env(k) && !["false", "0"].includes(env(`PROVIDER_${p.toUpperCase()}_ENABLED`) ?? "")).map(([p]) => p);
}

export async function selectResources(db: Db, taskClass: string, options: SelectionOptions = {}): Promise<SelectionDecision> {
  const [catalogRes, policyRes, perfRes, healthRes] = await Promise.all([
    db.from("model_registry").select("resource_ref,provider,model,lifecycle_state,access_state,health_status,unavailable_until,free_tier,cost_in_per_mtok,context_window"),
    db.from("fkaios_routing_policies").select("id,task_class,version,resource_refs").eq("task_class", taskClass).eq("status", "active").maybeSingle(),
    db.from("v_fkaios_resource_performance").select("resource_ref,task_class,sample_size,verified_count,avg_quality").eq("task_class", taskClass),
    db.from("provider_health_state").select("provider,status,unavailable_until"),
  ]);
  const now = new Date();
  const unavailableProviders = ((healthRes.data ?? []) as Array<{ provider: string; status: string; unavailable_until: string | null }>)
    .filter((h) => h.status === "unavailable" && h.unavailable_until && new Date(h.unavailable_until) > now)
    .map((h) => h.provider);
  return rankResources({
    taskClass,
    catalog: (catalogRes.data ?? []) as CatalogEntry[],
    policy: (policyRes.data ?? null) as RoutingPolicy | null,
    performance: (perfRes.data ?? []) as PerformanceEntry[],
    configuredProviders: configuredProviderNames(),
    unavailableProviders,
    options,
    now,
  });
}
