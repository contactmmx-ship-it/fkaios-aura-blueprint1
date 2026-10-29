import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { validateBrandDiscoveryDraft } from "../supabase/functions/_shared/brand-discovery-template-gate.mjs";

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

const validation = validateBrandDiscoveryDraft(bank);
const errors = validation.errors;
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
