/// <reference lib="deno.ns" />
// Regression tests for the research-evidence rules and the BLOCKED -> re-run
// path, using the live Bharat Paints task set (objective 79ef3604).
import { canRerun, isRerunRequested, rerunUpdate } from "./objective-rerun.ts";
import {
  assessCurrentTaskSet,
  assessTaskEvidence,
  compactDispatchForStorage,
  formatBlockedSummary,
  KNOWLEDGE_MATCH_MIN_SIMILARITY,
  NO_DATA_SOURCE,
} from "./fact-grounding.ts";

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

const DISTRIBUTOR_TASK = {
  title: "Identify and Shortlist 20 Potential Distributors",
  description: "Research and compile a targeted list of 20 high-potential regional paint distributors in key tier-1 and tier-2 Indian markets.",
};

// A real vault-engine search response shape (match_knowledge_chunks rows).
const vaultDispatch = (similarities: number[]) => ({
  capability: "knowledge.search",
  status: "success",
  attempts: 1,
  data: {
    query: "Indian paint distributors",
    matches: similarities.map((s, i) => ({ id: `chunk-${i}`, document_id: `doc-${i}`, chunk_text: "x".repeat(1400), similarity: s })),
  },
});
const doneWith = (task: typeof DISTRIBUTOR_TASK, dispatch: unknown) => ({
  ...task,
  status: "done",
  output: JSON.stringify({ llmResult: { capability: "knowledge.search" }, companyOsDispatch: compactDispatchForStorage(dispatch) }).slice(0, 5000),
});

Deno.test("stored research evidence keeps verifiable source metadata and fits the 5000-char column", () => {
  const stored = compactDispatchForStorage(vaultDispatch([0.91, 0.88, 0.86, 0.84, 0.83]));
  const text = JSON.stringify({ companyOsDispatch: stored });
  assert(text.length < 5000, `stored evidence must not be truncated (was ${text.length})`);
  const matches = (stored.evidence as { matches: Array<Record<string, unknown>> }).matches;
  assert(matches.length === 5 && matches.every((m) => typeof m.document_id === "string" && typeof m.similarity === "number"), "every match has document_id + similarity");
  assert((stored.evidence as { query: string }).query === "Indian paint distributors", "query recorded");
});

Deno.test("a relevant, sourced vault match counts as evidence for a factual task", () => {
  const v = assessTaskEvidence(doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.87])));
  assert(v.verdict === "verified", `expected verified, got ${v.verdict}: ${v.reason}`);
  assert(v.reason.includes("doc-0"), "reason names the source document");
});

Deno.test("ungrounded research cannot count: irrelevant vault matches are no_data_source", () => {
  // Only the FKAIOS charter is in the vault; a distributor query still "succeeds" with it.
  const v = assessTaskEvidence(doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.72, 0.70])));
  assert(v.verdict === NO_DATA_SOURCE, `expected no_data_source, got ${v.verdict}`);
  assert(v.reason.includes(`below ${KNOWLEDGE_MATCH_MIN_SIMILARITY}`), "reason states the relevance floor");
  const empty = assessTaskEvidence(doneWith(DISTRIBUTOR_TASK, vaultDispatch([])));
  assert(empty.verdict === NO_DATA_SOURCE, "no matches is no evidence");
  const gate = assessCurrentTaskSet([{ id: "p1" }], [{ ...doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.72])), project_id: "p1" }]);
  assert(gate.blocked && !gate.allVerified, "the objective blocks; it can never be achieved on irrelevant matches");
  assert(!formatBlockedSummary(gate).includes("xxxxxxxx"), "no search text is quoted into the founder summary");
});

Deno.test("an internal (non-factual) vault search still succeeds on any sourced result", () => {
  const v = assessTaskEvidence(doneWith({ title: "Search knowledge vault for capability registry documentation", description: "Search the company knowledge vault. Report what is found." }, vaultDispatch([0.7])));
  assert(v.verdict === "verified", "internal lookups are not held to the external-facts rule");
});

Deno.test("the live 401 dispatch stays a failure, not evidence", () => {
  const v = assessTaskEvidence({
    title: "Analyze Indian Paint Market Size and Segments",
    description: "Conduct comprehensive research on the Indian paint industry, focusing on competitive landscape and market share.",
    status: "done",
    output: JSON.stringify({ llmResult: { capability: "knowledge.search" }, companyOsDispatch: { capability: "knowledge.search", status: "error", error: "HTTP 401: {\"error\":\"Unauthorized\"}", attempts: 2 } }),
  });
  assert(v.verdict === "failed" && v.reason.includes("HTTP 401"), "401 is recorded as a failed dispatch");
});

Deno.test("BLOCKED objective can be re-run; high-risk approval and running objectives cannot", () => {
  assert(canRerun({ status: "awaiting_approval", action_taken: "objective_loop" }), "blocked by the loop -> re-runnable");
  assert(canRerun({ status: "failed", action_taken: "objective_loop" }), "failed -> re-runnable");
  assert(!canRerun({ status: "awaiting_approval", action_taken: null }), "high-risk approval is not a re-run");
  assert(!canRerun({ status: "processing", action_taken: "objective_loop" }), "already running");
  const update = rerunUpdate("2026-09-23T17:00:00Z");
  assert(update.status === "processing" && isRerunRequested(update), "re-run moves it to processing with the flag the loop reads");
});

Deno.test("after a re-run, the new planning pass decides; the old blocked pass stays as history", () => {
  const oldBlocked = { ...DISTRIBUTOR_TASK, status: "done", output: '{"status":"completed","deliverable":{"shortlisted_distri', project_id: "old" };
  const newPending = { ...DISTRIBUTOR_TASK, status: "assigned", output: null, project_id: "new" };
  const running = assessCurrentTaskSet([{ id: "new" }, { id: "old" }], [oldBlocked, newPending]);
  assert(!running.blocked && !running.allVerified, "new pass is executing, not blocked by the old one");
  const newVerified = { ...doneWith(DISTRIBUTOR_TASK, vaultDispatch([0.9])), project_id: "new" };
  const done = assessCurrentTaskSet([{ id: "new" }, { id: "old" }], [oldBlocked, newVerified]);
  assert(done.allVerified, "with real evidence the new pass can be achieved");
  const stillOld = assessCurrentTaskSet([{ id: "old" }], [oldBlocked]);
  assert(stillOld.blocked, "without a new pass the objective stays blocked");
});
