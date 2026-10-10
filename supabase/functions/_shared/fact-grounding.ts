// Fact grounding + objective evidence rules, shared by ai-engine (worker side)
// LIVE AUDIT NOTE: factual synthesis must remain source-grounded.
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
// entities, market figures, or a business's sales/revenue/turnover performance
// (actual business numbers the worker cannot know without a data source).
// Both a verb AND a subject must match, so internal work (drafting, logging
// to fleet_memory, audits, vault searches, connection checks) is not caught.
const EXTERNAL_FACT_VERBS =
  /\b(identify|find|list|shortlist|short-list|research|source|discover|locate|compile|assemble|combine|consolidate|synthesi[sz]e|gather|collect|scrape|enumerate|look\s*up|assess|evaluate|analy[sz]e|compare|rank|vet|profile)\b/i;
const EXTERNAL_FACT_SUBJECTS =
  /\b(distributors?|dealers?|suppliers?|vendors?|wholesalers?|retailers?|manufacturers?|companies|businesses|firms|contacts?|prospects?|competitors?|customers?|prospect\s+observations?|business\s+signals?|system\s+readiness|current\s+(status|performance|state|figures?|metrics?)|operational\s+(status|performance|metrics?|figures?|readiness)|franchise\s+(expansion|locations?|outlets?)|market\s+(size|share|data|figures|trends)|competitive\s+landscape|prices|pricing|sales|revenues?|turnover|phone\s+numbers?|email\s+addresses|addresses)\b/i;

export function requiresExternalFacts(task: { title?: unknown; description?: unknown }): boolean {
  // A rectification task only revises a deliverable built from evidence that
  // prior tasks already recorded; the independent verifier rejects anything
  // it adds without support.
  if (typeof task.title === "string" && /^Rectify:/i.test(task.title)) return false;
  const text = `${typeof task.title === "string" ? task.title : ""}\n${typeof task.description === "string" ? task.description : ""}`;
  return EXTERNAL_FACT_VERBS.test(text) && EXTERNAL_FACT_SUBJECTS.test(text);
}

// Worker-side decision, made BEFORE the model is asked to answer: should the
// worker acquire external evidence (research.run) first? It must be true for
// every task checkWorkerGrounding() would reject as needing external facts —
// otherwise the worker answers without research and the answer is then
// rejected as ungrounded. That is exactly what blocked Kids DPS 20cbf892 on
// 9 Oct 13:30 UTC: "90-Day Action Plan, KPIs, Dependencies, and Missing
// Information List" matched this module's rule ("list" + "competitors") but
// not ai-engine's own word list ("competitor" singular, no "list"), so no
// research ran and the task was failed no_data_source.
const RESEARCH_WORDS = /\b(research|market|facts?|sources?|verify|distributors?|competitors?|industry|trends?|data collection)\b/i;

export function needsResearchBeforeAnswer(task: { title?: unknown; description?: unknown }): boolean {
  if (typeof task.title === "string" && /^Rectify:/i.test(task.title)) return false;
  const text = `${typeof task.title === "string" ? task.title : ""}\n${typeof task.description === "string" ? task.description : ""}`;
  return RESEARCH_WORDS.test(text) || requiresExternalFacts(task);
}

