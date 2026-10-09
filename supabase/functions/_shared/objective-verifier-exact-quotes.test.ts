import { assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { buildVerifierPrompt } from "./objective-verifier.ts";

Deno.test("verifier must return exact contiguous evidence quotes without ellipses", () => {
  const prompt = buildVerifierPrompt("Prepare a report.", [], "The report contains a sourced competitor table.", "Search result evidence");
  assertStringIncludes(prompt.user, "exact, contiguous, verbatim substring");
  assertStringIncludes(prompt.user, "Do not paraphrase, add ellipses");
  assertStringIncludes(prompt.user, "the quote must appear exactly in the deliverable");
});

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
