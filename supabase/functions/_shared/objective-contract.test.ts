import { assertEquals } from "jsr:@std/assert@1";
import { baselineObjectiveContract, classifyObjective, planContractMismatch, projectOutputType, hasMeasuredProductBuild, hasMeasuredProductVerification, hasVerifiedLiveProductEvidence } from "./objective-contract.ts";

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


const VERIFIED_PRODUCT_URL = "https://fkaios-aura-blueprint1.vercel.app/product/build-123";
const measuredBuildTask = (url = VERIFIED_PRODUCT_URL) => ({
  status: "done",
  output: JSON.stringify({
    llmResult: {
      capability: "product.build",
      capability_result: { build_id: "build-123", build_type: "website", deployed_url: url, product_status: "live", product_id: "build-123", renderer_version: 2, content_type: "text/html", renderer_verified: true },
    },
  }),
});
const measuredVerifyTask = (url = VERIFIED_PRODUCT_URL, httpStatus = 200) => ({
  status: "done",
  output: JSON.stringify({
    llmResult: {
      capability: "product.verify",
      capability_result: { deployed_url: url, url, http_status: httpStatus, live: httpStatus >= 200 && httpStatus < 300, content_type: "text/html", product_id: "build-123", renderer_version: 2, renderer_verified: httpStatus >= 200 && httpStatus < 300, verified_at: "2026-10-14T00:00:00.000Z" },
    },
  }),
});

Deno.test("product gate accepts only a measured builder-engine build plus HTTP-verified matching URL", () => {
  const tasks = [measuredBuildTask(), measuredVerifyTask()];
  assertEquals(hasMeasuredProductBuild(tasks), true);
  assertEquals(hasMeasuredProductVerification(tasks), true);
  assertEquals(hasVerifiedLiveProductEvidence(tasks), true);
});

Deno.test("product gate rejects a plausible but unmeasured random website URL", () => {
  const fake = { status: "done", output: "Deployed successfully: https://random-example-site.com — HTTP 200" };
  assertEquals(hasVerifiedLiveProductEvidence([fake]), false);
  assertEquals(hasVerifiedLiveProductEvidence([measuredBuildTask(), fake]), false);
});

Deno.test("product gate rejects mismatched deployment URLs and failed HTTP checks", () => {
  assertEquals(hasVerifiedLiveProductEvidence([measuredBuildTask(), measuredVerifyTask("https://fkaios-aura-blueprint1.vercel.app/product/another-build")]), false);
  assertEquals(hasMeasuredProductVerification([measuredVerifyTask(VERIFIED_PRODUCT_URL, 404)]), false);
  assertEquals(hasVerifiedLiveProductEvidence([measuredBuildTask(), measuredVerifyTask(VERIFIED_PRODUCT_URL, 404)]), false);
});

Deno.test("product gate rejects insecure HTTP URLs even if a model claims they are live", () => {
  assertEquals(hasVerifiedLiveProductEvidence([measuredBuildTask("http://random-example-site.com"), measuredVerifyTask("http://random-example-site.com")]), false);
});


Deno.test("product gate rejects HTTP 200 text/plain sandbox responses even when the body contains HTML", () => {
  const build = measuredBuildTask();
  const sandboxed = {
    status: "done",
    output: JSON.stringify({
      llmResult: {
        capability: "product.verify",
        capability_result: {
          deployed_url: VERIFIED_PRODUCT_URL,
          url: VERIFIED_PRODUCT_URL,
          http_status: 200,
          live: false,
          content_type: "text/plain",
          product_id: "build-123",
          renderer_version: 2,
          renderer_verified: false,
        },
      },
    }),
  };
  assertEquals(hasVerifiedLiveProductEvidence([build, sandboxed]), false);
});


Deno.test("artifact-ready output is not treated as a live product", () => {
  const artifact = {
    status: "done",
    output: JSON.stringify({
      llmResult: {
        capability: "product.build",
        capability_result: {
          build_id: "build-123",
          build_type: "website",
          deployed_url: null,
          product_status: "artifact_ready",
          product_id: null,
          renderer_version: null,
          content_type: null,
          renderer_verified: false,
        },
      },
    }),
  };
  assertEquals(hasMeasuredProductBuild([artifact]), false);
  assertEquals(hasVerifiedLiveProductEvidence([artifact, measuredVerifyTask()]), false);
});


Deno.test("baseline objective contract persists acceptance and evidence requirements", () => {
  const objective = "Reply exactly: FKAIOS FREE PROVIDER ROUTING TEST — OK. Do not perform actions, call tools, change data, or create anything else.";
  const contract = baselineObjectiveContract(objective, "low");
  assertEquals(contract.objective_type, "business_execution");
  assertEquals(contract.status, "draft");
  assertEquals(contract.requirements, [objective]);
  assertEquals(contract.deliverables, [objective]);
  assertEquals(contract.acceptance_criteria.length, contract.evidence_requirements.length + 1);
  assertEquals(contract.evidence_requirements.length > 0, true);
  assertEquals(contract.founder_approval_required, false);
});

Deno.test("baseline objective contract requires founder approval for high and critical risk", () => {
  const objective = "Send a customer message after approval";
  assertEquals(baselineObjectiveContract(objective, "high").founder_approval_required, true);
  assertEquals(baselineObjectiveContract(objective, "critical").founder_approval_required, true);
  assertEquals(baselineObjectiveContract(objective, "medium").founder_approval_required, false);
});
