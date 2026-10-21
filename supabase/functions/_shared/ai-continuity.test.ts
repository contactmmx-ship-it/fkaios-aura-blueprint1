/// <reference lib="deno.ns" />
import {
  createContinuityPacket,
  exportContinuityPacket,
  importContinuityPacket,
  renderContinuityHandoff,
  validateContinuityPacket,
  checkpointContinuityPacket,
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

Deno.test("checkpoint update preserves objective and advances exact next action", () => {
  const original = sample();
  const advanced = checkpointContinuityPacket(original, {
    verifiedCheckpoint: "Integration test executed and passed.",
    completedWork: ["Ran onboarding integration test successfully"],
    pendingActions: ["Perform final independent review"],
    nextAction: "Perform final independent review of onboarding flow.",
    executor: "coding-agent-B",
    status: "ready_for_verification",
  });
  assert(advanced.taskId === original.taskId);
  assert(advanced.objective === original.objective);
  assert(advanced.completedWork.length === original.completedWork.length + 1);
  assert(advanced.lastVerifiedCheckpoint === "Integration test executed and passed.");
  assert(advanced.nextAction === "Perform final independent review of onboarding flow.");
  assert(advanced.previousExecutor === "coding-agent-B");
  assert(advanced.status === "ready_for_verification");
});

Deno.test("checkpoint cannot silently advance a completed task", () => {
  let threw = false;
  try {
    checkpointContinuityPacket(createContinuityPacket({
      ...sample(),
      status: "completed",
    }), {
      verifiedCheckpoint: "Should not advance",
      nextAction: "Continue anyway",
      executor: "coding-agent-B",
    });
  } catch {
    threw = true;
  }
  assert(threw);
});