export interface PriorEvidenceSummary { verified: boolean; source_count: number; sources: Array<{ url: string; title: string }>; }
function parsePriorTaskOutput(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try { const parsed = JSON.parse(value); return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null; }
    catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function parsePriorCompletedTasks(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") { try { const parsed = JSON.parse(value); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
  return [];
}
export function summarizePriorEvidence(value: unknown): PriorEvidenceSummary {
  const unique = new Map<string, { url: string; title: string }>();
  for (const task of parsePriorCompletedTasks(value)) {
    const row = parsePriorTaskOutput(task); if (!row) continue;
    const output = parsePriorTaskOutput(row.output) ?? (row.output && typeof row.output === "object" ? row.output as Record<string, unknown> : null);
    if (!output) continue;
    const dispatch = output.companyOsDispatch && typeof output.companyOsDispatch === "object" ? output.companyOsDispatch as Record<string, unknown> : null;
    const llm = output.llmResult && typeof output.llmResult === "object" ? output.llmResult as Record<string, unknown> : null;
    if (dispatch?.status !== "success" || dispatch.capability !== "research.run" || !llm) continue;
    const excerpt = typeof dispatch.data_excerpt === "string" ? parsePriorTaskOutput(dispatch.data_excerpt) : null;
    if (!excerpt) continue;
    const queries = Array.isArray(excerpt.queries) ? excerpt.queries : [excerpt];
    const grounded = new Map<string, string>();
    for (const query of queries) {
      if (!query || typeof query !== "object") continue;
      const queryRow = query as Record<string, unknown>;
      for (const result of Array.isArray(queryRow.results) ? queryRow.results : []) {
        if (!result || typeof result !== "object") continue;
        for (const item of Array.isArray((result as Record<string, unknown>).sources) ? (result as Record<string, unknown>).sources as unknown[] : []) {
          if (!item || typeof item !== "object") continue;
          const source = item as Record<string, unknown>;
          if (typeof source.url === "string" && (source.url.startsWith("https://") || source.url.startsWith("http://"))) grounded.set(source.url, typeof source.title === "string" ? source.title : source.url);
        }
      }
    }
    for (const item of Array.isArray(llm.sources) ? llm.sources : []) {
      if (!item || typeof item !== "object") continue;
      const source = item as Record<string, unknown>;
      if (typeof source.url !== "string" || !grounded.has(source.url)) continue;
      unique.set(source.url, { url: source.url, title: typeof source.title === "string" ? source.title : grounded.get(source.url)! });
    }
  }
  const sources = [...unique.values()];
  return { verified: sources.length > 0, source_count: sources.length, sources };
}

function priorEvidenceSupportsResult(result: Record<string, unknown>): boolean {
  const prior = result.prior_evidence && typeof result.prior_evidence === "object" ? result.prior_evidence as Record<string, unknown> : null;
  if (prior?.verified !== true || Number(prior.source_count) < 1 || !Array.isArray(prior.sources)) return false;
  const allowed = new Set(prior.sources.flatMap((source) => source && typeof source === "object" && typeof (source as Record<string, unknown>).url === "string" ? [(source as Record<string, unknown>).url as string] : []));
  const cited = Array.isArray(result.sources) ? result.sources : [];
  return cited.length > 0 && cited.every((source) => source && typeof source === "object" && typeof (source as Record<string, unknown>).url === "string" && allowed.has((source as Record<string, unknown>).url as string));
}
// Cited URLs not in the server-attached prior_evidence (empty when there is
// no prior_evidence, i.e. nothing to compare against).
function citationsOutsidePriorEvidence(result: Record<string, unknown>): string[] {
  const prior = result.prior_evidence && typeof result.prior_evidence === "object" ? result.prior_evidence as Record<string, unknown> : null;
  if (!prior || !Array.isArray(prior.sources)) return [];
  const allowed = new Set(prior.sources.flatMap((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>).url === "string" ? [normalizeUrl((s as Record<string, unknown>).url as string)] : []));
  return citedSourceUrls(result).filter((url) => !allowed.has(url));
}

export type WorkerGrounding = { ok: true } | { ok: false; reason: string };

// Worker-side check, applied to a work_engine_task result BEFORE it may be
// stored as completed. It runs on the FINAL result, after any requested
// capability was dispatched, so a capability counts only with its measured
// result (capability_result / capability_attempts). A report carrying the
// server-attached prior_evidence must cite only sources in it.
export function checkWorkerGrounding(
  task: { title?: unknown; description?: unknown },
  result: unknown,
): WorkerGrounding {
  const obj = result && typeof result === "object" && !Array.isArray(result) ? result as Record<string, unknown> : null;
  if (obj && typeof obj.capability === "string" && obj.capability.length > 0 && ("capability_result" in obj || "capability_attempts" in obj)) return { ok: true };
  const outside = obj ? citationsOutsidePriorEvidence(obj) : [];
  if (outside.length > 0) {
    return { ok: false, reason: `cites source(s) that no prior research task fetched: ${outside.slice(0, 3).join(", ")}` };
  }
  if (obj && priorEvidenceSupportsResult(obj)) return { ok: true };
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
// Source URLs that research.run dispatches recorded on these tasks actually
// fetched (the compact data_excerpt stored by compactDispatchForStorage). Built
// from tool results only — never from model-written fields — so a synthesis
// task can be checked against what the objective really retrieved.
export function researchedSourceUrls(tasks: TaskEvidenceRecord[]): Set<string> {
  const urls = new Set<string>();
  for (const task of tasks) {
    if (!SUCCESS_TASK_STATUSES.has(String(task.status ?? ""))) continue;
    const output = parseOutput(task.output);
    const d = output?.companyOsDispatch && typeof output.companyOsDispatch === "object" ? output.companyOsDispatch as Record<string, unknown> : null;
    if (!d || d.status !== "success" || d.capability !== "research.run" || typeof d.data_excerpt !== "string") continue;
    let excerpt: Record<string, unknown> | null = null;
    try { excerpt = JSON.parse(d.data_excerpt); } catch { continue; }
    const queries = Array.isArray(excerpt?.queries) ? excerpt!.queries as unknown[] : [excerpt];
    for (const q of queries) {
      const results = q && typeof q === "object" && Array.isArray((q as Record<string, unknown>).results) ? (q as Record<string, unknown>).results as unknown[] : [];
      for (const r of results) {
        const sources = r && typeof r === "object" && Array.isArray((r as Record<string, unknown>).sources) ? (r as Record<string, unknown>).sources as unknown[] : [];
        for (const src of sources) {
          const url = src && typeof src === "object" ? (src as Record<string, unknown>).url : null;
          if (typeof url === "string" && /^https?:\/\//.test(url)) urls.add(normalizeUrl(url));
        }
      }
    }
  }
  return urls;
}

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "");
}

// URLs a task's output cites, from its top-level `sources` (synthesis/report
// tasks) or llmResult.sources (worker envelopes).
function citedSourceUrls(output: Record<string, unknown> | null): string[] {
  if (!output) return [];
  const llm = output.llmResult && typeof output.llmResult === "object" ? output.llmResult as Record<string, unknown> : null;
  const list = Array.isArray(output.sources) ? output.sources : Array.isArray(llm?.sources) ? llm!.sources as unknown[] : [];
  return list.flatMap((s) => s && typeof s === "object" && typeof (s as Record<string, unknown>).url === "string" ? [normalizeUrl((s as Record<string, unknown>).url as string)] : []);
}

// `researched` is the set of URLs the objective's research tasks fetched
// (researchedSourceUrls over the same task set). A task without its own
// capability dispatch is verified when it cites at least one source and every
// cited source is in that set — e.g. the final report that synthesises the
// research. Kids DPS 20cbf892 (9 Oct 17:26 UTC): the report cited 3 sources,
// all fetched by the research tasks, but sat at the top level of the output
// where only llmResult was checked, and was blocked as no_data_source.
export function assessTaskEvidence(task: TaskEvidenceRecord, researched?: Set<string>): { verdict: TaskVerdict; reason: string } {
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
  if (researched && researched.size > 0) {
    const cited = citedSourceUrls(output);
    if (cited.length > 0 && cited.every((url) => researched.has(url))) {
      return { verdict: "verified", reason: `cites ${cited.length} source(s), all fetched by this objective's research tasks` };
    }
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
  if (d.capability === "research.run" && d.data && typeof d.data === "object") {
    const data = d.data as Record<string, unknown>;
    const queries = (Array.isArray(data.queries) ? data.queries : [data]).slice(0, 3);
    const compactQueries = queries.slice(0, 6).map((query) => {
      const q = query && typeof query === "object" ? query as Record<string, unknown> : {};
      const results = (Array.isArray(q.results) ? q.results : []).slice(0, 2).map((result) => {
        const r = result && typeof result === "object" ? result as Record<string, unknown> : {};
        const sources = (Array.isArray(r.sources) ? r.sources : []).slice(0, 8).map((source) => {
          const src = source && typeof source === "object" ? source as Record<string, unknown> : {};
          return { url: src.url ?? null, title: src.title ?? null, date: src.date ?? null };
        });
        return { query: r.query ?? null, sources };
      });
      return { query: q.query ?? null, results };
    });
    base.data_excerpt = JSON.stringify({ queries: compactQueries });
  } else if (d.data !== undefined) {
    base.data_excerpt = JSON.stringify(d.data).slice(0, 1500);
  }
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
  const researched = researchedSourceUrls(tasks);
  const assessed = tasks.map((t) => {
    const { verdict, reason } = assessTaskEvidence(t, researched);
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
