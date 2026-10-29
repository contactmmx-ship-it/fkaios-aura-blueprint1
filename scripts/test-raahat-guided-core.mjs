import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const guided = JSON.parse(await readFile(new URL("../config/brand-discovery/raahat-guided-discovery-v1.draft.json", import.meta.url), "utf8"));
const full = JSON.parse(await readFile(new URL("../config/brand-discovery/raahat-question-bank-v1.draft.json", import.meta.url), "utf8"));
assert.equal(guided.slug, "raahat-guided-discovery");
assert.equal(guided.status, "draft");
assert.equal(guided.brand.name, "Raahat");
assert.equal(guided.sections.length, 16);
assert.equal(guided.question_count, 71);
assert.equal(guided.sections.reduce((sum, section) => sum + section.questions.length, 0), 71);
assert.equal(guided.document_checklist.length, 20);
assert.equal(full.question_count, 235, "The canonical full source-mapped bank must remain unchanged.");
assert.equal(full.sections.length, 16);
const sourceById = new Map(full.sections.flatMap(section => section.questions.map(question => [question.id, question])));
const ids = new Set();
for (const section of guided.sections) {
  assert.ok(section.questions.length >= 1, "Every Raahat chapter must have guided core questions.");
  for (const question of section.questions) {
    assert.ok(!ids.has(question.id), "Duplicate guided question id: " + question.id);
    ids.add(question.id);
    const source = sourceById.get(question.id);
    assert.ok(source, "Guided question must come from the canonical source bank: " + question.id);
    assert.equal(question.prompt, source.prompt, "Do not rewrite source prompt in the guided core: " + question.id);
    assert.equal(question.source_block, source.source_block, "Preserve source provenance: " + question.id);
    assert.equal(question.source_question_number, source.number, "Retain original source numbering: " + question.id);
    assert.deepEqual(question.options, source.options, "Preserve source choice wording/order: " + question.id);
    if (question.type === "multi_part") assert.deepEqual(question.parts, source.parts, "Preserve multi-part controls: " + question.id);
    assert.equal(question.number, section.questions.indexOf(question) + 1, "Guided display numbering must be continuous within each chapter.");
  }
}
assert.equal(ids.size, 71);
assert.equal(guided.source_reconciliation.guided_core_selection_reviewed, false,
  "Do not represent a human-reviewed selection as complete before sign-off.");
console.log("PASS: Raahat guided core — 71 source-traceable prompts across 16 chapters, 20 checklist items; original 235-question bank preserved separately.");
