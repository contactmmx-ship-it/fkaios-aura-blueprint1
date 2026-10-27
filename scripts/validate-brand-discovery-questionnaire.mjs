import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = new URL("../config/brand-discovery/raahat-question-bank-v1.draft.json", import.meta.url);
const bank = JSON.parse(await readFile(path, "utf8"));

// Release gate: the historical 234-question reconstruction is not the approved source.
// This validator intentionally fails closed until the exact owner-supplied source is encoded.
assert.equal(bank.status, "draft", "Questionnaire must remain draft until release approval.");
assert.equal(
  bank.source_status,
  "CANONICAL_SOURCE_TRANSCRIBED_AND_RECONCILED",
  "Canonical source is not reconciled: do not merge/activate the 234-question draft."
);
assert.equal(bank.question_count, 95, "Canonical source must contain exactly 95 questions.");
assert.equal(bank.sections.length, 17, "Canonical source must contain exactly 17 parts A–Q.");
assert.equal(bank.document_checklist.length, 16, "Canonical source must contain exactly 16 checklist items.");
assert.ok(
  bank.owner_declaration && bank.confidentiality_text && bank.franchise_kart_signoff,
  "Canonical owner declaration, confidentiality text, and FK sign-off must be present."
);

const sectionIds = new Set();
const questionIds = new Set();
const numbers = [];
let total = 0;

for (const [sectionIndex, section] of bank.sections.entries()) {
  assert.ok(section.id && section.title, `section ${sectionIndex + 1} needs id and title`);
  assert.ok(!sectionIds.has(section.id), `duplicate section id: ${section.id}`);
  sectionIds.add(section.id);
  assert.ok(Array.isArray(section.questions), `section ${section.id} needs questions`);

  for (const question of section.questions) {
    assert.ok(question.id && question.prompt && question.type, "question needs id, prompt, and type");
    assert.ok(!questionIds.has(question.id), `duplicate question id: ${question.id}`);
    questionIds.add(question.id);
    assert.equal(question.source_status, "CANONICAL_SOURCE_VERIFIED", `question ${question.id} not source-verified`);
    assert.ok(Number.isInteger(question.number), `question ${question.id} needs an integer source number`);
    numbers.push(question.number);

    if (question.selection_mode === "multiple") {
      assert.ok(Array.isArray(question.options) && question.options.length > 0,
        `multi-select question ${question.id} needs exact options`);
      if (question.max_selections !== undefined) {
        assert.ok(Number.isInteger(question.max_selections) && question.max_selections > 0 &&
          question.max_selections <= question.options.length,
        `question ${question.id} has invalid max_selections`);
      }
    }
    total++;
  }
}

assert.equal(total, 95, "Nested question count must equal 95.");
assert.deepEqual(
  numbers.slice().sort((a, b) => a - b),
  Array.from({ length: 95 }, (_, i) => i + 1),
  "Question numbers must be unique and cover Q1–Q95 exactly."
);
assert.ok(bank.source_reconciliation?.exact_wording_verified === true,
  "Exact wording reconciliation against the owner-supplied source is not marked verified.");
assert.ok(bank.source_reconciliation?.selection_rules_verified === true,
  "Selection rules have not been reconciled against the source.");
assert.ok(bank.source_reconciliation?.checklist_verified === true,
  "Checklist has not been reconciled against the source.");

console.log("PASS: canonical Raahat source gates — 95 questions, 17 parts, 16 checklist items, source reconciliation, numbering, and selection configuration.");
