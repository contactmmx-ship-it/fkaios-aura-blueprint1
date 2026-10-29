/// <reference lib="deno.ns" />

import { blocksRequeue, needsEvaluation } from "./capability-discovery.ts";

Deno.test("never-evaluated models need evaluation", () => {
  if (!needsEvaluation("discovered", null, 2)) throw new Error("discovered models must be tested");
  if (!needsEvaluation("available", {}, 2)) throw new Error("available models must be tested");
});

Deno.test("a model verified on an older suite is re-tested on the new one", () => {
  if (!needsEvaluation("verified", { last_eval: { suite: "fkaios_core@1" } }, 2)) throw new Error("v1 verdict is not evidence on v2");
  if (needsEvaluation("verified", { last_eval: { suite: "fkaios_core@2" } }, 2)) throw new Error("v2 verdict must not be re-tested");
  if (!needsEvaluation("verified", {}, 2)) throw new Error("verified without a recorded suite must be re-tested");
});

Deno.test("retired, degraded and testing models are not queued by discovery", () => {
  for (const l of ["retired", "degraded", "testing"]) if (needsEvaluation(l, null, 2)) throw new Error(`${l} must not be queued`);
});

Deno.test("only open tests or tests on the current suite block a re-queue", () => {
  if (!blocksRequeue("queued", null, 2) || !blocksRequeue("running", null, 2)) throw new Error("open tests must block");
  if (blocksRequeue("passed", { progress: { suite_version: 1 } }, 2)) throw new Error("a v1 pass must not block a v2 test");
  if (blocksRequeue("failed", null, 2)) throw new Error("a pre-versioning result counts as v1");
  if (!blocksRequeue("passed", { progress: { suite_version: 2 } }, 2)) throw new Error("a v2 result must block");
});
