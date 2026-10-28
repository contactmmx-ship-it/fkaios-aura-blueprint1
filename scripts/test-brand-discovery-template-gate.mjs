import assert from "node:assert/strict";
import { validateBrandDiscoveryTemplate, brandDiscoveryReleaseChecks } from "../supabase/functions/_shared/brand-discovery-template-gate.mjs";

const release_readiness = Object.fromEntries(brandDiscoveryReleaseChecks.map((key) => [key, true]));
const validTemplate = {
  status: "active",
  question_count: 2,
  sections: [
    { id: "core", title: "Core", questions: [
      { id: "q1", prompt: "Tell us about the business.", type: "long_text", required: true },
      { id: "q2", prompt: "Which services do you offer?", type: "multiple_choice", required: true,
        selection_mode: "multiple", options: [{ value: "a", label: "Service A" }, { value: "b", label: "Service B" }] },
    ] },
  ],
  document_checklist: [{ id: "d1", label: "Business records", status_options: ["available", "not_available", "unsure"] }],
  confidentiality_and_acknowledgement: "Responses are self-reported; private FK analysis is not shared.",
  release_readiness,
  release_approval: { approved_by: "FK owner", approval_reference: "FK-BD-TEST-001", approved_at: "2026-10-28T00:00:00.000Z" },
};

assert.deepEqual(validateBrandDiscoveryTemplate(validTemplate), { ok: true, errors: [] },
  "A properly reviewed future-brand template should pass without Raahat-specific counts.");

const missingApproval = structuredClone(validTemplate);
delete missingApproval.release_approval;
assert.ok(validateBrandDiscoveryTemplate(missingApproval).errors.includes("human_release_approval_missing"));

const failedReview = structuredClone(validTemplate);
failedReview.release_readiness.security_review_complete = false;
assert.ok(validateBrandDiscoveryTemplate(failedReview).errors.includes("release_readiness_incomplete"));

const wrongCount = structuredClone(validTemplate);
wrongCount.question_count = 235;
assert.ok(validateBrandDiscoveryTemplate(wrongCount).errors.includes("question_count_does_not_match_sections"));

const badOptions = structuredClone(validTemplate);
badOptions.sections[0].questions[1].options[1].value = "a";
assert.ok(validateBrandDiscoveryTemplate(badOptions).errors.some((error) => error.startsWith("question_invalid:")));

const duplicateQuestion = structuredClone(validTemplate);
duplicateQuestion.sections[0].questions[1].id = "q1";
assert.ok(validateBrandDiscoveryTemplate(duplicateQuestion).errors.includes("question_id_duplicate:q1"));

const inactive = structuredClone(validTemplate);
inactive.status = "draft";
assert.ok(validateBrandDiscoveryTemplate(inactive).errors.includes("questionnaire_not_active"));

console.log("Brand Discovery reusable-template release-gate tests passed (7 scenarios).");
