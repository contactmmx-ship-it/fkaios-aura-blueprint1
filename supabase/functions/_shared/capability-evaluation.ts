// CONTROLLED CAPABILITY EVALUATION, INCUMBENT COMPARISON, GOVERNED ADOPTION
// AND ROLLBACK.
//
//   capability_test_queue (leased) ─► golden cases (fkaios_eval_cases), each run
//   on the candidate AND on the resource production routes that task class to
//   today (the actual incumbent) ─► deterministic scoring in code (the model
//   under test never grades itself) ─► fkaios_verification_evidence +
//   capability_benchmarks (verified=true only with that evidence) ─► verdict:
//   candidate verified (usable as fallback) or rejected ─► if clearly better
//   than the incumbent, an adoption proposal ─► governance: autonomous policy
//   when it is safe, otherwise a founder approval in the Decision Center ─►
//   fkaios_adopt_routing (versioned, monitored) ─► monitoring ─►
//   fkaios_rollback_routing when the adopted resource degrades.
//
// The executor is resumable: progress lives on the queue row, each tick runs a
// small batch, and a lease token (lease_expires_at compare-and-swap) keeps two
// ticks from running the same test.

import { buildDefaultRouterConfig, callLLMOnResources, type ExecutionResource, type ProviderName } from "./llm-router.ts";
import { selectResources } from "./resource-selection.ts";
import { markStepsVerified, recordLLMAttempts } from "./execution-evidence.ts";
import { parseRef } from "./resource-identity.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

// ── Deterministic scoring ────────────────────────────────────────────────
export interface EvalCheck {
  type: string;
  path?: string;
  value?: unknown;
  values?: string[];
  tolerance?: number;
  min?: number;
  max?: number;
  pattern?: string;
  index?: number;
}

export function extractJsonValue(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "");
  for (const c of [t, t.slice(t.indexOf("{"), t.lastIndexOf("}") + 1)]) {
    try { return JSON.parse(c); } catch { /* next */ }
  }
  return null;
}

function getPath(obj: unknown, path = ""): unknown {
  return path.split(".").filter(Boolean).reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), obj);
}

const ci = (v: unknown) => String(v ?? "").trim().toLowerCase();

export function runCheck(parsed: unknown, check: EvalCheck): { ok: boolean; detail: string } {
  const v = getPath(parsed, check.path);
  switch (check.type) {
    case "json_number": {
      const n = typeof v === "number" ? v : Number(String(v ?? "").replace(/[^0-9.\-]/g, ""));
      const ok = Number.isFinite(n) && Math.abs(n - Number(check.value)) <= (check.tolerance ?? 0);
      return { ok, detail: `${check.path}=${JSON.stringify(v)} expected ${check.value}` };
    }
    case "json_equals_ci":
      return { ok: ci(v) === ci(check.value), detail: `${check.path}=${JSON.stringify(v)} expected ${JSON.stringify(check.value)}` };
    case "json_array_equals_ci": {
      const exp = (check.value as unknown[]) ?? [];
      const ok = Array.isArray(v) && v.length === exp.length && v.every((x, i) => ci(x) === ci(exp[i]));
      return { ok, detail: `${check.path}=${JSON.stringify(v)} expected ${JSON.stringify(exp)}` };
    }
    case "json_array_len": {
      const ok = Array.isArray(v) && v.length >= (check.min ?? 0) && v.length <= (check.max ?? Infinity);
      return { ok, detail: `${check.path} length ${Array.isArray(v) ? v.length : "n/a"} in [${check.min},${check.max}]` };
    }
    case "json_array_item_matches": {
      const item = Array.isArray(v) ? v[check.index ?? 0] : undefined;
      return { ok: new RegExp(check.pattern ?? "", "i").test(String(item ?? "")), detail: `${check.path}[${check.index}] ~ /${check.pattern}/` };
    }
    case "json_array_any_matches": {
      const re = new RegExp(check.pattern ?? "", "i");
      return { ok: Array.isArray(v) && v.some((x) => re.test(String(x))), detail: `some ${check.path} ~ /${check.pattern}/` };
    }
    case "json_max_words": {
      const words = String(v ?? "").trim().split(/\s+/).filter(Boolean).length;
      return { ok: typeof v === "string" && words > 0 && words <= (check.max ?? Infinity), detail: `${words} words <= ${check.max}` };
    }
    case "json_contains_all_ci": {
      const s = ci(v);
      const missing = (check.values ?? []).filter((x) => !s.includes(ci(x)));
      return { ok: typeof v === "string" && missing.length === 0, detail: missing.length ? `missing ${missing.join(", ")}` : "all present" };
    }
    case "json_sentence_count": {
      const n = String(v ?? "").split(/(?<=[.!?])\s+/).map((x) => x.trim()).filter((x) => x.length > 0).length;
      return { ok: n === Number(check.value), detail: `${n} sentences, expected ${check.value}` };
    }
    default:
      return { ok: false, detail: `unknown check type ${check.type}` };
  }
}

