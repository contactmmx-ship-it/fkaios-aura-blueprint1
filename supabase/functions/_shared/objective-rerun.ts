// Founder-requested re-run of an objective that stopped (BLOCKED or FAILED),
// using existing orchestrator_requests fields only.
//
// founder-objective's `rerun` action sets status='processing' and
// action_taken=RERUN_REQUESTED. On its next run the objective loop sees the
// flag, creates a new planning pass (a new orchestration_projects row) and
// clears the flag; from then on the objective is judged on that new task set.
// Earlier projects and tasks are left untouched as history.
//
// Pure and import-free so both edge functions share it and it is unit-tested.

export const RERUN_REQUESTED = "rerun_requested";
export const OBJECTIVE_LOOP = "objective_loop";

// Marks an objective submitted from the Command Center. requested_by stays
// 'founder-brain' (that is what the objective loop picks up); classification
// is otherwise unused for these rows.
export const FOUNDER_OBJECTIVE_CLASSIFICATION = "founder_objective";

export interface ObjectiveLifecycleRow {
  status?: unknown;
  action_taken?: unknown;
}

// BLOCKED (the loop parked it in awaiting_approval) or FAILED can be re-run.
// A high-risk objective awaiting approval cannot: that needs an approval
// transition, which does not exist yet.
export function canRerun(row: ObjectiveLifecycleRow): boolean {
  if (row.status === "failed") return true;
  return row.status === "awaiting_approval" && row.action_taken === OBJECTIVE_LOOP;
}

export function isRerunRequested(row: ObjectiveLifecycleRow): boolean {
  return row.status === "processing" && row.action_taken === RERUN_REQUESTED;
}

export function rerunUpdate(requestedAt: string): { status: string; action_taken: string; result_summary: string } {
  return {
    status: "processing",
    action_taken: RERUN_REQUESTED,
    result_summary: `Re-run requested at ${requestedAt}. The objective loop will plan it again on its next run.`,
  };
}

// orchestration_projects.status check constraint. Objective and project
// statuses are different vocabularies: copying the objective status onto the
// project ('completed', 'awaiting_approval') violates this constraint.
export const PROJECT_STATUSES = ["planning", "working", "reviewing", "reworking", "merging", "complete", "failed"] as const;

export type ObjectiveDecision = "completed" | "failed" | "awaiting_approval";

// The project projection of an objective decision. A completed objective
// completes its project with the deliverable (or, failing that, the summary)
// as final_output; a failed one fails
// it. A blocked objective (awaiting_approval) is not finished and can be
// re-run, so the project keeps its current non-terminal status and only
// records the blocker.
export function projectUpdateForObjective(status: ObjectiveDecision, summary: string, deliverable?: string): Record<string, unknown> {
  if (status === "completed") {
    return { status: "complete", final_output: deliverable || summary, draft_final_output: null, error_message: null };
  }
  if (status === "failed") return { status: "failed", error_message: summary };
  return { error_message: summary };
}

export const MAX_DELIVERABLE_CHARS = 60000;

export interface DeliverableTask {
  title?: unknown;
  status?: unknown;
  output?: unknown;
  created_at?: unknown;
}

