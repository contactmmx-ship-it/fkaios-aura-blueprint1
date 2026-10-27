import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const bank = JSON.parse(await readFile(new URL("../config/brand-discovery/raahat-question-bank-v1.draft.json", import.meta.url), "utf8"));
const source = JSON.parse(await readFile(new URL("../docs/brand-discovery/source/RAAHAT_SOURCE_TRANSCRIPTION_V1.json", import.meta.url), "utf8"));

// This checks exact source-to-runtime mapping. It deliberately does NOT approve or activate the draft.
assert.equal(bank.status, "draft", "The questionnaire must remain inactive until release approval.");
assert.equal(bank.source_status, "CANONICAL_SOURCE_MAPPED_DRAFT", "Unexpected source mapping state.");
assert.equal(source.sections.length, 16);
assert.equal(source.question_count, 235);
assert.equal(source.document_checklist.length, 20);
assert.equal(bank.sections.length, source.sections.length);
assert.equal(bank.question_count, source.question_count);
assert.equal(bank.document_checklist.length, source.document_checklist.length);

const selectionMode = (instruction = "") => {
  const text = instruction.toLowerCase();
  const match = text.match(/select up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)/);
  const words = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  if (match) return { mode: "multiple", max: Number(match[1]) || words[match[1]] };
  if (text.includes("select all") || text.includes("select one or more") || text.includes("select the relevant categories") || text.includes("rank the applicable services")) return { mode: "multiple" };
  return { mode: "single" };
};
const optionLabels = (block) => [...block.matchAll(/^\s*-\s*☐\s*(.+?)\s*$/gm)].map((match) => match[1].trim());
const subparts = (block) => {
  const lines = block.split("\n");
  const headers = [];
  for (let index = 0; index < lines.length; index++) {
    const match = lines[index].match(/^\*\*([A-Z])\.\s*(.+?)\*\*\s*$/);
    if (match) headers.push({ letter: match[1], title: match[2].replace(/\s*[—–-]\s*select.*$/i, "").trim(), raw: match[2], line: index });
  }
  if (headers.length < 2) return [];
  return headers.map((header, index) => {
    const end = headers[index + 1]?.line ?? lines.length;
    const body = lines.slice(header.line, end).join("\n");
    const mode = selectionMode(header.raw);
    return { id: "part_" + header.letter.toLowerCase(), label: header.letter + ". " + header.title, mode: mode.mode, max: mode.max, options: optionLabels(body) };
  });
};

