/**
 * Pure respondent-answer validators shared by the Edge Function and Node tests.
 * No database, network, secrets or runtime side effects.
 */
export function isValidChoiceSet(question, choices) {
  if (!Array.isArray(choices) || choices.length === 0 ||
      choices.some((value) => typeof value !== "string")) return false;
  const options = Array.isArray(question?.options) ? question.options : [];
  const allowed = new Set(options.map((option) => option?.value).filter((value) => typeof value === "string"));
  if (choices.some((choice) => !allowed.has(choice)) || new Set(choices).size !== choices.length) return false;
  if (question.selection_mode !== "multiple" && choices.length !== 1) return false;
  if (question.max_selections !== undefined && choices.length > question.max_selections) return false;
  return true;
}

export function isValidQuestionAnswer(question, rawAnswer) {
  if (!question || typeof question.type !== "string") return false;
  if (["text", "long_text", "repeatable_list", "file_or_text"].includes(question.type)) {
    if (typeof rawAnswer !== "string") return false;
    const maxLength = question.type === "text" ? 2_000 : question.type === "file_or_text" ? 5_000 : 20_000;
    return rawAnswer.trim().length > 0 && rawAnswer.length <= maxLength;
  }
  if (!["multiple_choice", "multi_part", "service_status", "repeatable_choice"].includes(question.type)) return false;
  try {
    const serializedLength = typeof rawAnswer === "string" ? rawAnswer.length : JSON.stringify(rawAnswer).length;
    if (serializedLength > 25_000) return false;
  } catch { return false; }
  let answer = rawAnswer;
  if (typeof rawAnswer === "string") {
    try { answer = JSON.parse(rawAnswer); } catch { return false; }
  }
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;

  if (question.type === "service_status") {
    const serviceOptions = Array.isArray(question.service_options) ? question.service_options : [];
    const statusOptions = Array.isArray(question.status_options) ? question.status_options : [];
    const services = answer.services;
    const statuses = answer.statuses;
    if (!Array.isArray(services) || services.length === 0 ||
        services.some((id) => typeof id !== "string")) return false;
    const allowedServices = new Set(serviceOptions.map((item) => item.value));
    const allowedStatuses = new Set(statusOptions.map((item) => item.value));
    if (services.some((id) => !allowedServices.has(id)) || new Set(services).size !== services.length) return false;
    if (!statuses || typeof statuses !== "object" || Array.isArray(statuses)) return false;
    if (Object.keys(statuses).some((id) => !services.includes(id))) return false;
    return services.every((id) => typeof statuses[id] === "string" && allowedStatuses.has(statuses[id]));
  }

  if (question.type === "repeatable_choice") {
    const options = Array.isArray(question.options) ? question.options : [];
    const allowed = new Set(options.map((item) => item.value));
    const rows = answer.rows;
    if (!Array.isArray(rows) || rows.length === 0 || rows.length > 20) return false;
    const ids = new Set();
    return rows.every((row) => {
      if (!row || typeof row.id !== "string" || !row.id || ids.has(row.id) ||
          typeof row.label !== "string" || row.label.trim().length === 0 || row.label.length > 100 ||
          typeof row.choice !== "string" || !allowed.has(row.choice)) return false;
      ids.add(row.id);
      return true;
    });
  }

  if (question.type === "multiple_choice") {
    const choices = Array.isArray(answer.choices) ? answer.choices :
      typeof answer.choice === "string" ? [answer.choice] : null;
    if (!isValidChoiceSet(question, choices)) return false;
    return answer.explanation === undefined ||
      (typeof answer.explanation === "string" && answer.explanation.length <= 5_000);
  }

  const parts = Array.isArray(question.parts) ? question.parts : [];
  if (parts.length < 2 || !answer.parts || typeof answer.parts !== "object" || Array.isArray(answer.parts)) return false;
  if (Object.keys(answer.parts).some((id) => !parts.some((part) => part.id === id))) return false;
  if (answer.explanation !== undefined &&
      (typeof answer.explanation !== "string" || answer.explanation.length > 5_000)) return false;
  for (const part of parts) {
    const value = answer.parts[part.id];
    const choices = value && Array.isArray(value.choices) ? value.choices : [];
    if (part.optional === true && choices.length === 0) continue;
    const pseudoQuestion = { options: part.options, selection_mode: part.selection_mode, max_selections: part.max_selections };
    if (!value || !isValidChoiceSet(pseudoQuestion, value.choices)) return false;
  }
  return true;
}

export function isValidClosureDraft(questionnaire, value) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
      !value.documents || typeof value.documents !== "object" || Array.isArray(value.documents)) return false;
  const checklist = Array.isArray(questionnaire?.document_checklist) ? questionnaire.document_checklist : [];
  if (Object.keys(value.documents).some((id) => !checklist.some((item) => item.id === id))) return false;
  for (const item of checklist) {
    const status = value.documents[item.id];
    if (status !== undefined &&
        (!Array.isArray(item.status_options) || typeof status !== "string" || !item.status_options.includes(status))) return false;
  }
  if (typeof value.owner_date !== "string" || value.owner_date.length > 10 ||
      (value.owner_date !== "" && !/^\d{4}-\d{2}-\d{2}$/.test(value.owner_date))) return false;
  if (typeof value.owner_signature !== "string" || value.owner_signature.length > 200) return false;
  return typeof value.acknowledged === "boolean";
}

export function isValidClosureAnswer(questionnaire, value) {
  if (!isValidClosureDraft(questionnaire, value)) return false;
  const checklist = Array.isArray(questionnaire?.document_checklist) ? questionnaire.document_checklist : [];
  return checklist.every((item) => typeof value.documents[item.id] === "string") &&
    /^\d{4}-\d{2}-\d{2}$/.test(value.owner_date) &&
    value.owner_signature.trim().length >= 2 &&
    value.acknowledged === true;
}
