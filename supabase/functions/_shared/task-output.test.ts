/// <reference lib="deno.ns" />
import { serializeTaskOutput } from "./task-output.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

Deno.test("research task output stays valid JSON and preserves capability evidence", () => {
  const input = {
    llmResult: {
      capability: "research.run",
      capability_attempts: 1,
      deliverable: { findings: ["Finding A", "Finding B"] },
      capability_result: { results: [{ title: "raw result", html: "x".repeat(30000) }] },
    },
    companyOsDispatch: { capability: "research.run", status: "success", attempts: 1, data_excerpt: "result_count=1" },
  };
  const serialized = serializeTaskOutput(input);
  const parsed = JSON.parse(serialized) as Record<string, unknown>;
  const llmResult = parsed.llmResult as Record<string, unknown>;
  const dispatch = parsed.companyOsDispatch as Record<string, unknown>;
  assert(!("capability_result" in llmResult), "large duplicated raw research result must be omitted from llmResult");
  assert((llmResult.deliverable as { findings: string[] }).findings.length === 2, "deliverable must be preserved");
  assert(dispatch.status === "success" && dispatch.capability === "research.run", "measured dispatch evidence must be preserved");
  assert(serialized.length < 20000, "compact research envelope should stay below the former unsafe truncation threshold");
});

Deno.test("non-research output is preserved without mutation", () => {
  const input = { llmResult: { capability: "product.verify", capability_result: { live: true } } };
  const parsed = JSON.parse(serializeTaskOutput(input));
  assert(parsed.llmResult.capability_result.live === true, "measured product verification must not be stripped");
});

Deno.test("plain task output remains valid JSON", () => {
  const input = { deliverable: "x".repeat(25000) };
  const serialized = serializeTaskOutput(input);
  assert((JSON.parse(serialized) as { deliverable: string }).deliverable.length === 25000, "long deliverables must not be cut mid-JSON");
});
