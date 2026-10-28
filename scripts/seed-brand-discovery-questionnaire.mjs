import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(scriptDir, "../config/brand-discovery");
const requestedFile = process.argv[2] ?? "raahat-question-bank-v1.draft.json";
if (isAbsolute(requestedFile) || !requestedFile.endsWith(".json")) {
  throw new Error("Pass a .json template filename located inside config/brand-discovery; absolute paths are not allowed.");
}
const file = resolve(templateDir, requestedFile);
const rel = relative(templateDir, file);
if (rel === "" || rel.startsWith(".." + sep) || rel === "..") {
  throw new Error("Template path must remain inside config/brand-discovery.");
}
const bank = JSON.parse(await readFile(file, "utf8"));

function validateDraftTemplate(value) {
  const errors = [];
  if (!value || typeof value !== "object" || Array.isArray(value)) return ["template_not_an_object"];
  if (value.status !== "draft") errors.push("template_must_remain_draft");
  if (typeof value.slug !== "string" || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value.slug)) errors.push("invalid_slug");
  if (!Number.isInteger(value.version) || value.version < 1) errors.push("invalid_version");
  if (!value.brand || typeof value.brand.name !== "string" || !value.brand.name.trim() ||
      typeof value.brand.category !== "string" || !value.brand.category.trim()) errors.push("brand_name_and_category_required");
  if (!Array.isArray(value.sections) || value.sections.length === 0) errors.push("sections_required");
  if (!Array.isArray(value.document_checklist)) errors.push("document_checklist_required");

  const sectionIds = new Set();
  const questionIds = new Set();
  let total = 0;
  for (const section of value.sections ?? []) {
    if (!section || typeof section.id !== "string" || !section.id.trim() || sectionIds.has(section.id) ||
        typeof section.title !== "string" || !section.title.trim() || !Array.isArray(section.questions)) {
      errors.push("invalid_or_duplicate_section");
      continue;
    }
    sectionIds.add(section.id);
    for (const q of section.questions) {
      total++;
      if (!q || typeof q.id !== "string" || !q.id.trim() || questionIds.has(q.id) ||
          typeof q.prompt !== "string" || !q.prompt.trim() || typeof q.required !== "boolean" ||
          !["text", "long_text", "repeatable_list", "file_or_text", "multiple_choice", "multi_part", "service_status", "repeatable_choice"].includes(q.type)) {
        errors.push("invalid_or_duplicate_question");
        continue;
      }
      questionIds.add(q.id);
      const validOptions = (options) => Array.isArray(options) && options.length > 0 &&
        options.every((option) => option && typeof option.value === "string" && option.value.trim() &&
          typeof option.label === "string" && option.label.trim()) &&
        new Set(options.map((option) => option.value)).size === options.length;
      if (q.type === "multiple_choice" &&
          (!validOptions(q.options) || !["single", "multiple"].includes(q.selection_mode) ||
           (q.max_selections !== undefined && (!Number.isInteger(q.max_selections) || q.max_selections < 1 || q.max_selections > q.options.length)))) {
        errors.push("invalid_multiple_choice:" + q.id);
      }
      if (q.type === "multi_part" && (!Array.isArray(q.parts) || q.parts.length < 2 ||
          q.parts.some((part) => !part || typeof part.id !== "string" || !part.id ||
            typeof part.label !== "string" || !part.label ||
            !["single", "multiple"].includes(part.selection_mode) || !validOptions(part.options)))) {
        errors.push("invalid_multi_part:" + q.id);
      }
      if (q.type === "service_status" && (!validOptions(q.service_options) || !validOptions(q.status_options))) {
        errors.push("invalid_service_status:" + q.id);
      }
      if (q.type === "repeatable_choice" && (!validOptions(q.options) ||
          typeof q.row_label !== "string" || !q.row_label.trim() ||
          typeof q.row_prompt !== "string" || !q.row_prompt.trim())) {
        errors.push("invalid_repeatable_choice:" + q.id);
      }
    }
  }
  if (!Number.isInteger(value.question_count) || value.question_count !== total) errors.push("question_count_mismatch");

  const checklistIds = new Set();
  for (const item of value.document_checklist ?? []) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || checklistIds.has(item.id) ||
        typeof item.label !== "string" || !item.label.trim() ||
        !Array.isArray(item.status_options) || item.status_options.length < 2 ||
        item.status_options.some((status) => typeof status !== "string" || !status.trim())) {
      errors.push("invalid_document_checklist_item");
    } else checklistIds.add(item.id);
  }
  if (typeof value.confidentiality_and_acknowledgement !== "string" ||
      !value.confidentiality_and_acknowledgement.trim()) errors.push("acknowledgement_required");
  return [...new Set(errors)];
}

const errors = validateDraftTemplate(bank);
if (errors.length) throw new Error("Refusing to seed invalid draft template: " + errors.join(", "));

// The first pilot has additional source-specific safeguards. Future brand templates
// are validated by the shared schema above and the universal invite release gate.
if (bank.slug === "raahat-brand-discovery" &&
    (bank.source_status !== "CANONICAL_SOURCE_MAPPED_DRAFT" || bank.question_count !== 235 ||
     bank.sections.length !== 16 || bank.document_checklist.length !== 20)) {
  throw new Error("Refusing to seed Raahat: its draft must retain the mapped 16-section, 235-question, 20-item source structure.");
}
if (process.env.BRAND_DISCOVERY_SEED_CONFIRM !== "I_UNDERSTAND_DRAFT_SEED") {
  throw new Error("Set BRAND_DISCOVERY_SEED_CONFIRM=I_UNDERSTAND_DRAFT_SEED to confirm a draft-only database write.");
}
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.");
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: existing, error: lookupError } = await db
  .from("brand_discovery_questionnaire_versions")
  .select("id,status")
  .eq("slug", bank.slug)
  .eq("version", bank.version)
  .maybeSingle();
if (lookupError) throw lookupError;
if (existing) {
  if (existing.status !== "draft") {
    throw new Error("A non-draft version already exists; refusing to overwrite or change its status.");
  }
  const { error } = await db.from("brand_discovery_questionnaire_versions").update({
    brand_category: bank.brand.category,
    title: `${bank.brand.name} Brand Discovery — Draft v${bank.version}`,
    locale: bank.locale ?? "hi-en",
    questionnaire: bank,
  }).eq("id", existing.id);
  if (error) throw error;
  console.log(`Updated existing draft version ${existing.id}; it remains draft and cannot be invited.`);
} else {
  const { data, error } = await db.from("brand_discovery_questionnaire_versions").insert({
    slug: bank.slug,
    version: bank.version,
    brand_category: bank.brand.category,
    title: `${bank.brand.name} Brand Discovery — Draft v${bank.version}`,
    locale: bank.locale ?? "hi-en",
    questionnaire: bank,
    status: "draft",
  }).select("id").single();
  if (error) throw error;
  console.log(`Inserted draft version ${data.id}; it remains draft and cannot be invited.`);
}
console.log("No session or invitation was created. This seed is draft-only; complete all reviews and record human approval before activation.");
