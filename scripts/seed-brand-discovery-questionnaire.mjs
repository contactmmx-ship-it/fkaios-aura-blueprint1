import { readFile } from "node:fs/promises";
import { createClient } from "@supabase/supabase-js";

const file = new URL("../config/brand-discovery/raahat-question-bank-v1.draft.json", import.meta.url);
const bank = JSON.parse(await readFile(file, "utf8"));

const nestedQuestionCount = Array.isArray(bank.sections)
  ? bank.sections.reduce((sum, section) => sum + (Array.isArray(section.questions) ? section.questions.length : 0), 0)
  : 0;
if (bank.status !== "draft" || bank.source_status !== "CANONICAL_SOURCE_MAPPED_DRAFT" ||
    bank.question_count !== 235 || !Array.isArray(bank.sections) || bank.sections.length !== 16 ||
    nestedQuestionCount !== 235 || !Array.isArray(bank.document_checklist) || bank.document_checklist.length !== 20) {
  throw new Error("Refusing to seed: only the complete 16-section, 235-question, 20-item source-mapped draft may be seeded, and it must remain draft.");
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
    locale: "hi-en",
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
    locale: "hi-en",
    questionnaire: bank,
    status: "draft",
  }).select("id").single();
  if (error) throw error;
  console.log(`Inserted draft version ${data.id}; it remains draft and cannot be invited.`);
}
console.log("No session or invitation was created. This seed is draft-only; complete semantic review and release gates before any activation.");