export function scoreCase(output: string, checks: EvalCheck[]): { score: number; passed: boolean; results: Array<{ type: string; ok: boolean; detail: string }> } {
  const parsed = extractJsonValue(output);
  if (parsed === null) return { score: 0, passed: false, results: [{ type: "parse", ok: false, detail: "output is not JSON" }] };
  const results = checks.map((c) => ({ type: c.type, ...runCheck(parsed, c) }));
  const okCount = results.filter((r) => r.ok).length;
  return { score: checks.length ? okCount / checks.length : 0, passed: okCount === checks.length, results };
}

// ── Decisions (pure, unit-tested) ────────────────────────────────────────
export const VERIFY_THRESHOLD = 0.6;
export const ADOPT_MARGIN = 0.15;
export const AUTONOMOUS_MIN_SCORE = 0.75;

export interface ComparisonInput {
  candidateByClass: Record<string, number[]>;
  incumbentByClass: Record<string, { ref: string; scores: number[] }>;
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function compareToIncumbents(input: ComparisonInput): {
  candidateOverall: number;
  improved: Array<{ taskClass: string; candidate: number; incumbent: number; incumbentRef: string }>;
  regressions: Array<{ taskClass: string; candidate: number; incumbent: number; incumbentRef: string }>;
} {
  const all = Object.values(input.candidateByClass).flat();
  type Delta = { taskClass: string; candidate: number; incumbent: number; incumbentRef: string };
  const improved: Delta[] = [];
  const regressions: Delta[] = [];
  for (const [taskClass, scores] of Object.entries(input.candidateByClass)) {
    const inc = input.incumbentByClass[taskClass];
    if (!inc) continue;
    const c = mean(scores), i = mean(inc.scores);
    if (c >= i + ADOPT_MARGIN) improved.push({ taskClass, candidate: c, incumbent: i, incumbentRef: inc.ref });
    else if (c < i) regressions.push({ taskClass, candidate: c, incumbent: i, incumbentRef: inc.ref });
  }
  return { candidateOverall: mean(all), improved, regressions };
}

/**
 * Autonomous adoption policy v1: a candidate may replace an incumbent without
 * a founder decision only when it costs nothing extra (known free tier, or
 * known price not above the incumbent's), it is reachable with an existing
 * key, it scored well overall, and it regressed in no task class. Everything
 * else goes to the founder.
 */
export function adoptionGovernance(input: {
  candidateOverall: number;
  regressions: number;
  candidateFreeTier: boolean | null;
  candidateCostIn: number | null;
  incumbentCostIn: number | null;
  accessConfigured: boolean;
}): { mode: "autonomous" | "founder"; reason: string } {
  const costKnownNoHigher = input.candidateFreeTier === true ||
    (input.candidateCostIn !== null && input.incumbentCostIn !== null && input.candidateCostIn <= input.incumbentCostIn);
  if (!input.accessConfigured) return { mode: "founder", reason: "candidate is not reachable with a configured key" };
  if (!costKnownNoHigher) return { mode: "founder", reason: "candidate cost is unknown or higher than the incumbent's" };
  if (input.regressions > 0) return { mode: "founder", reason: `candidate regressed in ${input.regressions} task class(es)` };
  if (input.candidateOverall < AUTONOMOUS_MIN_SCORE) return { mode: "founder", reason: `overall score ${input.candidateOverall.toFixed(2)} below ${AUTONOMOUS_MIN_SCORE}` };
  return { mode: "autonomous", reason: "policy:autonomous_adoption_v1 (no extra cost, configured, no regressions, high score)" };
}

/** Post-adoption rollback rule: thin evidence never triggers it; clear underperformance or unavailability does. */
export function shouldRollback(input: { lifecycle: string; healthStatus: string; lastFailureCategory: string | null; sampleSize: number; verifiedCount: number; baselineRate: number | null }): { rollback: boolean; reason: string } {
  if (input.lifecycle === "retired" || input.lifecycle === "degraded") return { rollback: true, reason: `adopted resource is ${input.lifecycle}` };
  if (input.healthStatus === "unavailable" && input.lastFailureCategory === "model_unavailable") return { rollback: true, reason: "adopted model is no longer served (model_unavailable)" };
  if (input.sampleSize >= 5) {
    const rate = input.verifiedCount / input.sampleSize;
    const floor = Math.max(0.5, (input.baselineRate ?? 0.5) - 0.25);
    if (rate < floor) return { rollback: true, reason: `verified rate ${rate.toFixed(2)} on ${input.sampleSize} outcomes is below ${floor.toFixed(2)} since adoption` };
  }
  return { rollback: false, reason: "within tolerance" };
}

// ── Executor ─────────────────────────────────────────────────────────────
export const EXECUTOR = "fkaios-capability-evaluator";
const LEASE_SECONDS = 900;
const BATCH = 4;
const DEFAULT_BUDGET_USD = 0.05;
const INCUMBENT_REUSE_HOURS = 24;

interface EvalCase { id: string; suite: string; suite_version: number; case_key: string; task_class: string; system_prompt: string; prompt: string; checks: EvalCheck[] }
interface CaseResult { score: number; passed: boolean; step_id: string | null; latency_ms: number | null; error?: string; reused?: boolean }
interface Progress { suite_version: number; incumbents: Record<string, string>; results: Record<string, Record<string, CaseResult>>; spent_usd: number; deferrals?: number; last_deferral?: string | null }

/**
 * A test whose resource keeps failing transiently (a free-tier daily quota,
 * sustained overload) must not hold the executor forever: one such candidate
 * starved the whole queue overnight on 8 Oct 2026. After this many consecutive
 * deferrals without progress the test is cancelled (not judged) and the
 * candidate is left for discovery to re-queue later.
 */
export const MAX_CANDIDATE_DEFERRALS = 5;
export const MAX_INCUMBENT_DEFERRALS = 10;

/** Pure: what to do with a test after a batch that made no progress. */
export function deferralDecision(prog: Progress, deferredRef: string, candidateRef: string): { cancel: boolean; reason: string | null } {
  const n = prog.deferrals ?? 0;
  const onCandidate = deferredRef === candidateRef;
  if (onCandidate && n >= MAX_CANDIDATE_DEFERRALS) return { cancel: true, reason: `candidate quota/capacity exhausted (${n} consecutive deferrals); left for discovery to re-queue` };
  if (!onCandidate && n >= MAX_INCUMBENT_DEFERRALS) return { cancel: true, reason: `incumbent ${deferredRef} unavailable (${n} consecutive deferrals); left for discovery to re-queue` };
  return { cancel: false, reason: null };
}

function resourceFromRef(ref: string): ExecutionResource | null {
  const p = parseRef(ref);
  return p?.kind === "model" && p.provider ? { ref, provider: p.provider as ProviderName, model: p.name } : null;
}

/** Continue our own leased test (renewing the lease atomically) or claim the next one. */
async function acquireTest(db: Db): Promise<Record<string, unknown> | null> {
  const { data: mine } = await db.from("capability_test_queue").select("*").eq("status", "running").eq("lease_owner", EXECUTOR)
    .gt("lease_expires_at", new Date().toISOString()).order("started_at", { ascending: true }).limit(1).maybeSingle();
  if (mine) {
    const { data: renewed } = await db.from("capability_test_queue")
      .update({ lease_expires_at: new Date(Date.now() + LEASE_SECONDS * 1000).toISOString() })
      .eq("id", mine.id).eq("lease_expires_at", mine.lease_expires_at).select("*").maybeSingle();
    return renewed ?? null; // another tick renewed it first: it owns this batch
  }
  const { data: claimed } = await db.rpc("fkaios_claim_capability_test", { p_owner: EXECUTOR, p_lease_seconds: LEASE_SECONDS });
  return (Array.isArray(claimed) ? claimed[0] : claimed) ?? null;
}

async function finish(db: Db, id: string, status: "passed" | "failed" | "cancelled", evidence: unknown, error?: string) {
  await db.rpc("fkaios_finish_capability_test", { p_id: id, p_owner: EXECUTOR, p_status: status, p_evidence: evidence, p_error: error ?? null });
}

export async function runCapabilityTestStep(db: Db): Promise<Record<string, unknown>> {
  const test = await acquireTest(db);
  if (!test) return { idle: true };
  const testId = String(test.id);
  const { data: cand } = await db.from("capability_discovery_candidates").select("id,resource_key,provider,model").eq("id", test.candidate_id).maybeSingle();
  const candidate = cand ? resourceFromRef(String(cand.resource_key)) : null;
  if (!candidate) { await finish(db, testId, "cancelled", test.evidence, "candidate is not a model resource"); return { test: testId, cancelled: "not a model" }; }
  const { data: reg } = await db.from("model_registry").select("resource_ref,access_state,free_tier,cost_in_per_mtok,lifecycle_state").eq("resource_ref", candidate.ref).maybeSingle();
  if (!reg || reg.access_state !== "configured") {
    await finish(db, testId, "cancelled", test.evidence, `candidate not reachable: access ${reg?.access_state ?? "unregistered"}`);
    await db.from("capability_discovery_candidates").update({ status: "blocked" }).eq("id", cand.id);
    return { test: testId, cancelled: `access ${reg?.access_state ?? "unregistered"}`, candidate: candidate.ref };
  }

  const suite = "fkaios_core";
  const { data: versionRow } = await db.from("fkaios_eval_cases").select("suite_version").eq("suite", suite).eq("active", true).order("suite_version", { ascending: false }).limit(1).maybeSingle();
  const suiteVersion = Number(versionRow?.suite_version ?? 1);
  const { data: caseRows } = await db.from("fkaios_eval_cases").select("*").eq("suite", suite).eq("suite_version", suiteVersion).eq("active", true);
  const cases = (caseRows ?? []) as EvalCase[];
  const prog: Progress = { suite_version: suiteVersion, incumbents: {}, results: {}, spent_usd: 0, ...(((test.evidence as Record<string, unknown>)?.progress ?? {}) as Partial<Progress>) } as Progress;

  // The actual incumbent: what production routing picks for this class right now.
  const classes = [...new Set(cases.map((c) => c.task_class))];
  for (const cls of classes) {
    if (prog.incumbents[cls]) continue;
    const sel = await selectResources(db, cls, { purpose: "production", exclude: [candidate.ref] });
    if (sel.resources[0]) prog.incumbents[cls] = sel.resources[0].ref;
  }
  // Reuse incumbent results from a recent run of the same suite version.
  const since = new Date(Date.now() - INCUMBENT_REUSE_HOURS * 3600_000).toISOString();
  for (const incRef of new Set(Object.values(prog.incumbents))) {
    if (prog.results[incRef]) continue;
    const { data: prior } = await db.from("capability_benchmarks").select("evidence,quality_score,success").eq("resource_key", incRef).eq("benchmark_suite", `${suite}@${suiteVersion}`).gte("created_at", since);
    if ((prior ?? []).length) {
      prog.results[incRef] = {};
      for (const b of prior as Array<{ evidence: Record<string, unknown>; quality_score: number; success: boolean }>) {
        const key = String(b.evidence?.case_key ?? "");
        if (key) prog.results[incRef][key] = { score: Number(b.quality_score) / 100, passed: b.success, step_id: null, latency_ms: null, reused: true };
      }
    }
  }

  // Remaining work: candidate on every case, each incumbent on its class's cases.
  const todo: Array<{ res: ExecutionResource; c: EvalCase }> = [];
  for (const c of cases) {
    if (!prog.results[candidate.ref]?.[c.case_key]) todo.push({ res: candidate, c });
    const inc = prog.incumbents[c.task_class] ? resourceFromRef(prog.incumbents[c.task_class]) : null;
    if (inc && !prog.results[inc.ref]?.[c.case_key]) todo.push({ res: inc, c });
  }

  const budget = Math.max(Number(test.budget_usd ?? 0), DEFAULT_BUDGET_USD);
  let deferred: string | null = null;
  let deferredRef: string | null = null;
  const resultsBefore = Object.values(prog.results).reduce((n, byCase) => n + Object.keys(byCase).length, 0);
  for (const { res, c } of todo.slice(0, BATCH)) {
    if (prog.spent_usd >= budget) { deferred = "budget"; break; }
    const startedAt = new Date();
    const r = await callLLMOnResources(
      { systemPrompt: c.system_prompt, userContent: c.prompt, functionName: "capability-evaluator", functionClass: "background_agent", temperature: 0, maxTokens: 1024 },
      buildDefaultRouterConfig(), [res],
    );
    const stepIds = await recordLLMAttempts(db, { stepKind: "evaluation", taskClass: c.task_class }, r.log, null, r.content ?? null, startedAt);
    prog.spent_usd += Number(r.log.estimated_cost_usd ?? 0);
    const failure = r.log.attempts[r.log.attempts.length - 1]?.failureCategory ?? null;
    if (r.status !== "success") {
      if (failure === "rate_limit" || failure === "timeout" || failure === "provider_outage") { deferred = `${res.ref}: ${failure}`; deferredRef = res.ref; break; }
      // Any other failure is a real result for that resource on that case.
      prog.results[res.ref] = { ...(prog.results[res.ref] ?? {}), [c.case_key]: { score: 0, passed: false, step_id: stepIds.at(-1) ?? null, latency_ms: r.log.latency_ms, error: failure ?? r.status } };
      if (res.ref === candidate.ref && failure === "model_unavailable") break;
      continue;
    }
    const s = scoreCase(r.content ?? "", c.checks);
    prog.results[res.ref] = { ...(prog.results[res.ref] ?? {}), [c.case_key]: { score: s.score, passed: s.passed, step_id: stepIds.at(-1) ?? null, latency_ms: r.log.latency_ms } };
  }

  const candidateResults = prog.results[candidate.ref] ?? {};
  const candidateUnavailable = Object.values(candidateResults).some((x) => x.error === "model_unavailable");
  const done = candidateUnavailable || cases.every((c) => candidateResults[c.case_key] && (!prog.incumbents[c.task_class] || prog.results[prog.incumbents[c.task_class]]?.[c.case_key]));
  if (!done) {
    if (prog.spent_usd >= budget) { await finish(db, testId, "failed", { progress: prog }, `budget ${budget} USD exhausted`); return { test: testId, failed: "budget" }; }
    const resultsAfter = Object.values(prog.results).reduce((n, byCase) => n + Object.keys(byCase).length, 0);
    if (deferredRef && resultsAfter === resultsBefore) {
      prog.deferrals = (prog.deferrals ?? 0) + 1;
      prog.last_deferral = deferred;
      const decision = deferralDecision(prog, deferredRef, candidate.ref);
      if (decision.cancel) {
        await finish(db, testId, "cancelled", { progress: prog }, decision.reason ?? "deferred too often");
        // Not a verdict: the candidate returns to the pool and its registry row to 'discovered'.
        await db.from("capability_discovery_candidates").update({ status: "eligible" }).eq("id", cand.id);
        await db.from("model_registry").update({ lifecycle_state: "discovered", updated_at: new Date().toISOString() }).eq("resource_ref", candidate.ref).eq("lifecycle_state", "testing");
        return { test: testId, candidate: candidate.ref, cancelled: decision.reason };
      }
    } else if (resultsAfter > resultsBefore) {
      prog.deferrals = 0;
      prog.last_deferral = null;
    }
    await db.from("capability_test_queue").update({ evidence: { progress: prog } }).eq("id", testId).eq("lease_owner", EXECUTOR);
    return { test: testId, candidate: candidate.ref, progressed: true, remaining: todo.length - Math.min(BATCH, todo.length), deferred };
  }
  return await finalizeTest(db, { testId, candidateId: String(cand.id), candidate, registry: reg, cases, prog, suite, candidateUnavailable });
}

async function finalizeTest(db: Db, a: { testId: string; candidateId: string; candidate: ExecutionResource; registry: Record<string, unknown>; cases: EvalCase[]; prog: Progress; suite: string; candidateUnavailable: boolean }): Promise<Record<string, unknown>> {
  const { prog, candidate, cases } = a;
  const suiteKey = `${a.suite}@${prog.suite_version}`;
  const candidateByClass: Record<string, number[]> = {};
  const incumbentByClass: Record<string, { ref: string; scores: number[] }> = {};
  for (const c of cases) {
    const cr = prog.results[candidate.ref]?.[c.case_key];
    if (cr) (candidateByClass[c.task_class] ??= []).push(cr.score);
    const incRef = prog.incumbents[c.task_class];
    const ir = incRef ? prog.results[incRef]?.[c.case_key] : undefined;
    if (incRef && ir) (incumbentByClass[c.task_class] ??= { ref: incRef, scores: [] }).scores.push(ir.score);
  }
  const cmp = compareToIncumbents({ candidateByClass, incumbentByClass });
  const verified = !a.candidateUnavailable && cmp.candidateOverall >= VERIFY_THRESHOLD;

  // One deterministic evidence row backs every benchmark row of this test.
  const { data: ev } = await db.from("fkaios_verification_evidence").insert({
    requirement_key: `eval:${suiteKey}`, evidence_type: "golden_eval", verifier: `deterministic:${suiteKey}`,
    status: verified ? "passed" : "failed",
    observed_result: { candidate: candidate.ref, candidate_overall: cmp.candidateOverall, candidate_by_class: candidateByClass, incumbents: incumbentByClass, improved: cmp.improved, regressions: cmp.regressions, test_id: a.testId },
    verification_notes: `Golden suite ${suiteKey}: ${candidate.ref} scored ${cmp.candidateOverall.toFixed(2)} (threshold ${VERIFY_THRESHOLD}).`,
    verified_at: new Date().toISOString(),
  }).select("id").single();
  const evidenceId = ev?.id ?? null;

  const { data: caps } = await db.from("capability_registry").select("id,name").like("name", "llm:%");
  const capId = new Map(((caps ?? []) as Array<{ id: string; name: string }>).map((r) => [r.name.slice(4), r.id]));
  const rows: Record<string, unknown>[] = [];
  const stepVerdicts: Array<{ id: string; ok: boolean; score: number }> = [];
  for (const [ref, byCase] of Object.entries(prog.results)) {
    const res = resourceFromRef(ref);
    for (const c of cases) {
      const r = byCase[c.case_key];
      if (!r || r.reused || !res || !capId.get(c.task_class)) continue;
      rows.push({ capability_id: capId.get(c.task_class), resource_key: ref, provider: res.provider, model: res.model, task_type: c.task_class,
        benchmark_suite: suiteKey, success: r.passed, verified: evidenceId !== null, verification_evidence_id: evidenceId,
        quality_score: Math.round(r.score * 100), latency_ms: r.latency_ms, evidence: { case_key: c.case_key, step_id: r.step_id, error: r.error ?? null, test_id: a.testId } });
      if (r.step_id) stepVerdicts.push({ id: r.step_id, ok: r.passed, score: r.score });
    }
  }
  if (rows.length) await db.from("capability_benchmarks").insert(rows);
  for (const s of stepVerdicts) await markStepsVerified(db, { stepIds: [s.id] }, s.ok ? "verified" : "rejected", evidenceId, s.score);

  await db.from("model_registry").update({ lifecycle_state: verified ? "verified" : (a.candidateUnavailable ? "retired" : "available"), updated_at: new Date().toISOString(),
    metadata: { last_eval: { suite: suiteKey, overall: cmp.candidateOverall, at: new Date().toISOString(), evidence_id: evidenceId } } })
    .eq("resource_ref", candidate.ref).in("lifecycle_state", ["discovered", "available", "testing", "verified", "candidate"]);
  await db.from("capability_discovery_candidates").update({ status: verified ? "verified" : "rejected" }).eq("id", a.candidateId);

  const proposals: unknown[] = [];
  if (verified) {
    for (const imp of cmp.improved) {
      if (imp.incumbentRef === candidate.ref) continue;
      proposals.push(await proposeAdoption(db, { taskClass: imp.taskClass, candidate, incumbentRef: imp.incumbentRef, candidateScore: imp.candidate, incumbentScore: imp.incumbent, overall: cmp.candidateOverall, regressions: cmp.regressions.length, registry: a.registry, suiteKey, evidenceId, capabilityId: capId.get(imp.taskClass) ?? null, cases: (candidateByClass[imp.taskClass] ?? []).length }));
    }
  }
  await finish(db, a.testId, verified ? "passed" : "failed", { progress: prog, result: { overall: cmp.candidateOverall, verified, improved: cmp.improved, regressions: cmp.regressions, evidence_id: evidenceId } }, verified ? undefined : (a.candidateUnavailable ? "candidate model unavailable" : `score ${cmp.candidateOverall.toFixed(2)} below ${VERIFY_THRESHOLD}`));
  return { test: a.testId, candidate: candidate.ref, verified, overall: cmp.candidateOverall, improved: cmp.improved.map((i) => i.taskClass), regressions: cmp.regressions.map((r) => r.taskClass), proposals };
}

async function proposeAdoption(db: Db, p: { taskClass: string; candidate: ExecutionResource; incumbentRef: string; candidateScore: number; incumbentScore: number; overall: number; regressions: number; registry: Record<string, unknown>; suiteKey: string; evidenceId: string | null; capabilityId: string | null; cases: number }): Promise<Record<string, unknown>> {
  if (!p.capabilityId) return { skipped: "no capability row" };
  const { data: inc } = await db.from("model_registry").select("cost_in_per_mtok").eq("resource_ref", p.incumbentRef).maybeSingle();
  const gov = adoptionGovernance({ candidateOverall: p.overall, regressions: p.regressions, candidateFreeTier: (p.registry.free_tier as boolean | null) ?? null,
    candidateCostIn: (p.registry.cost_in_per_mtok as number | null) ?? null, incumbentCostIn: (inc?.cost_in_per_mtok as number | null) ?? null, accessConfigured: p.registry.access_state === "configured" });
  const evidence = { suite: p.suiteKey, verification_evidence_id: p.evidenceId, candidate_score: p.candidateScore, incumbent_score: p.incumbentScore, overall: p.overall, regressions: p.regressions, governance: gov };
  const { data: proposal } = await db.from("capability_adoption_proposals").insert({
    capability_id: p.capabilityId, candidate_resource_key: p.candidate.ref, incumbent_resource_key: p.incumbentRef, benchmark_suite: p.suiteKey,
    candidate_score: Math.round(p.candidateScore * 100), incumbent_score: Math.round(p.incumbentScore * 100),
    improvement_pct: Math.round((p.candidateScore - p.incumbentScore) * 100), confidence_pct: Math.min(100, p.cases * 25), recommendation: "candidate", evidence,
  }).select("id").single();
  if (!proposal) return { skipped: "proposal insert failed" };

  const description = `Route ${p.taskClass} work to ${p.candidate.ref} instead of ${p.incumbentRef}: golden suite ${p.suiteKey} score ${(p.candidateScore * 100).toFixed(0)} vs ${(p.incumbentScore * 100).toFixed(0)}.`;
  if (gov.mode === "autonomous") {
    const { data: appr } = await db.from("approvals").insert({ requested_by_agent: "fkaios-capability-evaluator", department_code: null, action_type: "capability_adoption",
      payload: { proposal_id: proposal.id, task_class: p.taskClass, candidate: p.candidate.ref, incumbent: p.incumbentRef, evidence }, risk_level: "low",
      reason: `${description} Decided by policy, not by the founder: ${gov.reason}.`, status: "approved", decided_by: "policy:autonomous_adoption_v1", decided_at: new Date().toISOString() }).select("id").single();
    const { data: policyId, error } = await db.rpc("fkaios_adopt_routing", { p_task_class: p.taskClass, p_resource_ref: p.candidate.ref, p_proposal_id: proposal.id, p_approval_id: appr?.id, p_reason: description, p_evidence: evidence, p_monitor_hours: 72 });
    return { proposal: proposal.id, mode: "autonomous", adopted: !error, policy: policyId ?? null, error: error?.message };
  }
  const { data: appr } = await db.from("approvals").insert({ requested_by_agent: "fkaios-capability-evaluator", department_code: null, action_type: "capability_adoption",
    payload: { proposal_id: proposal.id, task_class: p.taskClass, candidate: p.candidate.ref, incumbent: p.incumbentRef, evidence }, risk_level: "low",
    reason: `${description} Needs founder approval: ${gov.reason}.`, status: "pending" }).select("id").single();
  await db.from("capability_adoption_proposals").update({ approval_id: appr?.id ?? null, evidence: { ...evidence, approval_requested: true } }).eq("id", proposal.id);
  return { proposal: proposal.id, mode: "founder", approval: appr?.id ?? null, reason: gov.reason };
}

/** Founder decisions made in the Decision Center are applied here. */
export async function applyAdoptionDecisions(db: Db): Promise<Record<string, unknown>[]> {
  const { data: open } = await db.from("capability_adoption_proposals").select("id,candidate_resource_key,capability_id,approval_id,evidence").eq("recommendation", "candidate").not("approval_id", "is", null);
  const out: Record<string, unknown>[] = [];
  for (const p of (open ?? []) as Array<Record<string, unknown>>) {
    const { data: appr } = await db.from("approvals").select("status,decided_by,decided_at").eq("id", p.approval_id).maybeSingle();
    if (!appr || appr.status === "pending") continue;
    const { data: cap } = await db.from("capability_registry").select("name").eq("id", p.capability_id).maybeSingle();
    const taskClass = String(cap?.name ?? "").replace(/^llm:/, "");
    if (appr.status === "approved") {
      const { data: policyId, error } = await db.rpc("fkaios_adopt_routing", { p_task_class: taskClass, p_resource_ref: p.candidate_resource_key, p_proposal_id: p.id, p_approval_id: p.approval_id, p_reason: `Founder-approved adoption of ${p.candidate_resource_key} for ${taskClass}.`, p_evidence: p.evidence, p_monitor_hours: 72 });
      out.push({ proposal: p.id, adopted: !error, policy: policyId ?? null, error: error?.message });
    } else {
      await db.from("capability_adoption_proposals").update({ recommendation: "rejected", decided_at: appr.decided_at ?? new Date().toISOString(), decided_by: appr.decided_by ?? "founder" }).eq("id", p.id);
      out.push({ proposal: p.id, rejected: true });
    }
  }
  return out;
}

/** Post-adoption monitoring with automatic rollback. */
export async function monitorAdoptions(db: Db): Promise<Record<string, unknown>[]> {
  const { data: policies } = await db.from("fkaios_routing_policies").select("id,task_class,resource_refs,effective_at,monitor_until,rollback_to_id,evidence").eq("status", "active").not("rollback_to_id", "is", null).eq("created_by", "fkaios_adopt_routing");
  const out: Record<string, unknown>[] = [];
  for (const pol of (policies ?? []) as Array<Record<string, unknown>>) {
    const top = (pol.resource_refs as string[])[0];
    const { data: reg } = await db.from("model_registry").select("lifecycle_state,health_status,last_failure_category").eq("resource_ref", top).maybeSingle();
    const { data: steps } = await db.from("fkaios_execution_steps").select("verification_status").eq("resource_ref", top).eq("task_class", pol.task_class).neq("step_kind", "evaluation")
      .in("verification_status", ["verified", "rejected", "partially_verified"]).gte("created_at", pol.effective_at);
    const sample = (steps ?? []).length;
    const verifiedCount = ((steps ?? []) as Array<{ verification_status: string }>).filter((s) => s.verification_status === "verified").length;
    const baseline = Number((pol.evidence as Record<string, unknown>)?.candidate_score ?? NaN);
    const d = shouldRollback({ lifecycle: String(reg?.lifecycle_state ?? "unknown"), healthStatus: String(reg?.health_status ?? "unknown"), lastFailureCategory: reg?.last_failure_category ?? null, sampleSize: sample, verifiedCount, baselineRate: Number.isFinite(baseline) ? baseline : null });
    if (!d.rollback) continue;
    const { data: newId, error } = await db.rpc("fkaios_rollback_routing", { p_policy_id: pol.id, p_reason: d.reason, p_evidence: { sample, verified: verifiedCount, lifecycle: reg?.lifecycle_state ?? null, health: reg?.health_status ?? null } });
    out.push({ policy: pol.id, task_class: pol.task_class, rolled_back: !error, new_policy: newId ?? null, reason: d.reason, error: error?.message });
  }
  return out;
}

/** One evaluation tick: apply founder decisions, monitor adoptions, advance one test. */
export async function runEvaluationTick(db: Db): Promise<Record<string, unknown>> {
  const out: Record<string, unknown> = {};
  try { out.decisions = await applyAdoptionDecisions(db); } catch (e) { out.decisions_error = String(e); }
  try { out.monitoring = await monitorAdoptions(db); } catch (e) { out.monitoring_error = String(e); }
  try { out.test = await runCapabilityTestStep(db); } catch (e) { out.test_error = String(e); }
  return out;
}
