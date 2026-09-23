// Founder-facing progress for one objective, derived only from real rows
// (its latest orchestration project's tasks and their ai_jobs). Pure, so the
// founder-objective status action and its tests share one implementation.
//
// Task output is deliberately never passed through: an unverified or
// rejected answer (e.g. the invented distributor list of 2026-09-23) must
// not reach the Command Center. Only titles, statuses and verdicts do.
import { assessTaskEvidence, type TaskEvidenceRecord, type TaskVerdict } from "./fact-grounding.ts";

export interface ProgressJob {
  status?: unknown;
  retry_count?: unknown;
  payload?: unknown;
}

export interface ObjectiveProgress {
  planningPasses: number;
  tasksTotal: number;
  tasksVerified: number;
  tasksActive: number;
  tasksNoDataSource: number;
  tasksFailed: number;
  jobsRetrying: number;
  jobsRunning: number;
  tasks: Array<{ title: string; status: string; verdict: TaskVerdict }>;
}

export function summarizeObjectiveProgress(
  planningPasses: number,
  tasks: TaskEvidenceRecord[],
  jobs: ProgressJob[],
): ObjectiveProgress {
  const assessed = tasks.map((t) => ({
    title: String(t.title ?? ""),
    status: String(t.status ?? ""),
    verdict: assessTaskEvidence(t).verdict,
  }));
  const liveJobs = jobs.filter((j) => j.status === "pending" || j.status === "running" || j.status === "retry");
  return {
    planningPasses,
    tasksTotal: assessed.length,
    tasksVerified: assessed.filter((t) => t.verdict === "verified").length,
    tasksActive: assessed.filter((t) => t.verdict === "incomplete").length,
    tasksNoDataSource: assessed.filter((t) => t.verdict === "no_data_source").length,
    tasksFailed: assessed.filter((t) => t.verdict === "failed").length,
    jobsRetrying: liveJobs.filter((j) => Number(j.retry_count ?? 0) > 0).length,
    jobsRunning: liveJobs.filter((j) => j.status === "running").length,
    tasks: assessed,
  };
}
