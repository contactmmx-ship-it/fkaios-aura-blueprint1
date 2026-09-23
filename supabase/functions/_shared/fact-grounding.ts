// Fact grounding + objective evidence rules, shared by ai-engine (worker side)
// and objective-loop (verification side). Pure functions, no imports, so both
// Edge Functions can bundle it and it can be unit-tested offline.
//
// Why this exists: on 2026-09-23 a work_engine_task asking to "Identify and
// Shortlist 20 Potential Distributors" completed with 20 invented company
// names, warehouse sizes and fit scores. The generic worker has no web or
// research access, so any task that needs real-world facts and is answered
// without a capability dispatch is, by construction, unverifiable. The rule
// here is structural (task wording + whether a capability was used), not a
// prompt instruction the model can ignore.

export const NO_DATA_SOURCE = "no_data_source";
export const NO_DATA_SOURCE_DISPOSITION = "NO_DATA_SOURCE";

// A task needs external facts when it asks to find/research/assess real-world
// entities or market figures. Both a verb AND a subject must match, so
// internal work (drafting, logging to fleet_memory, audits, vault searches,
// connection checks) is not caught.
const EXTERNAL_FACT_VERBS =
  /\b(identify|find|list|shortlist|short-list|research|source|discover|locate|compile|gather|collect|scrape|enumerate|look\s*up|assess|evaluate|analy[sz]e|compare|rank|vet|profile)\b/i;
const EXTERNAL_FACT_SUBJECTS =
  /\b(distributors?|dealers?|suppliers?|vendors?|wholesalers?|retailers?|manufacturers?|companies|businesses|firms|contacts?|prospects?|competitors?|customers?|market\s+(size|share|data|figures|trends)|competitive\s+landscape|prices|pricing|phone\s+numbers?|email\s+addresses|addresses)\b/i;

export function requiresExternalFacts(task: { title?: unknown; description?: unknown }): boolean {
  const text = `${typeof task.title === "string" ? task.title : ""}\n${typeof task.description === "string" ? task.description : ""}`;
  return EXTERNAL_FACT_VERBS.test(text) && EXTERNAL_FACT_SUBJECTS.test(text);
}

export type WorkerGrounding = { ok: true } | { ok: false; reason: string };

// Worker-side check, applied to a work_engine_task result BEFORE it may be
// stored as completed. A capability request is allowed through: the real
// dispatch that follows produces measured evidence (or a measured failure).
export function checkWorkerGrounding(
  task: { title?: unknown; description?: unknown },
  result: unknown,
): WorkerGrounding {
  const obj = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  if (obj && typeof obj.capability === "string" && obj.capability.length > 0) return { ok: true };
  if (obj && obj.status === NO_DATA_SOURCE) {
    const reason = typeof obj.reason === "string" && obj.reason ? obj.reason : "worker reported no data source for this task";
    return { ok: false, reason };
  }
  if (requiresExternalFacts(task)) {
    return {
      ok: false,
      reason: "task requires real-world facts, but no research or data capability was used, so any names, figures or contacts in the answer could not be verified",
    };
  }
  return { ok: true };
}

// The only content stored for a no_data_source outcome: the explanation, never
// the model's unverified answer.
export function buildNoDataSourceResult(reason: string, jobId?: string): Record<string, unknown> {
  return { status: NO_DATA_SOURCE, reason, ...(jobId ? { job_id: jobId } : {}) };
}

export type TaskVerdict = "verified" | "no_data_source" | "failed" | "incomplete";

export interface TaskEvidenceRecord {
  id?: unknown;
  title?: unknown;
  description?: unknown;
  status?: unknown;
  output?: unknown;
}

const ACTIVE_TASK_STATUSES = new Set(["pending", "assigned", "running", "working"]);
const SUCCESS_TASK_STATUSES = new Set(["done", "approved"]);

