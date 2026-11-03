import { assert, assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { refreshedContract, resumeDecision } from "./objective-resume.ts";

const P = "543470b3-13cc-4af2-bbe7-2863dc3de4c3";
const GOMAX = "Objective: GoMax growth plan — reach ₹50 lakh+ monthly sales within 90 days.\nDeliver: month-by-month projection of sales, 5 KPIs.";

Deno.test("resume: last plan finished and verifier passed (GoMax 520f871e)", () => {
  const d = resumeDecision({ latestProjectId: P, latestProjectTasks: [{ status: "done" }, { status: "done" }, { status: "completed" }], latestVerifier: { project_id: P, status: "passed" } });
  assert(d.resume, d.reason);
});

Deno.test("no resume: unfinished task, failed or other-plan verifier, no plan", () => {
  assert(!resumeDecision({ latestProjectId: P, latestProjectTasks: [{ status: "done" }, { status: "failed" }], latestVerifier: { project_id: P, status: "passed" } }).resume);
  assert(!resumeDecision({ latestProjectId: P, latestProjectTasks: [{ status: "done" }], latestVerifier: { project_id: P, status: "failed" } }).resume);
  assert(!resumeDecision({ latestProjectId: P, latestProjectTasks: [{ status: "done" }], latestVerifier: { project_id: "older-plan", status: "passed" } }).resume);
  assert(!resumeDecision({ latestProjectId: P, latestProjectTasks: [{ status: "done" }], latestVerifier: null }).resume);
  assert(!resumeDecision({ latestProjectId: P, latestProjectTasks: [], latestVerifier: { project_id: P, status: "passed" } }).resume);
  assert(!resumeDecision({ latestProjectId: "", latestProjectTasks: [{ status: "done" }], latestVerifier: null }).resume);
});

Deno.test("contract refresh: old business_execution contract becomes the information contract, old one kept", () => {
  const stored = { objective_type: "business_execution", evidence_requirements: ["action evidence", "outcome verification"], acceptance_criteria: [{ criterion: "action evidence" }], continuity: { checked: true }, version: 1, status: "blocked" };
  const patch = refreshedContract(stored, GOMAX, "high", "2026-11-03T14:10:00Z")!;
  assertEquals(patch.objective_type, "information");
  assertEquals(patch.evidence_requirements, ["sources", "verification"]);
  assertEquals(patch.version, 2);
  assertEquals(patch.status, "executing");
  const c = patch.continuity as Record<string, unknown>;
  assertEquals(c.checked, true);
  const prev = (c.previous_contracts as Record<string, unknown>[])[0];
  assertEquals(prev.evidence_requirements, ["action evidence", "outcome verification"]);
  assertEquals(prev.version, 1);
});

Deno.test("contract refresh: nothing to change or no stored contract gives null", () => {
  assertEquals(refreshedContract({ objective_type: "information", evidence_requirements: ["sources", "verification"], version: 2 }, GOMAX, "high", "t"), null);
  assertEquals(refreshedContract(null, GOMAX, "high", "t"), null);
});
