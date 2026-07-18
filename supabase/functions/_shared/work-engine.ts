// ============================================================================
// WORK ENGINE — SPRINT 9 (M1-S9)
// ============================================================================
// SPRINT 10 (M1-S10) ADDENDUM — Execution Engine audit: the real execution
// runtime already exists (ai-engine's runPendingJobs/executeJob — generic,
// agent.prompt-driven, handles ANY ai_jobs row regardless of type). REUSE,
// not rebuilt. But the audit also found cron 27 ('ai-engine-run-jobs-5min',
// the thing that actually calls runPendingJobs on a schedule) was disabled
// 2026-07-13 after a fabrication incident, and this ZIP's migrations don't
// confirm it was re-enabled after the fix. See
// ../DIAGNOSTIC_execution_pipeline_check.sql — if that cron is still off,
// Work Engine is assigning tasks into a queue nobody drains. Also found
// reap_orphaned_ai_jobs() (a live SQL cron reaper) already handles stale-job
// detection generically — reassignStuckWork() below was corrected this
// sprint to stop duplicating that (see its own comment).
// Sits between Departments/AI Employees and the Executive Planner, per the
// founder's own diagram:
//   Founder Brain → Executive Planner → [Departments → AI Employees] →
//   Work Engine → Execution → back to Executive Planner
//
// TECHNOLOGY INTEGRATION AUDIT (searched the FKAIOS codebase itself first,
// per the founder's permanent rule — before writing anything):
//   - Work QUEUE          -> ai_jobs (already exists — status pending/
//     running/completed/failed, agent_id, payload jsonb, created_at/
//     updated_at, result). Already processed by ai-engine's runPendingJobs
//     and dispatched by agent-scheduler/job-scheduler. NOT a new queue.
//   - Task breakdown       -> orchestration_tasks (Executive Planner,
//     Sprint 6). NOT a new task table.
//   - Employee roster      -> ai_agents (AI Employees, Sprint 8) via
//     executive-planner.ts's getWorkforce(). NOT re-queried from scratch.
//   - Escalation/approvals -> approvals table (Sprint 6). NOT a new channel.
//   - Dispatch/scheduling  -> agent-scheduler + job-scheduler already run
//     jobs off the ai_jobs queue. This module does not replace them — it
//     fills the ONE gap Sprint 8 found and stated honestly: ai_jobs and
//     orchestration_tasks were both real but never linked. That link (via
//     ai_jobs.payload.task_id, a jsonb field already used for job-specific
//     data — no schema change) is this sprint's actual new work.
//   - "Select most suitable employee" — searched for existing skill/
//     workload/performance-based assignment logic (agent-scheduler,
//     job-scheduler, orchestrator, orchestrator-engine): none exists. Every
//     existing ai_jobs row is created already pointing at a specific
//     agent_id chosen by its caller's own hardcoded logic (e.g.
//     auto-agents-engine always uses the one 'lead-qualifier' agent). No
//     department-aware, workload-aware, performance-aware selection exists
//     anywhere in the codebase.
// DECISION: INTEGRATE + EXTEND. The queue/roster/dispatch infrastructure is
// reused as-is (>90% fit); the ONE genuinely missing piece — intelligent
// selection + the orchestration_tasks<->ai_jobs link + reassignment +
// velocity tracking — is built here, in its own file (not inside
// founder-brain.ts or executive-planner.ts) because it depends on BOTH and
// neither should import the other (avoids a circular dependency).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { founderMemory } from "./founder-brain.ts";
import { getWorkforce, type EmployeeSummary } from "./executive-planner.ts";
import { executeCapability } from "./company-os.ts";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

// ── Select the most suitable employee ───────────────────────────────
// Real scoring, not a fabricated pick: department match is required (an
// employee outside the target department is never selected over one
// inside it, even if their score is higher — availability and fit come
// before raw performance). Among department matches: fewer active jobs
// wins (workload), then higher success_rate wins (performance).
export function selectBestEmployee(workforce: EmployeeSummary[], departmentCode: string | null): EmployeeSummary | null {
  const pool = departmentCode
    ? workforce.filter((e) => (e.department ?? "").toUpperCase() === departmentCode.toUpperCase())
    : workforce;
  const candidates = (pool.length > 0 ? pool : workforce).filter((e) => e.isActive && e.status !== "error" && e.status !== "offline");
  if (candidates.length === 0) return null;

  return candidates.reduce((best, e) => {
    if (!best) return e;
    if (e.activeJobs !== best.activeJobs) return e.activeJobs < best.activeJobs ? e : best; // less busy wins
    const eRate = e.successRate ?? 0;
    const bRate = best.successRate ?? 0;
    return eRate > bRate ? e : best; // then higher performance wins
  }, null as EmployeeSummary | null);
}

