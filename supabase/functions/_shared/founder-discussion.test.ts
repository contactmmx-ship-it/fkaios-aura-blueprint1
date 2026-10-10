import { assertEquals, assertNotEquals } from "jsr:@std/assert";
import { buildFounderDiscussionPrompt, parseFounderDiscussionReply } from "./founder-discussion.ts";

Deno.test("discussion prompt prevents fabricated research and execution before approval", () => {
  const prompt = buildFounderDiscussionPrompt([
    { role: "founder", content: "I want to grow a franchise brand", created_at: "2026-10-10T00:00:00Z" },
  ]);
  assertEquals(prompt.includes("Do not invent market research"), true);
  assertEquals(prompt.includes("Do not submit an objective, run tasks"), true);
  assertEquals(prompt.includes("FOUNDER"), true);
});

Deno.test("a discussion remains open when the CEO asks for missing information", () => {
  const parsed = parseFounderDiscussionReply(JSON.stringify({
    reply: "What investment ceiling and target timeline should I plan around?",
    readyForApproval: false,
    plan: null,
  }));
  assertEquals(parsed?.readyForApproval, false);
  assertEquals(parsed?.plan, null);
});

Deno.test("a plan is approval-ready only with measurable deliverables and criteria", () => {
  const base = {
    reply: "I have a bounded plan ready for your review.",
    readyForApproval: true,
    plan: {
      title: "Validate and launch the pilot",
      objective: "Validate one pilot unit against an agreed operating and financial benchmark.",
      rationale: "Prove unit economics before replicating.",
      approach: ["Research comparable models", "Build a unit economics model", "Validate a pilot"],
      assumptions: ["The founder approves a pilot location"],
      researchNeeded: ["Current local rent and labor costs"],
      milestones: [{ name: "Validation", outcome: "Source-backed model with sensitivities" }],
      deliverables: ["Decision-ready pilot plan"],
      risks: [{ risk: "Unit economics fail", mitigation: "Stop before CAPEX commitment" }],
      budgetEstimate: "Not yet established until local quotes are sourced",
      roiModel: "Contribution margin divided by invested capital, using validated inputs",
      acceptanceCriteria: ["All material assumptions are labelled", "Each financial input has a source or is marked unknown"],
      approvalsRequired: ["Any paid commitment"],
    },
  };
  const parsed = parseFounderDiscussionReply(JSON.stringify(base));
  assertEquals(parsed?.readyForApproval, true);
  assertEquals(parsed?.plan?.acceptanceCriteria.length, 2);
  const invalid = parseFounderDiscussionReply(JSON.stringify({
    ...base,
    plan: { ...base.plan, acceptanceCriteria: ["One criterion only"] },
  }));
  assertEquals(invalid?.readyForApproval, false);
  assertEquals(invalid?.plan, null);
});

Deno.test("malformed model output is rejected instead of treated as a plan", () => {
  assertEquals(parseFounderDiscussionReply("I think we should proceed"), null);
  assertNotEquals(parseFounderDiscussionReply(JSON.stringify({ reply: "Need more facts", readyForApproval: false, plan: null })), null);
});

Deno.test("Markdown fenced JSON can be parsed without trusting extra prose", () => {
  const parsed = parseFounderDiscussionReply('```json\n{"reply":"Let us clarify the budget first.","readyForApproval":false,"plan":null}\n```');
  assertEquals(parsed?.reply, "Let us clarify the budget first.");
});
