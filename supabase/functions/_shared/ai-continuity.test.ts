/// <reference lib="deno.ns" />
import {
  createContinuityPacket,
  exportContinuityPacket,
  importContinuityPacket,
  renderContinuityHandoff,
  validateContinuityPacket,
} from "./ai-continuity.ts";

function assert(condition: boolean, message = "assertion failed"): void {
  if (!condition) throw new Error(message);
}

const sample = () => createContinuityPacket({
  taskId: "task-42",
  objective: "Finish and verify the customer onboarding flow.",
  acceptanceCriteria: ["New customer can complete onboarding", "Automated test passes"],
  status: "interrupted",
  lastVerifiedCheckpoint: "Form validation and persistence implemented; tests not yet run.",
  completedWork: ["Added form validation", "Persisted onboarding state"],
  decisions: ["Keep existing database schema"],
  relevantContext: ["src/onboarding/form.tsx", "Commit abc123"],
  artifacts: [{ name: "onboarding form", kind: "file", reference: "src/onboarding/form.tsx", verified: true }],
  pendingActions: ["Run onboarding integration test", "Inspect failure if any"],
  nextAction: "Run the onboarding integration test and record its result.",
  constraints: ["Do not change the database schema without approval"],
  blockers: ["Integration test environment has not been checked"],
  previousExecutor: "coding-agent-A",
  suggestedExecutor: "coding-agent-B",
  updatedAt: "2026-10-21T12:00:00.000Z",
});

Deno.test("continuity packet round-trips across sessions/providers", () => {
  const serialized = exportContinuityPacket(sample());
  const imported = importContinuityPacket(serialized);
  assert(imported.valid);
  if (imported.valid) {
    assert(imported.packet.taskId === "task-42");
    assert(imported.packet.status === "interrupted");
    assert(imported.packet.nextAction.includes("integration test"));
    assert(imported.packet.artifacts[0].verified);
  }
});

Deno.test("handoff prompt includes exact checkpoint, remaining work, and guardrails", () => {
  const prompt = renderContinuityHandoff(sample());
  assert(prompt.includes("Do not restart"));
  assert(prompt.includes("Form validation and persistence implemented"));
  assert(prompt.includes("Run the onboarding integration test"));
  assert(prompt.includes("Do not mark the task complete"));
});

Deno.test("invalid and malformed packets are rejected", () => {
  assert(!validateContinuityPacket({ taskId: "missing-rest" }).valid);
  assert(!importContinuityPacket("{not json").valid);
});

Deno.test("packet cannot be exported with missing next action", () => {
  let threw = false;
  try {
    createContinuityPacket({
      ...sample(),
      nextAction: "",
    });
  } catch {
    threw = true;
  }
  assert(threw);
});