const seenSectionIds = new Set();
const seenQuestionIds = new Set();
let total = 0;
let multiPartCount = 0;
for (let index = 0; index < source.sections.length; index++) {
  const originalSection = source.sections[index];
  const section = bank.sections[index];
  assert.equal(section.source_section_number, originalSection.number, "Section order/number mismatch.");
  assert.equal(section.title, originalSection.title, "Section title mismatch in section " + originalSection.number);
  assert.ok(section.id && !seenSectionIds.has(section.id), "Missing or duplicate section id.");
  seenSectionIds.add(section.id);
  assert.equal(section.questions.length, originalSection.questions.length, "Question count mismatch in section " + originalSection.number);

  for (let qIndex = 0; qIndex < originalSection.questions.length; qIndex++) {
    const original = originalSection.questions[qIndex];
    const question = section.questions[qIndex];
    const label = "Section " + originalSection.number + ", question " + original.number;
    assert.ok(question.id && !seenQuestionIds.has(question.id), "Missing or duplicate question id: " + label);
    seenQuestionIds.add(question.id);
    assert.equal(question.number, original.number, "Question order/number mismatch: " + label);
    assert.equal(question.prompt, original.prompt, "Prompt mismatch: " + label);
    assert.equal(question.source_block, original.source_block, "Canonical source block mismatch: " + label);
    assert.equal(question.source_section_number, originalSection.number, "Source section mismatch: " + label);
    assert.equal(question.required, true, "Question must require a response (use a source-provided 'not sure' option when applicable): " + label);

    const expectedOptions = optionLabels(original.source_block);
    const customKey = originalSection.number + ":" + original.number;
    if (customKey === "3:1") {
      assert.equal(question.type, "service_status", "Service inventory must capture status for each selected service.");
      assert.deepEqual(question.service_options.map((option) => option.label), expectedOptions.slice(0, 12));
      assert.deepEqual(question.status_options.map((option) => option.label), expectedOptions.slice(12));
    } else if (customKey === "6:1") {
      assert.equal(question.type, "repeatable_choice", "Capacity must be captured separately for each named hall.");
      assert.deepEqual(question.options.map((option) => option.label), expectedOptions);
    } else if (["4:15", "5:1", "5:3", "5:4"].includes(customKey)) {
      assert.equal(question.type, "multi_part", "Question requiring multiple independent answers must use separate controls: " + label);
      const expectedDefinitions = customKey === "4:15"
        ? ["Breakfast", "Lunch", "Dinner", "Group dining"].map((name, index) => ({ id: "period_" + (index + 1), label: name, options: expectedOptions, mode: "single" }))
        : customKey === "5:1"
          ? [
              { id: "room_count", label: "Room count", options: expectedOptions.slice(0, 6), mode: "single" },
              { id: "room_categories", label: "Room categories", options: expectedOptions.slice(6), mode: "multiple" },
            ]
          : customKey === "5:3"
            ? ["Standard", "Deluxe", "Executive", "Suite", "Other category"].map((name, index) => ({ id: "rate_" + (index + 1), label: name, options: expectedOptions, mode: "single" }))
            : ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"].map((name, index) => ({ id: "month_" + (index + 1), label: name, options: expectedOptions, mode: "single" }));
      assert.equal(question.parts.length, expectedDefinitions.length, "Custom part count mismatch: " + label);
      for (let partIndex = 0; partIndex < expectedDefinitions.length; partIndex++) {
        const expected = expectedDefinitions[partIndex];
        const actual = question.parts[partIndex];
        assert.equal(actual.id, expected.id, "Custom part id mismatch: " + label);
        assert.equal(actual.label, expected.label, "Custom part label mismatch: " + label);
        assert.equal(actual.selection_mode, expected.mode, "Custom part selection mode mismatch: " + label);
        assert.deepEqual(actual.options.map((option) => option.label), expected.options, "Custom part options mismatch: " + label);
      }
    } else {
      const expectedParts = subparts(original.source_block);
      if (expectedParts.length) {
        multiPartCount++;
        assert.equal(question.type, "multi_part", "Multi-part question not mapped to separate controls: " + label);
        assert.equal(question.parts.length, expectedParts.length, "Part count mismatch: " + label);
        for (let partIndex = 0; partIndex < expectedParts.length; partIndex++) {
          const expected = expectedParts[partIndex];
          const actual = question.parts[partIndex];
          assert.equal(actual.id, expected.id, "Part id mismatch: " + label);
          assert.equal(actual.label, expected.label, "Part label mismatch: " + label + " " + expected.id);
          assert.equal(actual.selection_mode, expected.mode, "Part selection mode mismatch: " + label + " " + expected.id);
          assert.equal(actual.max_selections, expected.max, "Part selection limit mismatch: " + label + " " + expected.id);
          assert.deepEqual(actual.options.map((option) => option.label), expected.options, "Part options mismatch: " + label + " " + expected.id);
        }
      } else if (expectedOptions.length) {
        assert.equal(question.type, "multiple_choice", "Choice question has wrong runtime type: " + label);
        assert.deepEqual(question.options.map((option) => option.label), expectedOptions, "Choice labels/order mismatch: " + label);
        const expectedMode = selectionMode(original.selection_instruction);
        assert.equal(question.selection_mode, expectedMode.mode, "Selection mode mismatch: " + label);
        assert.equal(question.max_selections, expectedMode.max, "Selection limit mismatch: " + label);
      } else {
        assert.ok(question.type === "text" || question.type === "long_text", "Open-response question has wrong runtime type: " + label);
      }
    }
    total++;
  }
}

assert.equal(total, 235);
assert.equal(multiPartCount, 6, "Expected six source questions with separately selectable subparts.");
assert.deepEqual(
  bank.document_checklist.map((item) => item.label),
  source.document_checklist,
  "Supporting document checklist labels/order must exactly match source."
);
assert.equal(bank.confidentiality_and_acknowledgement, source.confidentiality_and_acknowledgement,
  "Confidentiality and acknowledgement text must exactly match source.");
assert.equal(bank.source_reconciliation.exact_prompt_and_source_block_mapping, true);
assert.equal(bank.source_reconciliation.options_transcribed, true);
assert.equal(bank.source_reconciliation.selection_rules_interactive_verified, false,
  "Do not mark interactive selection rules verified before end-to-end testing.");
assert.equal(bank.source_reconciliation.checklist_interactive_verified, false,
  "Do not mark the checklist verified before it is implemented and tested.");

console.log("PASS: source mapping — 16 sections, 235 exact prompt/source blocks, 229 choice questions, 6 multi-part questions, exact choice order/limits, 20 checklist items and acknowledgement text.");
console.log("RELEASE BLOCKED BY DESIGN: template remains draft; checklist/acknowledgement UI, security, accessibility and end-to-end tests are not yet approved.");
