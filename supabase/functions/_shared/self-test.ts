// PRODUCTION SELF-TEST — exercises the real execution paths against the real
// configured resources, without creating an objective or touching any
// approval gate. A row in fkaios_self_tests with status 'requested' makes the
// next founder-brain tick run these scenarios and record the results:
//   model_failover   a model the provider does not serve fails as
//                    model_unavailable and the next model of the same
//                    provider answers (resource switch recorded as evidence)
//   continuation     a response cut off at the output-token limit is
//                    continued from a checkpoint until complete
//   verifier_reject  the independent verifier rejects a wrong deliverable
//   verifier_pass    the independent verifier passes a correct one

import { buildDefaultRouterConfig, callLLMOnResources, type ExecutionResource, type LLMRequest } from "./llm-router.ts";
import { selectResources } from "./resource-selection.ts";
import { recordLLMAttempts } from "./execution-evidence.ts";
import { callWithContinuation } from "./continuation.ts";
import { verifyObjective } from "./objective-verifier.ts";

// deno-lint-ignore no-explicit-any
type Db = any;

interface ScenarioResult { scenario: string; passed: boolean; details: Record<string, unknown> }

const NONEXISTENT_MODEL = "fkaios-selftest-model-that-does-not-exist";

async function modelFailover(db: Db): Promise<ScenarioResult> {
  const sel = await selectResources(db, "general");
  const real = sel.resources.find((r) => r.provider === "gemini") ?? sel.resources[0];
  if (!real) return { scenario: "model_failover", passed: false, details: { error: "no production resource available" } };
  const fake: ExecutionResource = { ref: `model:${real.provider}:${NONEXISTENT_MODEL}`, provider: real.provider, model: NONEXISTENT_MODEL };
  const started = new Date();
  const r = await callLLMOnResources({ systemPrompt: "Return ONLY JSON.", userContent: 'Return {"ok": true}.', functionName: "self-test", functionClass: "background_agent", temperature: 0, maxTokens: 64 }, buildDefaultRouterConfig(), [fake, real]);
  await recordLLMAttempts(db, { stepKind: "evaluation", taskClass: "general" }, r.log, sel, r.content ?? null, started);
  const cats = r.log.attempts.map((a) => a.failureCategory);
  return { scenario: "model_failover", passed: r.status === "success" && r.resource?.ref === real.ref && cats[0] === "model_unavailable",
    details: { attempts: r.log.attempts.map((a) => ({ model: a.model, outcome: a.outcome, category: a.failureCategory })), served_by: r.resource?.ref ?? null } };
}

async function continuation(db: Db): Promise<ScenarioResult> {
  const sel = await selectResources(db, "writing");
  const request: LLMRequest = { systemPrompt: "You are a writer. Plain text only.", userContent: "Write exactly 5 numbered sentences about how a franchise network grows, one per line, then the line END.", functionName: "self-test", functionClass: "background_agent", temperature: 0, maxTokens: 40 };
  const route = async (req: LLMRequest) => {
    const started = new Date();
    const r = await callLLMOnResources(req, buildDefaultRouterConfig(), sel.resources);
    await recordLLMAttempts(db, { stepKind: req.userContent.includes("[CONTINUATION CHECKPOINT") ? "continuation" : "evaluation", taskClass: "writing" }, r.log, sel, r.content ?? null, started);
    return r;
  };
  try {
    const out = await callWithContinuation(route, request, 4);
    return { scenario: "continuation", passed: out.continuations >= 1 && /END\s*$/.test(out.text.trim()),
      details: { continuations: out.continuations, chars: out.text.length, ends_with_end: /END\s*$/.test(out.text.trim()), tail: out.text.slice(-120) } };
  } catch (err) {
    return { scenario: "continuation", passed: false, details: { error: err instanceof Error ? err.message : String(err) } };
  }
}

async function verifier(db: Db, good: boolean): Promise<ScenarioResult> {
  const objective = "List the three primary colours of light, and say which two of them combine to make yellow light.";
  const deliverable = good
    ? "The three primary colours of light are red, green and blue. Red and green light combine to make yellow light."
    : "The three primary colours of light are red, yellow and blue. Blue and yellow light combine to make green light.";
  const v = await verifyObjective(db, { objectiveId: null, requirementKey: "self_test:objective_verifier", projectId: null, objective, criteria: [], deliverable, evidence: "", producerRefs: [], producingTaskIds: [] });
  const expected = good;
  return { scenario: good ? "verifier_pass" : "verifier_reject", passed: v.available && v.passed === expected,
    details: { verdict: v.passed, available: v.available, quality: v.quality, verifier: v.verifierRef, independence: v.independence, issues: v.issues.slice(0, 4), evidence_id: v.evidenceId ?? null } };
}

export async function runSelfTestIfRequested(db: Db): Promise<Record<string, unknown> | null> {
  const { data: req } = await db.from("fkaios_self_tests").select("id").eq("status", "requested").order("requested_at").limit(1).maybeSingle();
  if (!req) return null;
  const { data: claimed } = await db.from("fkaios_self_tests").update({ status: "running", started_at: new Date().toISOString() }).eq("id", req.id).eq("status", "requested").select("id").maybeSingle();
  if (!claimed) return null; // another tick took it
  const results: ScenarioResult[] = [];
  for (const run of [modelFailover, continuation, (db: Db) => verifier(db, false), (db: Db) => verifier(db, true)]) {
    try { results.push(await run(db)); } catch (err) { results.push({ scenario: run.name || "scenario", passed: false, details: { error: err instanceof Error ? err.message : String(err) } }); }
    await db.from("fkaios_self_tests").update({ results }).eq("id", req.id);
  }
  const passed = results.every((r) => r.passed);
  await db.from("fkaios_self_tests").update({ status: passed ? "passed" : "failed", results, finished_at: new Date().toISOString() }).eq("id", req.id);
  return { self_test: req.id, passed, results: results.map((r) => ({ scenario: r.scenario, passed: r.passed })) };
}
