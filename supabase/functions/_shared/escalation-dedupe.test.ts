import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { hasPendingEscalationForProject } from "./escalation-dedupe.ts";

Deno.test("blocks duplicate task escalation for a project with a pending approval", () => {
  assertEquals(hasPendingEscalationForProject([
    { action_type: "escalation_blocked_task", status: "pending", payload: { project_id: "p1", task_id: "t1" } },
  ], "p1"), true);
});

Deno.test("blocks duplicate project escalation for a project with a pending approval", () => {
  assertEquals(hasPendingEscalationForProject([
    { action_type: "escalation_blocked_project", status: "pending", payload: { project_id: "p1" } },
  ], "p1"), true);
});

Deno.test("does not treat decided approvals as pending", () => {
  assertEquals(hasPendingEscalationForProject([
    { action_type: "escalation_blocked_task", status: "approved", payload: { project_id: "p1", task_id: "t1" } },
  ], "p1"), false);
});

Deno.test("does not block a different project", () => {
  assertEquals(hasPendingEscalationForProject([
    { action_type: "escalation_blocked_task", status: "pending", payload: { project_id: "p2", task_id: "t1" } },
  ], "p1"), false);
});

Deno.test("ignores malformed payloads and unrelated approval types", () => {
  assertEquals(hasPendingEscalationForProject([
    { action_type: "founder_decision", status: "pending", payload: { project_id: "p1" } },
    { action_type: "escalation_blocked_project", status: "pending", payload: null },
  ], "p1"), false);
});
