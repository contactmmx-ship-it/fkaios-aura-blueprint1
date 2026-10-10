import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVerifierPrompt, isIndependentVerificationLevel, isRecoverableOutputBlocker, parseVerdict, persistVerificationEvidence } from "./objective-verifier.ts";
import { phasePath } from "./objective-state.ts";

Deno.test("missing client inputs requested by the objective are report findings, not human blockers", () => {
  const prompt = buildVerifierPrompt(
    "Prepare a report and list missing information required from the client.",
    [],
    "## Missing information\n- Financial statements\n- Trademark status",
    "Retrieved market research",
  );

  assertStringIncludes(prompt.user, "Do NOT set needs_human_decision merely because the report identifies missing client information");
  assertStringIncludes(prompt.user, "that list is a deliverable, not a blocker");
});

Deno.test("verifier still requires a human decision for actions that truly require one", () => {
  const prompt = buildVerifierPrompt(
    "Obtain founder approval before spending money.",
    [],
    "Approval is pending.",
    "No approval recorded",
  );

  assertStringIncludes(prompt.user, "decision, approval, payment, credential or physical action");
});


Deno.test("output-format and re-execution blockers are rectifiable, not human decisions", () => {
  const deliverable = "This is the consolidated decision-ready report with findings and next steps.";
  const parsed = parseVerdict(JSON.stringify({
    criteria: [{ criterion: "Report exists", met: true, evidence_quote: "consolidated decision-ready report", issue: null }],
    needs_human_decision: true,
    human_decision_reason: "Human decision required to determine whether this intermediate output is acceptable or if the task needs to be re-executed to generate the final report.",
    quality: 0.9,
    issues: [],
  }), deliverable, { ok: true, problems: [] });
  assertEquals(parsed?.needsHumanDecision, false);
  assertEquals(parsed?.passed, true);
});

Deno.test("explicit spending approval remains a genuine human gate", () => {
  const deliverable = "The report recommends a vendor purchase.";
  const parsed = parseVerdict(JSON.stringify({
    criteria: [{ criterion: "Recommendation exists", met: true, evidence_quote: "recommends a vendor purchase", issue: null }],
    needs_human_decision: true,
    human_decision_reason: "Founder approval is required before spending the proposed budget on the vendor purchase.",
    quality: 0.9,
    issues: [],
  }), deliverable, { ok: true, problems: [] });
  assertEquals(parsed?.needsHumanDecision, true);
  assertEquals(parsed?.passed, false);
});


Deno.test("visible Markdown source labels can support a verifier quote without link URLs", () => {
  const deliverable = "Competitor source: (Source: [Expert Market Research](https://example.com/research), Date: 2026-02-02).";
  const parsed = parseVerdict(JSON.stringify({
    criteria: [{ criterion: "Source and date are present", met: true, evidence_quote: "Source: Expert Market Research, Date: 2026-02-02", issue: null }],
    needs_human_decision: false,
    human_decision_reason: null,
    quality: 0.9,
    issues: [],
  }), deliverable, { ok: true, problems: [] });
  assertEquals(parsed?.criteria[0]?.met, true);
  assertEquals(parsed?.passed, true);
});

Deno.test("recover previously exhausted verification loops without overriding genuine approvals", () => {
  const exhausted = "Objective replanned 13 times without reaching achieved/blocked/failed. Last evaluator reason: Independent verification rejected the deliverable: verifier's supporting quote was not found in the deliverable.";
  assertEquals(isRecoverableOutputBlocker(exhausted, 4), true);
  assertEquals(isRecoverableOutputBlocker(exhausted, 6), false);
  assertEquals(
    isRecoverableOutputBlocker("Human decision required: Founder approval is required before spending the proposed budget."),
    false,
  );
});


Deno.test("verification retries supersede the previous active evidence before inserting the new verdict", async () => {
  const calls: string[] = [];
  const db = {
    from(table: string) {
      assertEquals(table, "fkaios_verification_evidence");
      return {
        update(values: Record<string, unknown>) {
          calls.push(`update:${String(values.status)}`);
          const query = {
            eq(column: string, value: string) { calls.push(`eq:${column}:${value}`); return query; },
            neq(column: string, value: string) {
              calls.push(`neq:${column}:${value}`);
              return Promise.resolve({ error: null });
            },
          };
          return query;
        },
        insert(row: Record<string, unknown>) {
          calls.push(`insert:${String(row.status)}`);
          const query = {
            select(_column: string) { return query; },
            single() { return Promise.resolve({ data: { id: "evidence-new" }, error: null }); },
          };
          return query;
        },
      };
    },
  };
  const id = await persistVerificationEvidence(db, {
    objectiveId: "objective-1",
    requirementKey: "objective_verifier:v1",
    row: { objective_id: "objective-1", requirement_key: "objective_verifier:v1", status: "passed" },
  });
  assertEquals(id, "evidence-new");
  assertEquals(calls[0], "update:superseded");
  assertEquals(calls[calls.length - 1], "insert:passed");
});


Deno.test("completed objectives can reopen only into verification for evidence repair", () => {
  assertEquals(phasePath("completed", "verifying"), ["verifying"]);
  assertEquals(phasePath("completed", "executing"), null);
});

Deno.test("only a different model or provider counts as independent verification", () => {
  assertEquals(isIndependentVerificationLevel("different_model"), true);
  assertEquals(isIndependentVerificationLevel("different_provider"), true);
  assertEquals(isIndependentVerificationLevel("same_model"), false);
  assertEquals(isIndependentVerificationLevel("producers_unknown"), false);
  assertEquals(isIndependentVerificationLevel(null), false);
});
