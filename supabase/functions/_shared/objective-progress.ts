// Founder-facing progress for one objective, derived only from real rows
// (its latest orchestration project's tasks and their ai_jobs). Pure, so the
// founder-objective status action and its tests share one implementation.
//
// Task output is deliberately exposed only when the task itself is verified.
// This gives the Founder a real result viewer without allowing an unverified
// or rejected answer to reach the Command Center.
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
  tasks: Array<{ title: string; status: string; verdict: TaskVerdict; reason: string; output?: string }>;
}

function verifiedOutput(output: unknown): string | undefined {
  if (typeof output !== "string" || output.trim().length === 0) return undefined;
  try {
    const parsed = JSON.parse(output);
    // Keep the full verified deliverable reasonably bounded for the console.
    // The worker already stores bounded output; this is an additional UI guard.
    return JSON.stringify(parsed, null, 2).slice(0, 20000);
  } catch {
    return output.slice(0, 20000);
  }
}

export function summarizeObjectiveProgress(
  planningPasses: number,
  tasks: TaskEvidenceRecord[],
  jobs: ProgressJob[],
): ObjectiveProgress {
  // The verdict reason describes the evidence (e.g. "capability
  // knowledge.search succeeded", a dispatch error). For verified tasks the
  // actual recorded output is also returned so the Founder can inspect the
  // deliverable that caused completion.
  const assessed = tasks.map((t) => {
    const { verdict, reason } = assessTaskEvidence(t);
    return {
      title: String(t.title ?? ""),
      status: String(t.status ?? ""),
      verdict,
      reason: reason.slice(0, 300),
      ...(verdict === "verified" ? { output: verifiedOutput(t.output) } : {}),
    };
  });
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