// ── Allocate one orchestration_task to the best-fit employee ────────
export interface AllocationResult {
  taskId: string;
  jobId: string | null;
  agentId: string | null;
  agentName: string | null;
  error?: string;
}

export async function allocateTask(task: { id: string; title: string; description: string; departmentCode: string | null }): Promise<AllocationResult> {
  const client = getClient();
  const workforce = await getWorkforce();
  if (workforce.length === 0) return { taskId: task.id, jobId: null, agentId: null, agentName: null, error: "no active AI employees available" };

  const employee = selectBestEmployee(workforce, task.departmentCode);
  if (!employee) return { taskId: task.id, jobId: null, agentId: null, agentName: null, error: "no suitable employee found" };

  const { data: job, error } = await client
    .from("ai_jobs")
    .insert({
      agent_id: employee.id,
      type: "work_engine_task",
      // Non-invasive link back to the Executive Planner's task — no schema
      // change, same technique as Sprint 6's [objective:id] tag.
      payload: { task_id: task.id, title: task.title, description: task.description.slice(0, 1000) },
      status: "pending",
    })
    .select("id")
    .single();

  if (error || !job) return { taskId: task.id, jobId: null, agentId: employee.id, agentName: employee.name, error: error?.message ?? "job insert failed" };

  await client.from("orchestration_tasks").update({ status: "assigned" }).eq("id", task.id);

  try {
    await founderMemory.episodic.append({
      function_name: "work-engine", action: "allocate_task", status: "success",
      input_summary: task.title.slice(0, 300), output_summary: `assigned to ${employee.name} (job ${job.id})`,
    });
  } catch { /* non-blocking */ }

  return { taskId: task.id, jobId: job.id, agentId: employee.id, agentName: employee.name };
}

// ── Allocate every unassigned task in a project (called right after
//    the Executive Planner's planObjective() creates them) ──────────
export async function allocateProjectWork(projectId: string): Promise<{ allocated: number; results: AllocationResult[] }> {
  const client = getClient();
  const { data: tasks } = await client.from("orchestration_tasks").select("id, title, description, project_id").eq("project_id", projectId).eq("status", "pending");
  if (!tasks || tasks.length === 0) return { allocated: 0, results: [] };

  // Department is carried on the objective, not the task (Sprint 6's
  // design) — trace it via the project's tagged request text once, reuse
  // for every task in this project rather than a query per task.
  const { data: project } = await client.from("orchestration_projects").select("request").eq("id", projectId).single();
  let departmentCode: string | null = null;
  const objMatch = project?.request?.match(/^\[objective:([^\]]+)\]/);
  if (objMatch) {
    const { data: objective } = await client.from("orchestrator_requests").select("department_code").eq("id", objMatch[1]).maybeSingle();
    departmentCode = objective?.department_code ?? null;
  }

  const results: AllocationResult[] = [];
  for (const t of tasks) {
    const r = await allocateTask({ id: t.id, title: t.title, description: t.description ?? "", departmentCode });
    results.push(r);
  }
  return { allocated: results.filter((r) => r.jobId).length, results };
}

