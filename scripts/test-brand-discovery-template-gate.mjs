import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { validateBrandDiscoveryTemplate, validateBrandDiscoveryDraft, brandDiscoveryReleaseChecks } from "../supabase/functions/_shared/brand-discovery-template-gate.mjs";

const release_readiness = Object.fromEntries(brandDiscoveryReleaseChecks.map((key) => [key, true]));
const validTemplate = {
  slug: "sample-brand-discovery",
  version: 1,
  brand: { name: "Sample Brand", category: "retail" },
  status: "active",
  question_count: 2,
  sections: [
    { id: "core", title: "Core", questions: [
      { id: "q1", prompt: "Tell us about the business.", type: "long_text", required: true, source_status: "FK_AUTHORED_AND_APPROVED", source_reference: "FK core template" },
      { id: "q2", prompt: "Which services do you offer?", type: "multiple_choice", required: true, source_status: "FK_AUTHORED_AND_APPROVED", source_reference: "FK core template",
        selection_mode: "multiple", options: [{ value: "a", label: "Service A" }, { value: "b", label: "Service B" }] },
    ] },
  ],
  document_checklist: [{ id: "d1", label: "Business records", status_options: ["available", "not_available", "unsure"] }],
  confidentiality_and_acknowledgement: "Responses are self-reported; private FK analysis is not shared.",
  release_readiness,
  release_approval: { approved_by: "FK owner", approval_reference: "FK-BD-TEST-001", approved_at: "2026-10-28T00:00:00.000Z" },
};

const validDraft = { ...structuredClone(validTemplate), status: "draft" };
validDraft.sections[0].questions[0].source_status = "FK_AUTHORED_DRAFT";
validDraft.sections[0].questions[1].source_status = "FK_AUTHORED_DRAFT";
delete validDraft.release_readiness;
delete validDraft.release_approval;
assert.deepEqual(validateBrandDiscoveryDraft(validDraft), { ok: true, errors: [] },
  "Draft structure must be testable without pretending review/approval gates passed.");
const draftWithWrongCount = { ...structuredClone(validDraft), question_count: 1 };
assert.ok(validateBrandDiscoveryDraft(draftWithWrongCount).errors.includes("question_count_does_not_match_sections"));

assert.deepEqual(validateBrandDiscoveryTemplate(validTemplate), { ok: true, errors: [] },
  "A properly reviewed future-brand template should pass without Raahat-specific counts.");

const missingApproval = structuredClone(validTemplate);
delete missingApproval.release_approval;
assert.ok(validateBrandDiscoveryTemplate(missingApproval).errors.includes("human_release_approval_missing"));
const unapprovedProvenance = structuredClone(validTemplate);
unapprovedProvenance.sections[0].questions[0].source_status = "FK_AUTHORED_DRAFT";
assert.ok(validateBrandDiscoveryTemplate(unapprovedProvenance).errors.includes("question_provenance_not_approved:q1"));

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

const inviteSource = await readFile(new URL("../supabase/functions/brand-discovery-create-invite/index.ts", import.meta.url), "utf8");
const activationSource = await readFile(new URL("./activate-brand-discovery-template.mjs", import.meta.url), "utf8");
const respondentUiSource = await readFile(new URL("../src/app/brand-discovery/[token]/BrandDiscoveryRespondent.tsx", import.meta.url), "utf8");
const respondentSource = await readFile(new URL("../supabase/functions/brand-discovery-respondent/index.ts", import.meta.url), "utf8");
assert.ok(activationSource.includes("--confirm-activate") && activationSource.includes("I_APPROVE_TEMPLATE_RELEASE"),
  "Template activation must require explicit approval flags.");
assert.ok(inviteSource.includes("template_identity_mismatch") && activationSource.includes("Template JSON identity does not match"),
  "Database and JSON slug/version/category must match before invite or activation.");
assert.ok(inviteSource.includes("validateBrandDiscoveryTemplate(version.questionnaire)"),
  "Invite endpoint must apply the generic release gate to every brand.");
assert.ok(inviteSource.includes('Deno.env.get("FK_BRAND_DISCOVERY_EMAIL_SENDING_ENABLED") === "true"'),
  "Invitation email must require explicit server-side enablement.");
assert.ok(respondentSource.includes("if (!isValidQuestionAnswer(question, answer))"),
  "The respondent API must validate each answer before it is persisted.");
assert.ok(respondentSource.includes("request_too_large"),
  "The respondent API must reject oversized request bodies.");
assert.ok(!respondentUiSource.includes("all 20 supporting documents"),
  "Respondent UI copy must not hard-code the Raahat checklist count.");
assert.ok(!respondentSource.includes("checklist.length !== 20"),
  "Respondent closure validation must support brand-specific checklist sizes.");
assert.ok(respondentSource.includes('Deno.env.get("FK_BRAND_DISCOVERY_EMAIL_SENDING_ENABLED") !== "true"'),
  "Completion emails must be disabled by default.");
console.log("Invite release gate and email no-send-by-default checks passed.");

