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
import { compactDispatchForStorage } from "./fact-grounding.ts";

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

export async function allocateTask(task: { id: string; title: string; description: string; departmentCode: string | null; objectiveId?: string | null; projectId?: string | null; founderSubmitted?: boolean }): Promise<AllocationResult> {
  const client = getClient();
  const workforce = await getWorkforce();
  if (workforce.length === 0) return { taskId: task.id, jobId: null, agentId: null, agentName: null, error: "no active AI employees available" };

  const employee = selectBestEmployee(workforce, task.departmentCode);
  if (!employee) return { taskId: task.id, jobId: null, agentId: null, agentName: null, error: "no suitable employee found" };

  // Sequential evidence handoff: later tasks must receive the actual recorded
  // outputs of earlier completed tasks. This prevents a verifier/report task
  // from independently researching the same question and losing the evidence
  // chain. Only completed task outputs from the same project are included.
  let priorCompletedTasks: Array<{ id: string; title: string; output: unknown }> = [];
  if (task.projectId) {
    const { data: prior } = await client
      .from("orchestration_tasks")
      .select("id, title, output, status, created_at")
      .eq("project_id", task.projectId)
      .in("status", ["done", "approved"])
      .neq("id", task.id)
      .order("created_at", { ascending: true })
      .limit(10);
    priorCompletedTasks = (prior ?? []).map((p) => ({
      id: String(p.id),
      title: String(p.title ?? ""),
      output: typeof p.output === "string" ? (() => { try { return JSON.parse(p.output); } catch { return p.output.slice(0, 5000); } })() : p.output,
    }));
  }

  const { data: job, error } = await client
    .from("ai_jobs")
    .insert({
      agent_id: employee.id,
      type: "work_engine_task",
      // Non-invasive link back to the Executive Planner's task — no schema
      // change, same technique as Sprint 6's [objective:id] tag.
      payload: {
        task_id: task.id,
        title: task.title,
        description: task.description.slice(0, 1000),
        objective_id: task.objectiveId ?? null,
        project_id: task.projectId ?? null,
        founder_submitted: task.founderSubmitted === true,
        work_package_id: task.objectiveId ? (await client.from("work_packages").select("id").eq("objective_id", task.objectiveId).eq("state->>task_id", task.id).maybeSingle()).data?.id ?? null : null,
        prior_completed_tasks: priorCompletedTasks,
      },
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
  const { data: tasks } = await client
    .from("orchestration_tasks")
    .select("id, title, description, project_id")
    .eq("project_id", projectId)
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(1);
  if (!tasks || tasks.length === 0) return { allocated: 0, results: [] };

  // Department is carried on the objective, not the task (Sprint 6's
  // design) — trace it via the project's tagged request text once, reuse
  // for every task in this project rather than a query per task.
  const { data: project } = await client.from("orchestration_projects").select("request").eq("id", projectId).single();
  let departmentCode: string | null = null;
  let objectiveId: string | null = null;
  let objectiveFounderSubmitted = false;
  const objMatch = project?.request?.match(/^\[objective:([^\]]+)\]/);
  if (objMatch) {
    objectiveId = objMatch[1];
    const { data: objective } = await client.from("orchestrator_requests").select("department_code, classification").eq("id", objectiveId).maybeSingle();
    departmentCode = objective?.department_code ?? null;
    objectiveFounderSubmitted = objective?.classification === "founder_objective";
  }

  // Initialize canonical project state before queueing work.
  if (objectiveId) {
    try {
      await client.rpc("fkaios_upsert_project_state", {
        p_orchestration_project_id: projectId,
        p_objective: project?.request ?? objectiveId,
        p_objective_id: objectiveId,
        p_status: "active",
        p_current_task_id: tasks[0].id,
        p_current_task_summary: tasks[0].title,
        p_next_action: "Execute the assigned task and persist verified work.",
        p_provenance: { source: "work-engine:allocateProjectWork", objective_id: objectiveId },
      });
    } catch (stateErr) {
      console.error("work-engine: canonical project state initialization failed", stateErr instanceof Error ? stateErr.message : String(stateErr));
    }
  }

  const results: AllocationResult[] = [];
  for (const t of tasks) {
    const r = await allocateTask({ id: t.id, title: t.title, description: t.description ?? "", departmentCode, objectiveId, projectId: t.project_id, founderSubmitted: objectiveFounderSubmitted });
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
      .insert({ agent_id: alternative.id, type: "work_engine_task", payload: { ...payload, work_package_id: payload.work_package_id ?? null, _reassignedFrom: job.agent_id, handoff_required: true }, status: "pending" })
      .select("id")
      .single();

    if (newJob) {
      reassigned++;
      const wpId = payload.work_package_id ? String(payload.work_package_id) : null;
      const { data: wp } = wpId
        ? await client.from("work_packages").select("id,objective_id,selected_provider,contract_snapshot,acceptance_criteria,input_artifacts,required_outputs,state,handoff_notes").eq("id",wpId).maybeSingle()
        : { data: null };
      // Universal continuity packet: FKAIOS project state travels with the work.
      // The replacement worker does not need the previous worker's conversation.
      let canonicalState: Record<string, unknown> = {};
      if (payload.project_id) {
        const { data: projectState } = await client
          .from("fkaios_project_state")
          .select("id, objective, desired_outcome, status, current_strategy, current_architecture, current_implementation, current_task_id, current_task_summary, next_action, completed_work, pending_work, blocked_work, unknown_work, decisions, discoveries, errors, tests, artifacts, workers_used, capabilities_used, last_verified_at, last_verified_by, state_version, provenance")
          .eq("orchestration_project_id", payload.project_id)
          .maybeSingle();
        canonicalState = projectState ?? {};
      }

      const handoffPacket = {
        packet_type: "fkaios_work_continuity_v1",
        objective_id: payload.objective_id ?? null,
        project_id: payload.project_id ?? null,
        task_id: payload.task_id,
        work_package_id: wp?.id ?? null,
        original_provider: wp?.selected_provider ?? previousAgent?.name ?? job.agent_id,
        new_provider: alternative.name,
        canonical_project_state: canonicalState,
        contract_snapshot: wp?.contract_snapshot ?? {},
        acceptance_criteria: wp?.acceptance_criteria ?? [],
        input_artifacts: wp?.input_artifacts ?? [],
        required_outputs: wp?.required_outputs ?? [],
        state: wp?.state ?? {},
        prior_job_id: job.id,
        prior_result: null,
        continuity_rule: "continue from canonical recorded state; preserve verified work; do not regenerate completed work or reinterpret the contract",
      };
      const { data: handoff } = await client.from("provider_handoffs").insert({
        objective_id: payload.objective_id ?? null,
        work_package_id: wp?.id ?? null,
        ai_job_id: newJob.id,
        from_provider: wp?.selected_provider ?? previousAgent?.name ?? job.agent_id,
        to_provider: alternative.name,
        reason: "previous execution failed; automatic continuity-preserving reassignment",
        handoff_packet: handoffPacket,
        status: "dispatched",
      }).select("id").single();
      if (wp?.id) {
        await client.from("work_packages").update({
          selected_provider: alternative.name,
          status: "handoff",
          handoff_notes: { ...(wp.handoff_notes ?? {}), last_handoff_id: handoff?.id ?? null, from_provider: wp.selected_provider ?? previousAgent?.name ?? job.agent_id, to_provider: alternative.name },
          updated_at: new Date().toISOString(),
        }).eq("id",wp.id);
      }
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
  // Only inspect completed jobs whose linked orchestration task is still open.
  // The old global .limit(20) could be consumed by unrelated historical jobs,
  // leaving a newly completed objective task at "assigned" with no live job.
  // Resolve the FULL open-task set (paginated, newest first) and look up
  // completed jobs in chunks, so neither a row cap nor URL length can hide a
  // newly finished objective task.
  const openTaskIds: string[] = [];
  for (let from = 0; ; from += 1000) {
    const { data: page, error: pageErr } = await client
      .from("orchestration_tasks")
      .select("id")
      .in("status", ["pending", "assigned", "running", "working", "rework"])
      .order("created_at", { ascending: false })
      .range(from, from + 999);
    if (pageErr) throw new Error(`returnCompletedWork: open task load failed: ${pageErr.message}`);
    for (const t of page ?? []) if (t?.id) openTaskIds.push(String(t.id));
    if (!page || page.length < 1000) break;
  }
  if (openTaskIds.length === 0) return { returned: 0, dispatched: 0 };

  // Only reconcile work belonging to an active founder objective (the same set
  // runObjectiveLoop() processes). Completed jobs left behind by objectives that
  // are awaiting approval or already finished, or by non-objective work, stay
  // untouched: returning them would re-dispatch historical capabilities (e.g.
  // paid research.run calls) that nobody is waiting on.
  const { data: activeObjectives, error: objErr } = await client
    .from("orchestrator_requests")
    .select("id")
    .eq("requested_by", "founder-brain")
    .eq("status", "processing");
  if (objErr) throw new Error(`returnCompletedWork: active objective load failed: ${objErr.message}`);
  const activeObjectiveIds = (activeObjectives ?? []).map((o) => String(o.id)).filter(Boolean);
  if (activeObjectiveIds.length === 0) return { returned: 0, dispatched: 0 };

  const completedJobs: Array<{ id: string; payload: unknown; result: unknown }> = [];
  for (let k = 0; k < openTaskIds.length; k += 100) {
    const { data: chunk, error: jobErr } = await client
      .from("ai_jobs")
      .select("id, payload, result")
      .eq("status", "completed")
      .eq("type", "work_engine_task")
      .in("payload->>objective_id", activeObjectiveIds)
      .in("payload->>task_id", openTaskIds.slice(k, k + 100));
    if (jobErr) throw new Error(`returnCompletedWork: completed job load failed: ${jobErr.message}`);
    completedJobs.push(...((chunk ?? []) as typeof completedJobs));
  }
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
    const resultObj = job.result as {
      capability?: string;
      payload?: Record<string, unknown>;
      capability_result?: unknown;
      capability_attempts?: number;
    } | null;
    if (resultObj?.capability) {
      // Founder research is executed deterministically in ai-engine before
      // LLM generation. If that measured result is already attached to the
      // job, persist it directly instead of dispatching research.run again.
      // This preserves the real evidence and prevents a duplicate Apify call.
      if (
        resultObj.capability === "research.run" &&
        resultObj.capability_result !== undefined
      ) {
        const measuredDispatch = {
          capability: "research.run",
          status: "success",
          attempts: Number(resultObj.capability_attempts ?? 1),
          data: resultObj.capability_result,
        };
        finalOutput = { llmResult: job.result, companyOsDispatch: compactDispatchForStorage(measuredDispatch) };
      } else if (
        ["product.build", "product.deploy", "product.verify"].includes(resultObj.capability) &&
        resultObj.capability_result !== undefined
      ) {
        // Product lifecycle execution is already measured by ai-engine.
        // Do not run it a second time through Company OS; persist the measured
        // result as the task's verification evidence.
        const measuredDispatch = {
          capability: resultObj.capability,
          status: "success",
          attempts: 1,
          data: resultObj.capability_result,
        };
        finalOutput = { llmResult: job.result, companyOsDispatch: compactDispatchForStorage(measuredDispatch) };
      } else {
        const dispatch = await executeCapability(resultObj.capability, resultObj.payload ?? {});
        dispatched++;
        finalOutput = { llmResult: job.result, companyOsDispatch: compactDispatchForStorage(dispatch) };
      }
    }

    await client.from("orchestration_tasks").update({ status: "done", output: JSON.stringify(finalOutput).slice(0, 5000) }).eq("id", task.id);
    try {
      // EVOLUTION AUDIT FINDING (2026-07-18): this previously hardcoded
      // success:true unconditionally, even when a Company OS dispatch
      // above had just failed (resultObj.capability was set but
      // dispatch.status === 'error'). The task still gets marked 'done'
      // (the LLM reasoning genuinely completed, that part is real) but
      // Learning should reflect what actually happened to the dispatch,
      // not paper over it — a false-positive success record would corrupt
      // any future confidence/wisdom computation that reads it back.
      const dispatchOutcome = resultObj?.capability ? (finalOutput as { companyOsDispatch?: { status?: string } }).companyOsDispatch?.status === "success" : true;
      await founderMemory.learning.recordOutcome({ function_name: "work-engine", action: "task_completed", success: dispatchOutcome, value: 1 });
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