// Pull the human-readable part out of a persisted task output. Worker results
// are JSON envelopes; when one carries an explicit deliverable, that is the
// work product. Otherwise the output is kept as written (pretty-printed when
// it is JSON) so nothing the worker produced is hidden or reworded.
// 28 Oct 2026: a JSON work product is rendered as readable Markdown (headings, bullets, named sources)
// instead of being dumped as raw JSON. The founder reads this, and the independent verifier quotes from it;
// raw JSON made reports fail "one-page brief" criteria and broke verbatim quote matching. Content is
// rendered 1:1 — nothing is generated or dropped except internal plumbing keys.
const INTERNAL_KEYS = new Set(["prior_evidence", "capability", "capability_result", "capability_attempts", "payload", "companyOsDispatch", "status", "retryable", "kernel_disposition", "job_id"]);
function humanizeKey(key: string): string {
  const k = key.replace(/^section_?\d+_?/i, "").replace(/[_-]+/g, " ").trim() || key;
  return k.charAt(0).toUpperCase() + k.slice(1);
}
function renderSources(list: unknown): string {
  if (!Array.isArray(list) || !list.length) return "";
  const lines = list.flatMap((s) => {
    if (typeof s === "string") return [`- ${s}`];
    if (!s || typeof s !== "object") return [];
    const r = s as Record<string, unknown>;
    const title = typeof r.title === "string" ? r.title : typeof r.source_title === "string" ? r.source_title : "";
    const url = typeof r.url === "string" ? r.url : typeof r.source_url === "string" ? r.source_url : "";
    return title || url ? [`- ${title}${title && url ? " — " : ""}${url}`] : [];
  });
  return lines.length ? `Sources:\n${lines.join("\n")}` : "";
}
function renderValue(value: unknown, depth: number): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) {
    return value.map((item) => {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        const parts = Object.entries(item as Record<string, unknown>)
          .filter(([k, v]) => !INTERNAL_KEYS.has(k) && v !== null && v !== undefined && v !== "")
          .map(([k, v]) => `${humanizeKey(k)}: ${typeof v === "object" ? renderValue(v, depth + 1).replace(/\n+/g, "; ") : String(v)}`);
        return `- ${parts.join(" | ")}`;
      }
      return `- ${renderValue(item, depth + 1)}`;
    }).join("\n");
  }
  if (typeof value === "object") {
    const heading = "#".repeat(Math.min(depth + 2, 5));
    return Object.entries(value as Record<string, unknown>)
      .filter(([k, v]) => !INTERNAL_KEYS.has(k) && v !== null && v !== undefined && v !== "")
      .map(([k, v]) => k === "sources" ? renderSources(v) : `${heading} ${humanizeKey(k)}\n\n${renderValue(v, depth + 1)}`)
      .filter((part) => part.trim())
      .join("\n\n");
  }
  return String(value);
}
export function taskWorkProduct(output: string): string {
  const trimmed = output.trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      let obj = parsed as Record<string, unknown>;
      if (obj.llmResult && typeof obj.llmResult === "object" && !Array.isArray(obj.llmResult)) obj = obj.llmResult as Record<string, unknown>;
      const product = obj.deliverable ?? obj.content ?? obj.result ?? obj.brief ?? obj.final_report ?? obj.report;
      const sources = renderSources(obj.sources);
      if (typeof product === "string" && product.trim()) return sources && !product.includes("Sources:") ? `${product.trim()}\n\n${sources}` : product.trim();
      if (product && typeof product === "object") return [renderValue(product, 0), sources].filter(Boolean).join("\n\n");
      return renderValue(obj, 0) || JSON.stringify(parsed, null, 2);
    }
    if (Array.isArray(parsed)) return renderValue(parsed, 0);
  } catch {
    // not JSON: plain text output
  }
  return trimmed;
}

// The final_output of a completed objective: the verdict followed by every
// completed task's actual work product, in execution order. Built only from
// persisted task outputs, never generated, so it is exactly what was verified.
export function buildObjectiveDeliverable(summary: string, tasks: DeliverableTask[]): string {
  const done = tasks
    .filter((t) => typeof t.output === "string" && String(t.output).trim() &&
      ["completed", "done", "verified"].includes(String(t.status ?? "").toLowerCase()))
    .sort((a, b) => String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")));
  if (!done.length) return summary;
  const sections = done.map((t, i) => `## ${i + 1}. ${String(t.title ?? "Task").trim()}\n\n${taskWorkProduct(String(t.output))}`);
  const text = `# Result\n\n${summary.trim()}\n\n${sections.join("\n\n")}\n`;
  return text.length > MAX_DELIVERABLE_CHARS
    ? `${text.slice(0, MAX_DELIVERABLE_CHARS)}\n\n…(truncated at ${MAX_DELIVERABLE_CHARS} characters; full task outputs remain in orchestration_tasks)\n`
    : text;
}

/**
 * The deliverable as it stands now. Once a rectification task has produced a
 * corrected deliverable, that corrected version IS the result (the rejected
 * draft must not be presented alongside it); otherwise every completed task's
 * work product, in order.
 */
export function buildCurrentDeliverable(summary: string, tasks: DeliverableTask[]): string {
  const rectified = tasks
    .filter((t) => /^Rectify:/i.test(String(t.title ?? "")) && typeof t.output === "string" && String(t.output).trim() &&
      ["completed", "done", "verified", "approved"].includes(String(t.status ?? "").toLowerCase()))
    .sort((a, b) => String(b.created_at ?? "").localeCompare(String(a.created_at ?? "")));
  if (!rectified.length) return buildObjectiveDeliverable(summary, tasks);
  const text = `# Result\n\n${summary.trim() ? summary.trim() + "\n\n" : ""}${taskWorkProduct(String(rectified[0].output))}\n`;
  return text.length > MAX_DELIVERABLE_CHARS ? text.slice(0, MAX_DELIVERABLE_CHARS) : text;
}