// ── Automatic reassignment — a job stuck 'running' or 'pending' past a
//    staleness window gets reassigned to a different (available) employee
//    of the same department. The stale job is marked 'failed' with a
//    reason, not silently deleted — the record stays for review. ──────
// SPRINT 10 (M1-S10) CORRECTION: this function originally polled for
// 'pending'/'running' jobs stuck past a time window and reassigned them.
// While auditing for the Execution Engine sprint, found that this DUPLICATES
// existing, already-deployed infrastructure: migration
// 20260713006000_ai_engine_fabrication_fix_and_reaper.sql documents
// reap_orphaned_ai_jobs(), a pure-SQL cron ('ai-jobs-orphan-reaper', every
// 10min) that already requeues/fails jobs stuck in 'running' past 15
// minutes, generically across ALL of ai_jobs (not just work_engine_task
// rows) — more robust than this TypeScript polling (no HTTP round-trip
// dependency to fail the way the poll itself could). Per the Constitution's
// "never rebuild... scheduling... unless a technical limitation prevents
// integration": no such limitation exists here, so the staleness-detection
// half of this function is REMOVED.
// What the reaper does NOT do (confirmed by its own changelog: "requeues"
// — same agent, not a different one) is pick a BETTER employee. That one
// gap is real and is what this function now does: it only looks at jobs
// the reaper (or anything else) has already marked 'failed', and only
// then applies selectBestEmployee() to try a genuinely different, better-
// fit employee — extending the existing reaper instead of duplicating it.
export async function reassignStuckWork(): Promise<{ reassigned: number }> {
  const client = getClient();
  const { data: failedJobs } = await client.from("ai_jobs").select("id, agent_id, payload, status").eq("status", "failed").eq("type", "work_engine_task").limit(20);
  if (!failedJobs || failedJobs.length === 0) return { reassigned: 0 };

  const workforce = await getWorkforce();
  let reassigned = 0;

  for (const job of failedJobs) {
    const payload = job.payload as { task_id?: string; title?: string; description?: string; _reassignedFrom?: string } | null;
    if (!payload?.task_id || payload._reassignedFrom) continue; // never re-reassign a job we already moved once — avoid an infinite ping-pong

    // The underlying task might already be done via a different path (e.g.
    // returnCompletedWork() on an earlier attempt) — skip if so.
    const { data: task } = await client.from("orchestration_tasks").select("status").eq("id", payload.task_id).maybeSingle();
    if (!task || task.status === "done" || task.status === "approved") continue;

    const previousAgent = workforce.find((e) => e.id === job.agent_id);
    const departmentCode = previousAgent?.department ?? null;
    const alternative = selectBestEmployee(workforce.filter((e) => e.id !== job.agent_id), departmentCode);
    if (!alternative) continue;

    const { data: newJob } = await client
      .from("ai_jobs")
      .insert({ agent_id: alternative.id, type: "work_engine_task", payload: { ...payload, _reassignedFrom: job.agent_id }, status: "pending" })
      .select("id")
      .single();

    if (newJob) {
      reassigned++;
      try {
        await founderMemory.episodic.append({
          function_name: "work-engine", action: "reassign_stuck_work", status: "success",
          input_summary: (payload.title ?? "").slice(0, 300),
          output_summary: `after failure, moved from ${previousAgent?.name ?? job.agent_id} to ${alternative.name}`,
        });
      } catch { /* non-blocking */ }
    }
  }

  return { reassigned };
}

// ── Return completed work to the Executive Planner ──────────────────
// A completed ai_jobs row whose task is still marked 'assigned' (not yet
// 'done') gets the orchestration_task closed out and a learning outcome
// recorded — closing the loop back to review/learning, per the founder's
// explicit ask.
export async function returnCompletedWork(): Promise<{ returned: number; dispatched: number }> {
  const client = getClient();
  const { data: completedJobs } = await client.from("ai_jobs").select("id, payload, result").eq("status", "completed").eq("type", "work_engine_task").limit(20);
  if (!completedJobs || completedJobs.length === 0) return { returned: 0, dispatched: 0 };

  let returned = 0;
  let dispatched = 0;
  for (const job of completedJobs) {
    const payload = job.payload as { task_id?: string } | null;
    if (!payload?.task_id) continue;

    const { data: task } = await client.from("orchestration_tasks").select("id, status").eq("id", payload.task_id).maybeSingle();
    if (!task || task.status === "done" || task.status === "approved") continue; // already returned, skip

    // SPRINT 11 (M1-S11) — Company OS integration: ai-engine's generic
    // executeJob() asks the assigned employee's LLM to "respond with ONLY
    // a valid JSON object." If that JSON explicitly names a capability
    // (the employee decided a real business action is needed, e.g. "send
    // this lead a WhatsApp follow-up"), dispatch it through Company OS
    // instead of just filing the LLM's text as the task output. This is
    // the one concrete, demonstrable link in the chain — NOT a claim that
    // every task auto-triggers a business action; only ones whose result
    // actually names one.
    let finalOutput: unknown = job.result;
    const resultObj = job.result as { capability?: string; payload?: Record<string, unknown> } | null;
    if (resultObj?.capability) {
      const dispatch = await executeCapability(resultObj.capability, resultObj.payload ?? {});
      dispatched++;
      finalOutput = { llmResult: job.result, companyOsDispatch: dispatch };
    }

    await client.from("orchestration_tasks").update({ status: "done", output: JSON.stringify(finalOutput).slice(0, 5000) }).eq("id", task.id);
    try {
      await founderMemory.learning.recordOutcome({ function_name: "work-engine", action: "task_completed", success: true, value: 1 });
    } catch { /* non-blocking */ }
    returned++;
  }
  return { returned, dispatched };
}

// ── Work velocity — real throughput, not a fabricated trend line ────
export async function getWorkVelocity(): Promise<{ last24h: number; last7d: number }> {
  const client = getClient();
  const day = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const [{ count: last24h }, { count: last7d }] = await Promise.all([
    client.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status", "completed").eq("type", "work_engine_task").gte("updated_at", day),
    client.from("ai_jobs").select("id", { count: "exact", head: true }).eq("status", "completed").eq("type", "work_engine_task").gte("updated_at", week),
  ]);
  return { last24h: last24h ?? 0, last7d: last7d ?? 0 };
}
