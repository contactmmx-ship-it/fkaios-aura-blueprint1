/**
 * Shared, deterministic release gate for reusable FK Brand Discovery templates.
 * No network calls, database writes, or secrets. Safe to test in Node and import in Deno.
 */
const SUPPORTED_TYPES = new Set([
  "text", "long_text", "repeatable_list", "file_or_text",
  "multiple_choice", "multi_part", "service_status", "repeatable_choice",
]);
const REQUIRED_RELEASE_CHECKS = [
  "source_mapping_reviewed",
  "question_semantics_reviewed",
  "answer_controls_tested",
  "privacy_review_complete",
  "accessibility_review_complete",
  "security_review_complete",
  "end_to_end_test_complete",
  "owner_release_approved",
];

function validOptions(options) {
  if (!Array.isArray(options) || options.length === 0) return false;
  const values = options.map((option) => option && option.value);
  return values.every((value) => typeof value === "string" && value.trim()) &&
    new Set(values).size === values.length &&
    options.every((option) => typeof option.label === "string" && option.label.trim());
}

function validQuestion(question) {
  if (!question || typeof question.id !== "string" || !question.id.trim() ||
      typeof question.prompt !== "string" || !question.prompt.trim() ||
      typeof question.required !== "boolean" || !SUPPORTED_TYPES.has(question.type)) return false;
  if (question.type === "multiple_choice") {
    return validOptions(question.options) &&
      ["single", "multiple"].includes(question.selection_mode) &&
      (question.max_selections === undefined ||
        (Number.isInteger(question.max_selections) && question.max_selections > 0 &&
         question.max_selections <= question.options.length));
  }
  if (question.type === "multi_part") {
    if (!Array.isArray(question.parts) || question.parts.length < 2) return false;
    const ids = new Set();
    return question.parts.every((part) => {
      if (!part || typeof part.id !== "string" || !part.id.trim() || ids.has(part.id) ||
          typeof part.label !== "string" || !part.label.trim() ||
          !["single", "multiple"].includes(part.selection_mode) || !validOptions(part.options)) return false;
      ids.add(part.id);
      return part.max_selections === undefined ||
        (Number.isInteger(part.max_selections) && part.max_selections > 0 &&
         part.max_selections <= part.options.length);
    });
  }
  if (question.type === "service_status") {
    return validOptions(question.service_options) && validOptions(question.status_options);
  }
  if (question.type === "repeatable_choice") {
    return validOptions(question.options) &&
      typeof question.row_label === "string" && question.row_label.trim() &&
      typeof question.row_prompt === "string" && question.row_prompt.trim();
  }
  return true;
}

/**
 * Returns { ok, errors }. A template is inviteable only after explicit release
 * checks and a recorded human approval; database status alone is insufficient.
 */
export function validateBrandDiscoveryTemplate(questionnaire) {
  const errors = [];
  if (!questionnaire || typeof questionnaire !== "object" || Array.isArray(questionnaire)) {
    return { ok: false, errors: ["questionnaire_not_an_object"] };
  }
  if (questionnaire.status !== "active") errors.push("questionnaire_not_active");
  if (!Array.isArray(questionnaire.sections) || questionnaire.sections.length === 0) {
    errors.push("sections_missing");
  }
  if (!Number.isInteger(questionnaire.question_count) || questionnaire.question_count < 1) {
    errors.push("question_count_invalid");
  }
  if (!Array.isArray(questionnaire.document_checklist)) errors.push("document_checklist_missing");
  if (typeof questionnaire.confidentiality_and_acknowledgement !== "string" ||
      !questionnaire.confidentiality_and_acknowledgement.trim()) errors.push("acknowledgement_missing");

  const readiness = questionnaire.release_readiness;
  if (!readiness || typeof readiness !== "object" ||
      REQUIRED_RELEASE_CHECKS.some((key) => readiness[key] !== true)) {
    errors.push("release_readiness_incomplete");
  }
  const approval = questionnaire.release_approval;
  if (!approval || typeof approval.approved_by !== "string" || !approval.approved_by.trim() ||
      typeof approval.approval_reference !== "string" || !approval.approval_reference.trim() ||
      typeof approval.approved_at !== "string" || !Number.isFinite(Date.parse(approval.approved_at))) {
    errors.push("human_release_approval_missing");
  }

  const sectionIds = new Set();
  const questionIds = new Set();
  let total = 0;
  if (Array.isArray(questionnaire.sections)) {
    for (const section of questionnaire.sections) {
      if (!section || typeof section.id !== "string" || !section.id.trim() ||
          typeof section.title !== "string" || !section.title.trim() ||
          sectionIds.has(section.id) || !Array.isArray(section.questions)) {
        errors.push("section_invalid_or_duplicate");
        continue;
      }
      sectionIds.add(section.id);
      for (const question of section.questions) {
        total++;
        if (!validQuestion(question)) errors.push("question_invalid:" + String(question?.id ?? "unknown"));
        if (question && typeof question.id === "string") {
          if (questionIds.has(question.id)) errors.push("question_id_duplicate:" + question.id);
          questionIds.add(question.id);
        }
      }
    }
  }
  if (Number.isInteger(questionnaire.question_count) && total !== questionnaire.question_count) {
    errors.push("question_count_does_not_match_sections");
  }

  if (Array.isArray(questionnaire.document_checklist)) {
    const itemIds = new Set();
    for (const item of questionnaire.document_checklist) {
      if (!item || typeof item.id !== "string" || !item.id.trim() || itemIds.has(item.id) ||
          typeof item.label !== "string" || !item.label.trim() ||
          !Array.isArray(item.status_options) || item.status_options.length < 2 ||
          item.status_options.some((status) => typeof status !== "string" || !status.trim())) {
        errors.push("document_checklist_item_invalid");
      } else itemIds.add(item.id);
    }
  }
  return { ok: errors.length === 0, errors: [...new Set(errors)] };
}

export const brandDiscoveryReleaseChecks = [...REQUIRED_RELEASE_CHECKS];