function parseOutput(output: unknown): Record<string, unknown> | null {
  if (typeof output !== "string" || output.trim().length === 0) return null;
  try {
    const parsed = JSON.parse(output);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

// Classifies one task from what is actually recorded on it. A task counts as
// verified only with a terminal success status AND usable output; a task that
// needs external facts additionally needs a successful capability dispatch,
// so an answer stored before this rule existed cannot count just because it
// is in the database.
export function assessTaskEvidence(task: TaskEvidenceRecord): { verdict: TaskVerdict; reason: string } {
  const status = String(task.status ?? "");
  const output = parseOutput(task.output);
  if (ACTIVE_TASK_STATUSES.has(status)) return { verdict: "incomplete", reason: `task still ${status}` };
  if (output?.status === NO_DATA_SOURCE) {
    return { verdict: "no_data_source", reason: String(output.reason ?? "no data source available") };
  }
  if (!SUCCESS_TASK_STATUSES.has(status)) return { verdict: "failed", reason: `task ended in status '${status}'` };
  const dispatch = output?.companyOsDispatch;
  if (dispatch && typeof dispatch === "object") {
    const d = dispatch as Record<string, unknown>;
    if (d.status !== "success") {
      return { verdict: "failed", reason: `capability ${String(d.capability ?? "unknown")} dispatch ${String(d.status ?? "unknown")}${d.error ? `: ${String(d.error).slice(0, 200)}` : ""}` };
    }
    if (d.capability === KNOWLEDGE_SEARCH) return assessKnowledgeSearch(task, d);
    return { verdict: "verified", reason: `capability ${String(d.capability ?? "unknown")} succeeded` };
  }
  // Checked before the missing-output case: returnCompletedWork() truncates
  // output to 5000 chars, so a long fabricated answer is stored as invalid
  // JSON. With no readable capability evidence it is still ungrounded.
  if (requiresExternalFacts(task)) {
    return { verdict: "no_data_source", reason: "recorded output needs real-world facts but has no capability evidence behind it" };
  }
  if (!output) return { verdict: "failed", reason: "task has no recorded output to verify" };
  return { verdict: "verified", reason: "internal task completed with recorded output" };
}

// ── knowledge.search evidence ────────────────────────────────────────────
// vault-engine's match_knowledge_chunks has no similarity cutoff: it returns
// the nearest chunks whatever they are. With one document in the vault, a
// search for "Indian paint distributors" "succeeds" with that document.
// So a successful dispatch alone is not evidence for a factual task: it
// needs at least one sourced match (document_id) at or above this cosine
// similarity (gte-small, normalized). Below it the vault simply holds no
// source for the question.
export const KNOWLEDGE_SEARCH = "knowledge.search";
export const KNOWLEDGE_MATCH_MIN_SIMILARITY = 0.8;

export interface KnowledgeMatchEvidence {
  chunk_id: string | null;
  document_id: string;
  similarity: number;
  excerpt: string;
}

// Reads matches from either the compact stored form (evidence.matches) or a
// raw vault-engine response (data.matches); drops any match without a
// document_id, since it cannot be traced to a source.
export function knowledgeMatches(dispatch: Record<string, unknown>): KnowledgeMatchEvidence[] {
  const evidence = dispatch.evidence as Record<string, unknown> | undefined;
  const data = dispatch.data as Record<string, unknown> | undefined;
  const raw = Array.isArray(evidence?.matches) ? evidence!.matches as unknown[] : Array.isArray(data?.matches) ? data!.matches as unknown[] : [];
  const out: KnowledgeMatchEvidence[] = [];
  for (const m of raw) {
    if (!m || typeof m !== "object") continue;
    const r = m as Record<string, unknown>;
    const documentId = typeof r.document_id === "string" ? r.document_id : "";
    const similarity = Number(r.similarity);
    if (!documentId || !Number.isFinite(similarity)) continue;
    out.push({
      chunk_id: typeof r.chunk_id === "string" ? r.chunk_id : typeof r.id === "string" ? r.id : null,
      document_id: documentId,
      similarity: Math.round(similarity * 1000) / 1000,
      excerpt: String(r.excerpt ?? r.chunk_text ?? "").slice(0, 240),
    });
  }
  return out;
}

function assessKnowledgeSearch(task: TaskEvidenceRecord, dispatch: Record<string, unknown>): { verdict: TaskVerdict; reason: string } {
  const matches = knowledgeMatches(dispatch);
  const best = matches.reduce((max, m) => Math.max(max, m.similarity), 0);
  if (!requiresExternalFacts(task)) {
    return { verdict: "verified", reason: `capability knowledge.search succeeded: ${matches.length} sourced match(es)` };
  }
  const relevant = matches.filter((m) => m.similarity >= KNOWLEDGE_MATCH_MIN_SIMILARITY);
  if (relevant.length === 0) {
    return {
      verdict: NO_DATA_SOURCE,
      reason: matches.length === 0
        ? "knowledge.search returned no sourced documents for this question"
        : `knowledge.search found no relevant document (best similarity ${best.toFixed(3)}, below ${KNOWLEDGE_MATCH_MIN_SIMILARITY}); the knowledge vault holds no verified source for this`,
    };
  }
  const docs = [...new Set(relevant.map((m) => m.document_id))];
  return { verdict: "verified", reason: `knowledge.search: ${relevant.length} relevant match(es) from document(s) ${docs.join(", ")}, best similarity ${best.toFixed(3)}` };
}

// What returnCompletedWork() stores for a dispatch. The task output column
// is cut at 5000 characters, which turned full vault responses into invalid
// JSON and lost the evidence. This keeps the verifiable metadata (source ids,
// similarity, a short excerpt) and drops the bulk.
export function compactDispatchForStorage(dispatch: unknown): Record<string, unknown> {
  if (!dispatch || typeof dispatch !== "object") return { status: "unknown" };
  const d = dispatch as Record<string, unknown>;
  const base: Record<string, unknown> = { capability: d.capability, status: d.status, attempts: d.attempts };
  if (d.error) base.error = String(d.error).slice(0, 500);
  if (d.capability === KNOWLEDGE_SEARCH && d.status === "success") {
    const data = d.data as Record<string, unknown> | undefined;
    base.evidence = { query: typeof data?.query === "string" ? data.query.slice(0, 300) : null, matches: knowledgeMatches(d).slice(0, 5) };
    return base;
  }
  if (d.data !== undefined) base.data_excerpt = JSON.stringify(d.data).slice(0, 1500);
  return base;
}

// The objective's current task set is its latest planning pass (projects
// arrive newest-first). A re-run adds a new pass, so earlier blocked tasks
// stay in history without deciding the new attempt.
export function assessCurrentTaskSet(
  projects: Array<{ id?: unknown }>,
  tasks: Array<TaskEvidenceRecord & { project_id?: unknown }>,
): ObjectiveTaskGate {
  const latestProjectId = projects[0]?.id;
  const current = latestProjectId === undefined ? tasks : tasks.filter((t) => t.project_id === latestProjectId);
  return assessObjectiveTasks(current);
}

export interface ObjectiveTaskGate {
  allVerified: boolean;
  blocked: boolean;
  reason: string;
  tasks: Array<{ id: string; title: string; verdict: TaskVerdict; reason: string }>;
}

// Objective-level gate over the objective's current task set. An objective may
// only be achieved when there is at least one task and every task is verified.
// Any no_data_source task blocks it (a human must supply a data source or
// approve a research capability); replanning cannot fix that.
export function assessObjectiveTasks(tasks: TaskEvidenceRecord[]): ObjectiveTaskGate {
  const assessed = tasks.map((t) => {
    const { verdict, reason } = assessTaskEvidence(t);
    return { id: String(t.id ?? "unknown"), title: String(t.title ?? ""), verdict, reason };
  });
  const noData = assessed.filter((t) => t.verdict === "no_data_source");
  const notVerified = assessed.filter((t) => t.verdict !== "verified");
  const allVerified = assessed.length > 0 && notVerified.length === 0;
  const describe = (list: typeof assessed) => list.map((t) => `"${t.title}" (${t.verdict}: ${t.reason})`).join("; ");
  if (assessed.length === 0) return { allVerified: false, blocked: false, reason: "objective has no tasks yet", tasks: assessed };
  if (noData.length > 0) {
    return {
      allVerified: false,
      blocked: true,
      reason: `${NO_DATA_SOURCE}: ${noData.length} of ${assessed.length} task(s) need real-world data that no available capability can provide: ${describe(noData)}`,
      tasks: assessed,
    };
  }
  return {
    allVerified,
    blocked: false,
    reason: allVerified ? `all ${assessed.length} task(s) have verified evidence` : `${notVerified.length} of ${assessed.length} task(s) lack verified evidence: ${describe(notVerified)}`,
    tasks: assessed,
  };
}

// The founder-facing text stored in orchestrator_requests.result_summary when
// the gate blocks an objective. It names the blocked tasks and why, and never
// quotes any task output, so a rejected answer cannot reach the founder.
export const BLOCKED_SUMMARY_PREFIX = "BLOCKED:";
export const BLOCKED_NEXT_ACTION = "Connect or enable a verified research capability, then re-run the objective.";

export function formatBlockedSummary(gate: ObjectiveTaskGate): string {
  const noData = gate.tasks.filter((t) => t.verdict === NO_DATA_SOURCE);
  const others = gate.tasks.filter((t) => t.verdict === "failed");
  const lines = [
    `${BLOCKED_SUMMARY_PREFIX} FKAIOS could not complete this objective because the required external research could not be verified with the currently available capabilities.`,
    `REASON: ${noData.map((t) => `"${t.title}" needs real-world data but no verified research source was available, so its output was rejected as ungrounded`).join("; ")}.` +
      (others.length > 0 ? ` Also failed: ${others.map((t) => `"${t.title}" (${t.reason})`).join("; ")}.` : ""),
    `NEXT ACTION: ${BLOCKED_NEXT_ACTION}`,
  ];
  return lines.join("\n");
}
