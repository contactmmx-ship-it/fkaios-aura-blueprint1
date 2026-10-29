import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateBrandDiscoveryDraft } from "../supabase/functions/_shared/brand-discovery-template-gate.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const templateDir = resolve(scriptDir, "../config/brand-discovery");
const filename = process.argv[2];
if (!filename || isAbsolute(filename) || !filename.endsWith(".json")) {
  throw new Error("Usage: node scripts/validate-brand-discovery-template.mjs <template-file.json>");
}
const path = resolve(templateDir, filename);
const rel = relative(templateDir, path);
if (rel === ".." || rel.startsWith(".." + sep)) throw new Error("Template must be inside config/brand-discovery.");
const template = JSON.parse(await readFile(path, "utf8"));
const result = validateBrandDiscoveryDraft(template);
if (!result.ok) {
  console.error("Draft template validation FAILED:");
  for (const error of result.errors) console.error(" - " + error);
  process.exitCode = 1;
} else {
  const count = template.sections.reduce((sum, section) => sum + section.questions.length, 0);
  console.log("Draft template structure PASS (not release approval).");
  console.log("Brand: " + template.brand.name);
  console.log("Slug/version: " + template.slug + " v" + template.version);
  console.log("Sections/questions/checklist: " + template.sections.length + "/" + count + "/" + template.document_checklist.length);
  console.log("Release flags and human approval are intentionally not marked complete by this validator.");
  if (template.slug === "raahat-brand-discovery") {
    console.log("Run node scripts/validate-brand-discovery-questionnaire.mjs separately for canonical Raahat source reconciliation.");
  }
}
