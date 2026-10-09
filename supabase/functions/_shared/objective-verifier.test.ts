import { assert, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVerifierPrompt } from "./objective-verifier.ts";

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
