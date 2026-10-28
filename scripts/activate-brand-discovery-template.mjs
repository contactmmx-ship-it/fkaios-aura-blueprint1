import { createClient } from "@supabase/supabase-js";
import { validateBrandDiscoveryTemplate } from "../supabase/functions/_shared/brand-discovery-template-gate.mjs";

const [slug, rawVersion, ...flags] = process.argv.slice(2);
if (!slug || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug) || !/^\d+$/.test(rawVersion ?? "")) {
  throw new Error("Usage: node scripts/activate-brand-discovery-template.mjs <slug> <version> --confirm-activate [--retire-existing-active]");
}
if (!flags.includes("--confirm-activate") ||
    process.env.BRAND_DISCOVERY_ACTIVATE_CONFIRM !== "I_APPROVE_TEMPLATE_RELEASE") {
  throw new Error("No database write performed. Activation requires --confirm-activate and BRAND_DISCOVERY_ACTIVATE_CONFIRM=I_APPROVE_TEMPLATE_RELEASE.");
}
const versionNumber = Number(rawVersion);
if (!Number.isSafeInteger(versionNumber) || versionNumber < 1) throw new Error("Version must be a positive integer.");
const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !serviceKey) throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required through the approved secret manager.");
const db = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: target, error: targetError } = await db.from("brand_discovery_questionnaire_versions")
  .select("id,slug,version,status,questionnaire,brand_category,title,locale")
  .eq("slug", slug).eq("version", versionNumber).maybeSingle();
if (targetError) throw targetError;
if (!target) throw new Error("Template version not found.");
if (target.status !== "draft" || target.questionnaire?.status !== "draft") {
  throw new Error("Only a draft version can be activated; no status changes were made.");
}
if (target.questionnaire?.slug !== target.slug || target.questionnaire?.version !== target.version ||
    target.questionnaire?.brand?.category !== target.brand_category) {
  throw new Error("Template JSON identity does not match the database row; no status changes were made.");
}

const candidate = { ...target.questionnaire, status: "active" };
const validation = validateBrandDiscoveryTemplate(candidate);
if (!validation.ok) throw new Error("Activation blocked by release gate: " + validation.errors.join(", "));

if (slug === "raahat-brand-discovery") {
  const q = candidate;
  const reconciliation = q.source_reconciliation;
  const requiredFlags = [
    "exact_prompt_and_source_block_mapping", "options_transcribed",
    "selection_rules_interactive_verified", "checklist_interactive_verified",
    "acknowledgement_ui_verified", "security_review_complete", "semantic_review_complete",
  ];
  if (q.source_status !== "CANONICAL_SOURCE_VERIFIED" || q.question_count !== 235 ||
      !Array.isArray(q.sections) || q.sections.length !== 16 ||
      !Array.isArray(q.document_checklist) || q.document_checklist.length !== 20 ||
      !reconciliation || reconciliation.section_count !== 16 ||
      reconciliation.question_count !== 235 || reconciliation.checklist_count !== 20 ||
      requiredFlags.some((key) => reconciliation[key] !== true) ||
      q.sections.some((section) => section.questions.some((question) =>
        question.source_status !== "CANONICAL_SOURCE_VERIFIED" || !question.source_block))) {
    throw new Error("Raahat activation blocked: canonical 16-section/235-question/20-item source verification is incomplete.");
  }
}

const { data: activeRows, error: activeError } = await db.from("brand_discovery_questionnaire_versions")
  .select("id,version,status").eq("slug", slug).eq("status", "active");
if (activeError) throw activeError;
const previous = (activeRows ?? []).filter((row) => row.id !== target.id);
if (previous.length && !flags.includes("--retire-existing-active")) {
  throw new Error("Another version is active for this slug. Review it, then rerun with --retire-existing-active to explicitly retire previous active versions.");
}
if (previous.length) {
  const { error } = await db.from("brand_discovery_questionnaire_versions")
    .update({ status: "retired" }).in("id", previous.map((row) => row.id));
  if (error) throw new Error("Could not retire previous active version; target remains draft.");
}
const { error: activateError } = await db.from("brand_discovery_questionnaire_versions")
  .update({ status: "active", questionnaire: candidate })
  .eq("id", target.id).eq("status", "draft");
if (activateError) throw activateError;
console.log(`Activated ${slug} v${versionNumber}. No respondent invitation was created and no email was sent by this script.`);
