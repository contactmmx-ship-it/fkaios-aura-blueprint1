import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const path = new URL("../config/brand-discovery/raahat-question-bank-v1.draft.json", import.meta.url);
const bank = JSON.parse(await readFile(path, "utf8"));
assert.equal(bank.status, "draft");
assert.equal(bank.source_status, "ORIGINAL_QUESTION_TEXT_NOT_RECOVERED");
assert.match(bank.critical_notice, /not recovered historical wording/i);
assert.equal(bank.sections.length, 16);
assert.equal(bank.question_count, 234);

const sectionIds = new Set();
const questionIds = new Set();
let total = 0;
for (const section of bank.sections) {
  assert.ok(section.id && section.title, "section needs id and title");
  assert.ok(!sectionIds.has(section.id), `duplicate section id: ${section.id}`);
  sectionIds.add(section.id);
  assert.equal(section.questions.length, section.expected_question_count,
    `question count mismatch in section ${section.id}`);
  for (const question of section.questions) {
    assert.ok(question.id && question.prompt && question.type, "question needs id, prompt, and type");
    assert.ok(!questionIds.has(question.id), `duplicate question id: ${question.id}`);
    questionIds.add(question.id);
    assert.equal(question.source_status, "NEW_DRAFT_NOT_RECOVERED_ORIGINAL");
    total++;
  }
}
assert.equal(total, bank.question_count);
assert.equal(bank.document_checklist.length, 14);
console.log(`PASS: ${bank.sections.length} sections, ${total} unique draft questions, ${bank.document_checklist.length} checklist items.`);
console.log("NOTICE: structural validation only; original wording, business relevance, and production security remain unverified.");
