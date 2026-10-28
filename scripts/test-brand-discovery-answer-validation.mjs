import assert from "node:assert/strict";
import {
  isValidChoiceSet, isValidQuestionAnswer, isValidClosureDraft, isValidClosureAnswer,
} from "../supabase/functions/_shared/brand-discovery-answer-validation.mjs";

const single = { type: "multiple_choice", options: [{ value: "a", label: "A" }, { value: "b", label: "B" }], selection_mode: "single" };
assert.equal(isValidQuestionAnswer(single, JSON.stringify({ choices: ["a"] })), true);
assert.equal(isValidQuestionAnswer(single, { choices: ["unknown"] }), false);
assert.equal(isValidQuestionAnswer(single, { choices: ["a", "b"] }), false);
assert.equal(isValidChoiceSet({ ...single, selection_mode: "multiple", max_selections: 1 }, ["a", "b"]), false);
assert.equal(isValidChoiceSet({ ...single, selection_mode: "multiple" }, ["a", "a"]), false);

assert.equal(isValidQuestionAnswer({ type: "text" }, "Answer"), true);
assert.equal(isValidQuestionAnswer({ type: "text" }, " "), false);
assert.equal(isValidQuestionAnswer({ type: "text" }, { text: "not a string" }), false);
assert.equal(isValidQuestionAnswer({ type: "text" }, "x".repeat(2_001)), false);
assert.equal(isValidQuestionAnswer({ type: "long_text" }, "x".repeat(10_000)), true);
assert.equal(isValidQuestionAnswer({ type: "file_or_text" }, "x".repeat(5_001)), false);
assert.equal(isValidQuestionAnswer({ type: "multiple_choice", options: [{ value: "a", label: "A" }], selection_mode: "single" }, { choices: ["a"], padding: "x".repeat(25_001) }), false);

const multipart = {
  type: "multi_part",
  parts: [
    { id: "a", label: "Part A", selection_mode: "single", options: [{ value: "yes", label: "Yes" }] },
    { id: "b", label: "Part B", selection_mode: "single", optional: true, options: [{ value: "no", label: "No" }] },
  ],
};
assert.equal(isValidQuestionAnswer(multipart, { parts: { a: { choices: ["yes"] }, b: { choices: [] } } }), true);
assert.equal(isValidQuestionAnswer(multipart, { parts: { a: { choices: [] }, b: { choices: [] } } }), false);
assert.equal(isValidQuestionAnswer(multipart, { parts: { a: { choices: ["yes"] }, unknown: { choices: ["no"] } } }), false);

const serviceStatus = {
  type: "service_status",
  service_options: [{ value: "rooms", label: "Rooms" }, { value: "food", label: "Food" }],
  status_options: [{ value: "active", label: "Active" }, { value: "planned", label: "Planned" }],
};
assert.equal(isValidQuestionAnswer(serviceStatus, { services: ["rooms"], statuses: { rooms: "active" } }), true);
assert.equal(isValidQuestionAnswer(serviceStatus, { services: ["rooms"], statuses: {} }), false);
assert.equal(isValidQuestionAnswer(serviceStatus, { services: ["rooms", "rooms"], statuses: { rooms: "active" } }), false);
assert.equal(isValidQuestionAnswer(serviceStatus, { services: ["rooms"], statuses: { rooms: "active", food: "planned" } }), false);

const repeatable = {
  type: "repeatable_choice", row_label: "Hall", row_prompt: "Capacity",
  options: [{ value: "small", label: "Small" }, { value: "large", label: "Large" }],
};
assert.equal(isValidQuestionAnswer(repeatable, { rows: [{ id: "r1", label: "Main Hall", choice: "large" }] }), true);
assert.equal(isValidQuestionAnswer(repeatable, { rows: [{ id: "r1", label: "Main Hall", choice: "bad" }] }), false);
assert.equal(isValidQuestionAnswer(repeatable, { rows: [{ id: "r1", label: "A", choice: "small" }, { id: "r1", label: "B", choice: "large" }] }), false);
assert.equal(isValidQuestionAnswer(repeatable, { rows: Array.from({ length: 21 }, (_, i) => ({ id: "r" + i, label: "Hall " + i, choice: "small" })) }), false);

const closureQuestionnaire = {
  document_checklist: [
    { id: "sales", label: "Sales records", status_options: ["available", "missing"] },
    { id: "staff", label: "Staff list", status_options: ["available", "missing"] },
  ],
};
const closure = {
  documents: { sales: "available", staff: "missing" },
  owner_date: "2026-10-28",
  owner_signature: "Owner Name",
  acknowledged: true,
};
assert.equal(isValidClosureDraft(closureQuestionnaire, closure), true);
assert.equal(isValidClosureAnswer(closureQuestionnaire, closure), true);
assert.equal(isValidClosureDraft(closureQuestionnaire, { ...closure, documents: { unknown: "available" } }), false);
assert.equal(isValidClosureAnswer(closureQuestionnaire, { ...closure, documents: { sales: "available" } }), false);
assert.equal(isValidClosureAnswer(closureQuestionnaire, { ...closure, acknowledged: false }), false);
assert.equal(isValidClosureAnswer(closureQuestionnaire, { ...closure, owner_date: "28-10-2026" }), false);

console.log("Brand Discovery answer-validation tests passed (26 assertions).");
