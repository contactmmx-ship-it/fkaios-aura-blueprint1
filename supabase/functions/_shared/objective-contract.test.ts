import { assertEquals } from "jsr:@std/assert@1";
import { classifyObjective, planContractMismatch, projectOutputType } from "./objective-contract.ts";

// The objective text submitted from the Console on 9 Oct 2026 (20cbf892).
const KIDS_DPS = `**Objective: Prepare a verified Kids DPS preschool franchise opportunity and 90-day action plan for India.**

Research the current Indian preschool and preschool-franchise market using available, reliable sources.

Deliver one consolidated, decision-ready report containing:
1. An executive summary and the five most important findings.

- Use the research and other capabilities available to FKAIOS; do not claim to use tools or data sources that are not actually available.
- Save the objective, create and execute the task plan, track progress, verify the deliverable, and display the actual final report in the Console.`;

Deno.test("classifier: the Kids DPS research objective is information, not a product build", () => {
  assertEquals(classifyObjective(KIDS_DPS), "information");
});

Deno.test("classifier: substring matches no longer make a product", () => {
  assertEquals(classifyObjective("Deliver a report on the tools our franchise system uses"), "information");
  assertEquals(classifyObjective("Identify the top 3 distributors in Pune"), "information");
});

Deno.test("classifier: explicit build requests are products", () => {
  assertEquals(classifyObjective("Build a website for Chaat Masters"), "product_creation");
  assertEquals(classifyObjective("Create an internal CRM tool for dealers"), "product_creation");
  assertEquals(classifyObjective("Research competitors, then build a landing page for Kids DPS"), "product_creation");
  assertEquals(classifyObjective("Launch the new franchise marketplace app"), "product_creation");
});

Deno.test("classifier: software and business execution", () => {
  assertEquals(classifyObjective("Refactor the invoice schema migration"), "software_build");
  assertEquals(classifyObjective("Follow up with every lead from last week"), "business_execution");
});

Deno.test("planContractMismatch: a live product plan for a report objective is stale", () => {
  assertEquals(projectOutputType("information"), "report");
  assertEquals(planContractMismatch({ status: "working", output_type: "product" }, KIDS_DPS), true);
  assertEquals(planContractMismatch({ status: "working", output_type: "report" }, KIDS_DPS), false);
});

Deno.test("planContractMismatch: finished or untyped plans are never reopened", () => {
  assertEquals(planContractMismatch({ status: "complete", output_type: "product" }, KIDS_DPS), false);
  assertEquals(planContractMismatch({ status: "failed", output_type: "product" }, KIDS_DPS), false);
  assertEquals(planContractMismatch({ status: "working", output_type: null }, KIDS_DPS), false);
  assertEquals(planContractMismatch(null, KIDS_DPS), false);
});
