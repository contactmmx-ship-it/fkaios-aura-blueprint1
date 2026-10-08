/// <reference lib="deno.ns" />
import { adoptionGovernance, compareToIncumbents, type EvalCheck, scoreCase, shouldRollback } from "./capability-evaluation.ts";

function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}
function assertEquals(actual: unknown, expected: unknown): void {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a !== e) throw new Error(`expected ${e}\n     got ${a}`);
}

// The checks of fkaios_core v1 (supabase/migrations/20261008153814_fkaios_eval_suite_core_v1.sql)
// with a correct and a wrong answer for each.
const SUITE: Array<{ key: string; checks: EvalCheck[]; good: string; bad: string }> = [
  { key: "reasoning_unit_price", checks: [{ type: "json_number", path: "answer", value: 210, tolerance: 0 }], good: '{"answer": 210}', bad: '{"answer": 225}' },
  { key: "reasoning_ordering", checks: [{ type: "json_equals_ci", path: "youngest", value: "Arun" }, { type: "json_equals_ci", path: "oldest", value: "Meena" }], good: '```json\n{"youngest":"arun","oldest":"Meena"}\n```', bad: '{"youngest":"Sita","oldest":"Ravi"}' },
  { key: "extraction_invoice", checks: [{ type: "json_equals_ci", path: "invoice_number", value: "FK-2291" }, { type: "json_equals_ci", path: "customer", value: "Gio Paints" }, { type: "json_number", path: "total_inr", value: 47200, tolerance: 0 }, { type: "json_equals_ci", path: "due_date", value: "2026-09-30" }],
    good: '{"invoice_number":"FK-2291","customer":"Gio Paints","total_inr":"47,200","due_date":"2026-09-30"}', bad: '{"invoice_number":"FK-2291","customer":"Gio Paints","total_inr":40000,"due_date":"2026-09-03"}' },
  { key: "extraction_emails", checks: [{ type: "json_array_equals_ci", path: "active_emails", value: ["sales@gomax.in", "ops@giopaints.com", "media@franchisekart.in"] }],
    good: '{"active_emails":["sales@gomax.in","ops@giopaints.com","media@franchisekart.in"]}', bad: '{"active_emails":["sales@gomax.in","ops@giopaints.com","old-team@gomax.in","media@franchisekart.in"]}' },
  { key: "planning_ordered_steps", checks: [{ type: "json_array_len", path: "steps", min: 4, max: 6 }, { type: "json_array_item_matches", path: "steps", index: 0, pattern: "requirement|content|scope|copy" }, { type: "json_array_any_matches", path: "steps", pattern: "test.*form|form.*test|verify.*form|form.*submi" }],
    good: '{"steps":["Gather requirements and page content","Design the page","Build the enquiry form","Test the enquiry form submission end to end","Publish"]}', bad: '{"steps":["Build it","Ship it"]}' },
  { key: "writing_constrained_summary", checks: [{ type: "json_max_words", path: "summary", max: 40 }, { type: "json_contains_all_ci", path: "summary", values: ["12", "franchise"] }, { type: "json_sentence_count", path: "summary", value: 2 }],
    good: '{"summary":"GoMax opened 12 new franchise outlets this quarter, and setup time fell to 6 weeks thanks to standard kits. Two outlets are waiting on permits."}', bad: '{"summary":"GoMax grew a lot."}' },
  { key: "verification_claims", checks: [{ type: "json_array_equals_ci", path: "supported", value: [false, true, true, false] }], good: '{"supported":[false,true,true,false]}', bad: '{"supported":[true,true,true,true]}' },
  { key: "coding_trace", checks: [{ type: "json_number", path: "output", value: 17, tolerance: 0 }], good: '{"output":17}', bad: '{"output":20}' },
];

Deno.test("golden suite: every case accepts a correct answer and rejects a wrong one", () => {
  for (const c of SUITE) {
    const good = scoreCase(c.good, c.checks);
    assert(good.passed && good.score === 1, `${c.key} rejected a correct answer: ${JSON.stringify(good.results)}`);
    const bad = scoreCase(c.bad, c.checks);
    assert(!bad.passed, `${c.key} accepted a wrong answer`);
  }
});

Deno.test("golden suite: non-JSON output scores zero and partial answers get partial credit", () => {
  assertEquals(scoreCase("The answer is 210.", SUITE[0].checks).score, 0);
  const partial = scoreCase('{"youngest":"Arun","oldest":"Ravi"}', SUITE[1].checks);
  assertEquals([partial.score, partial.passed], [0.5, false]);
});

Deno.test("comparison: improvement needs a clear margin; regressions are reported per class", () => {
  const r = compareToIncumbents({
    candidateByClass: { reasoning: [1, 1], extraction: [0.5], writing: [1] },
    incumbentByClass: { reasoning: { ref: "inc", scores: [0.5, 1] }, extraction: { ref: "inc", scores: [1] }, writing: { ref: "inc", scores: [0.95] } },
  });
  assertEquals(r.improved.map((i) => i.taskClass), ["reasoning"]);
  assertEquals(r.regressions.map((i) => i.taskClass), ["extraction"]);
  assert(Math.abs(r.candidateOverall - 0.875) < 1e-9);
});

Deno.test("governance: autonomous adoption only when free/no costlier, configured, no regressions, high score", () => {
  const ok = { candidateOverall: 0.9, regressions: 0, candidateFreeTier: true, candidateCostIn: null, incumbentCostIn: null, accessConfigured: true };
  assertEquals(adoptionGovernance(ok).mode, "autonomous");
  assertEquals(adoptionGovernance({ ...ok, candidateFreeTier: null }).mode, "founder");
  assertEquals(adoptionGovernance({ ...ok, candidateFreeTier: null, candidateCostIn: 0.1, incumbentCostIn: 0.3 }).mode, "autonomous");
  assertEquals(adoptionGovernance({ ...ok, candidateFreeTier: null, candidateCostIn: 0.5, incumbentCostIn: 0.3 }).mode, "founder");
  assertEquals(adoptionGovernance({ ...ok, regressions: 1 }).mode, "founder");
  assertEquals(adoptionGovernance({ ...ok, candidateOverall: 0.7 }).mode, "founder");
  assertEquals(adoptionGovernance({ ...ok, accessConfigured: false }).mode, "founder");
});

Deno.test("rollback: degraded/unserved models and clear underperformance roll back; thin evidence does not", () => {
  const base = { lifecycle: "adopted", healthStatus: "available", lastFailureCategory: null, sampleSize: 0, verifiedCount: 0, baselineRate: 0.9 };
  assertEquals(shouldRollback(base).rollback, false);
  assertEquals(shouldRollback({ ...base, lifecycle: "degraded" }).rollback, true);
  assertEquals(shouldRollback({ ...base, healthStatus: "unavailable", lastFailureCategory: "model_unavailable" }).rollback, true);
  assertEquals(shouldRollback({ ...base, healthStatus: "degraded", lastFailureCategory: "rate_limit" }).rollback, false);
  assertEquals(shouldRollback({ ...base, sampleSize: 4, verifiedCount: 0 }).rollback, false);
  assertEquals(shouldRollback({ ...base, sampleSize: 10, verifiedCount: 4 }).rollback, true);
  assertEquals(shouldRollback({ ...base, sampleSize: 10, verifiedCount: 8 }).rollback, false);
});
