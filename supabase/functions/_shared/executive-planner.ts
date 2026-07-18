// ============================================================================
// EXECUTIVE PLANNER — SPRINT 6 (M1-S6)
// ============================================================================
// Sits between Founder Brain and Departments, per the founder's own diagram:
//   Founder Brain → Executive Planner → Departments → AI Employees → Execution
//
// REUSE, NOT PARALLEL SYSTEMS (grep-verified before writing):
//   - "Objectives"  -> orchestrator_requests rows (already the Founder Brain's
//     decision-handoff table since Sprint 2b/3/4 — has department_code,
//     status lifecycle, approval_id FK). NOT a new table.
//   - "Projects"    -> orchestration_projects (already exists, already used
//     by orchestrator-engine's CEO→specialist→CPO pipeline — status
//     working/reviewing/reworking/merging/complete/failed). NOT a new table.
//     Linked to its objective via a `[objective:<id>]` prefix tag in the
//     `request` text column — no schema change, no migration needed.
//   - "Tasks"       -> orchestration_tasks (already exists, already has
//     project_id/role/title/description/status/attempts). NOT a new table.
//   - "Escalation"  -> the `approvals` table (already exists, already
//     surfaced in the Founder Workspace's Pending Approvals section since
//     Sprint 5) — a blocked project becomes a real pending approval, not a
//     new escalation channel.
//   - Reasoning     -> founder-brain.ts's reason()/getGoals(). This module
//     does NOT call any LLM provider directly.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { reason, getGoals, founderMemory } from "./founder-brain.ts";

function getClient() {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  return createClient(url, key);
}

export interface Objective {
  id: string;
  raw_request: string;
  department_code: string | null;
  status: string;
}

export interface PlanResult {
  projectId: string | null;
  tasksCreated: number;
  error?: string;
}

// ── Break an objective into a project + executable tasks ───────────────
// This is the step Sprint 2c/3's cognitiveTick never had: it created an
// objective (orchestrator_requests row) and stopped. Executive Planner
// picks up from there and produces real, trackable orchestration_projects
// + orchestration_tasks rows — "convert strategic thinking into executable
// company work."
export async function planObjective(objective: Objective, correlationId?: string): Promise<PlanResult> {
  const client = getClient();
  const goals = await getGoals("founder");

  const decomposition = await reason(
    "You are the Executive Planner. Break this business objective into 2-4 concrete, executable tasks. Evaluate against the goal hierarchy provided — do not propose tasks unrelated to the goals. Return ONLY a JSON array of {title, description}, nothing else.",
    `OBJECTIVE: ${objective.raw_request}\n\nDEPARTMENT: ${objective.department_code ?? "unassigned"}\n\nGOAL HIERARCHY:\n${JSON.stringify(goals)}`,
    900,
    correlationId,
  );

  let taskDrafts: Array<{ title: string; description: string }> = [];
  try {
    const parsed = JSON.parse(decomposition.text);
    if (Array.isArray(parsed)) taskDrafts = parsed;
  } catch {
    // Honest failure — no fabricated tasks if the model didn't return clean JSON.
    return { projectId: null, tasksCreated: 0, error: "planner could not parse a task breakdown" };
  }
  if (taskDrafts.length === 0) return { projectId: null, tasksCreated: 0, error: "planner produced zero tasks" };

  const { data: proj, error: pErr } = await client
    .from("orchestration_projects")
    .insert({ request: `[objective:${objective.id}] ${objective.raw_request}`.slice(0, 2000), status: "working", output_type: "document" })
    .select("id")
    .single();
  if (pErr || !proj) return { projectId: null, tasksCreated: 0, error: pErr?.message ?? "project insert failed" };

  const tasks = taskDrafts.slice(0, 4).map((t) => ({
    project_id: proj.id,
    role: "general", // orchestration_tasks.role is a software-persona field (frontend/backend/.../general); business objectives stay 'general' — department assignment is already tracked on the objective itself, not duplicated here.
    title: String(t.title ?? "Task").slice(0, 200),
    description: String(t.description ?? "").slice(0, 2000),
    status: "pending",
    attempts: 0,
  }));

  const { error: tErr } = await client.from("orchestration_tasks").insert(tasks);
  if (tErr) return { projectId: proj.id, tasksCreated: 0, error: tErr.message };

  try {
    await founderMemory.episodic.append({
      function_name: "executive-planner", action: "plan_objective", status: "success",
      input_summary: objective.raw_request.slice(0, 300), output_summary: `project ${proj.id}, ${tasks.length} tasks`,
    });
  } catch { /* non-blocking */ }

  return { projectId: proj.id, tasksCreated: tasks.length };
}

// ── Progress tracking — real aggregation, not a fabricated percentage ──
export interface ProjectProgress {
  projectId: string;
  request: string;
  status: string;
  totalTasks: number;
  doneTasks: number;
  percent: number;
}

export async function getProjectProgress(limit = 10): Promise<ProjectProgress[]> {
  const client = getClient();
  const { data: projects } = await client
    .from("orchestration_projects")
    .select("id, request, status")
    .like("request", "[objective:%")
    .order("id", { ascending: false })
    .limit(limit);
  if (!projects || projects.length === 0) return [];

  const results: ProjectProgress[] = [];
  for (const p of projects) {
    const { data: tasks } = await client.from("orchestration_tasks").select("status").eq("project_id", p.id);
    const total = tasks?.length ?? 0;
    const done = (tasks ?? []).filter((t: { status: string }) => t.status === "done" || t.status === "approved").length;
    results.push({ projectId: p.id, request: p.request, status: p.status, totalTasks: total, doneTasks: done, percent: total > 0 ? Math.round((done / total) * 100) : 0 });
  }
  return results;
}

// ── Escalation — blocked work goes back to the Founder Brain, via the
//    SAME approvals table already surfaced in the Founder Workspace. No
//    new escalation channel; the founder sees this exactly where pending
//    approvals already show up.
// ──────────────────────────────────────────────────────────────────────
export async function escalateBlocked(correlationId?: string): Promise<{ escalated: number }> {
  const client = getClient();
  // "Blocked" = a task that has failed/reworked at least twice, or a
  // project stuck in 'reworking' — real signals already written by
  // orchestrator-engine's own execution loop, not invented here.
  const { data: stuckTasks } = await client.from("orchestration_tasks").select("id, project_id, title, attempts, status").gte("attempts", 2).neq("status", "done").neq("status", "approved");
  const { data: stuckProjects } = await client.from("orchestration_projects").select("id, request, status").eq("status", "reworking");

  let escalated = 0;
  const seenProjects = new Set<string>();

  for (const t of stuckTasks ?? []) {
    if (seenProjects.has(t.project_id)) continue; // one escalation per project per pass, not one per stuck task
    seenProjects.add(t.project_id);
    try {
      await client.from("approvals").insert({
        action_type: "escalation_blocked_task",
        payload: { project_id: t.project_id, task_id: t.id, title: t.title, attempts: t.attempts },
        risk_level: "medium",
        reason: `Task "${t.title}" has failed/reworked ${t.attempts} times without completing — escalated to the Founder Brain for a decision.`,
      });
      escalated++;
    } catch { /* non-blocking, one bad insert never stops the pass */ }
  }

  for (const p of stuckProjects ?? []) {
    if (seenProjects.has(p.id)) continue;
    seenProjects.add(p.id);
    try {
      await client.from("approvals").insert({
        action_type: "escalation_blocked_project",
        payload: { project_id: p.id, status: p.status },
        risk_level: "medium",
        reason: `Project stuck in '${p.status}' — escalated to the Founder Brain for a decision.`,
      });
      escalated++;
    } catch { /* non-blocking */ }
  }

  if (escalated > 0) {
    try {
      await founderMemory.episodic.append({ function_name: "executive-planner", action: "escalate_blocked", status: "success", output_summary: `${escalated} item(s) escalated` });
    } catch { /* non-blocking */ }
  }

  return { escalated };
}

// ============================================================================
// AI DEPARTMENTS — SPRINT 7 (M1-S7)
// ============================================================================
// Technology Integration Audit (per the founder's new permanent rule) for
// this subsystem: evaluated LangGraph, CrewAI, Microsoft Agent Framework,
// Google ADK, LlamaIndex Workflows (2026 leading multi-agent orchestration
// frameworks — real web search, not assumed). All are built around a
// persistent Python/Node runtime holding agent/graph state in memory or a
// framework-owned store. FKAIOS runs on stateless Supabase Edge Functions
// (Deno, invoked per-request/per-cron-tick, no persistent process) with
// Postgres as the only state layer. Adopting any of them would require
// standing up a NEW always-on runtime host — a genuine architecture change,
// which this sprint is explicitly forbidden from making. Architecture-
// compatibility score for this specific need: low, despite high maturity/
// community scores on every other axis. DECISION: BUILD OUR OWN — extend
// the existing `departments` + `orchestrator_requests` + `orchestration_*`
// tables (already proven, zero new infrastructure), not the frameworks
// above. Reconsider LangGraph/similar only if FKAIOS ever adds a
// persistent worker process — flag for the Technology Council, not an
// action taken now.
//
// getDepartmentWorkload() gives departments real, live behavior: what each
// one has actually been assigned by the Founder Brain, not just its static
// KPI row. No new table — traces the existing objective→project chain.
// ============================================================================
export interface DepartmentWorkload {
  code: string;
  name: string;
  automationLevel: number;
  kpis: unknown;
  objectives: { processing: number; completed: number; failed: number; awaiting_approval: number };
}

export async function getDepartmentWorkload(): Promise<DepartmentWorkload[]> {
  const client = getClient();
  const { data: departments } = await client.from("departments").select("code, name, automation_level, kpis").eq("is_active", true);
  if (!departments || departments.length === 0) return [];

  const { data: objectives } = await client.from("orchestrator_requests").select("department_code, status").eq("requested_by", "founder-brain");

  return departments.map((d: { code: string; name: string; automation_level: number; kpis: unknown }) => {
    const deptObjectives = (objectives ?? []).filter((o: { department_code: string | null }) => o.department_code === d.code);
    const count = (status: string) => deptObjectives.filter((o: { status: string }) => o.status === status).length;
    return {
      code: d.code,
      name: d.name,
      automationLevel: d.automation_level,
      kpis: d.kpis,
      objectives: { processing: count("processing"), completed: count("completed"), failed: count("failed"), awaiting_approval: count("awaiting_approval") },
    };
  });
}

// ============================================================================
// AI EMPLOYEES — SPRINT 8 (M1-S8)
// ============================================================================
// Technology Integration Audit for this subsystem: before writing anything,
// searched the codebase itself (not external frameworks this time — the
// mature "existing solution" turned out to be inside FKAIOS already) and
// found `ai_agents` + `ai_jobs` + `agent_performance_metrics` +
// `agent_dispatch_log` — a COMPLETE employee data model already built and
// already used by 15+ engines (ai-engine, auto-agents-engine, orchestrator,
// agent-scheduler, job-scheduler, mis-engine, governance-dashboard, etc.).
// One live agent already matches the founder's own example list verbatim:
// auto-agents-engine's task 'QUALIFY_LEAD' agent is literally named "Lead
// Qualifier AI". Fit score: >90% on every field the founder asked for —
// name≈Role, department/dept≈Department, tools≈Skills, autonomy_level+
// is_active+status≈Current workload/capability, success_rate≈Performance,
// total_tasks_completed≈Experience history, escalation_rule≈Escalation
// path, ai_jobs≈Assigned tasks, agent_performance_metrics≈Learning/
// performance history, agent_dispatch_log≈Experience history (event log).
// DECISION: INTEGRATE. Zero new tables. This module only READS what
// already exists — it does not create a second agent/employee system.
// ============================================================================
export interface EmployeeSummary {
  id: string;
  name: string;
  department: string | null;
  status: string | null;
  isActive: boolean;
  autonomyLevel: number | null;
  successRate: number | null;
  totalTasksCompleted: number | null;
  lastActiveAt: string | null;
  activeJobs: number;
  completedJobs: number;
  failedJobs: number;
}

export async function getWorkforce(): Promise<EmployeeSummary[]> {
  const client = getClient();
  const { data: agents } = await client
    .from("ai_agents")
    .select("id, name, department, dept, status, is_active, autonomy_level, success_rate, total_tasks_completed, last_active_at")
    .eq("is_active", true)
    .order("name");
  if (!agents || agents.length === 0) return [];

  const ids = agents.map((a: { id: string }) => a.id);
  const { data: jobs } = await client.from("ai_jobs").select("agent_id, status").in("agent_id", ids);

  return agents.map((a: any) => {
    const own = (jobs ?? []).filter((j: { agent_id: string }) => j.agent_id === a.id);
    return {
      id: a.id,
      name: a.name,
      department: a.department ?? a.dept ?? null,
      status: a.status,
      isActive: a.is_active,
      autonomyLevel: a.autonomy_level,
      successRate: a.success_rate,
      totalTasksCompleted: a.total_tasks_completed,
      lastActiveAt: a.last_active_at,
      activeJobs: own.filter((j: { status: string }) => j.status === "pending" || j.status === "running").length,
      completedJobs: own.filter((j: { status: string }) => j.status === "completed").length,
      failedJobs: own.filter((j: { status: string }) => j.status === "failed").length,
    };
  });
}

// ============================================================================
// REFLECTION — SPRINT 13 (M1-S13)
// ============================================================================
// ENTERPRISE ARCHITECTURE REVIEW (per the permanent principle):
//   Step 1 (search FKAIOS): execution_log (11+ engines already write
//   success/error rows here), agent_performance_metrics (per-task cost/
//   latency/success), orchestration_tasks (done/failed status) all
//   ALREADY hold exactly the evidence Reflection needs. No new table.
//   Step 2 (external tech): reflection/self-critique loops are a known
//   pattern (ReAct/Reflexion-style), but "Self-Learning/Self-Improvement
//   Logic" is on the Constitution's ALWAYS-BUILD list — never outsourced,
//   so no external evaluation needed here.
//   Step 3/4 (decision): REUSE the data tables entirely; BUILD the one
//   thing that doesn't exist anywhere — a reasoning pass that reads
//   ACROSS them and produces an explainable verdict.
//   NOT a duplicate of founder-brain.ts's existing Improve phase (Sprint
//   3): that phase reflects narrowly on the Founder Brain's OWN assigned
//   objectives (orchestrator_requests it created). This reflects broadly
//   across ALL company activity in execution_log — every engine, not just
//   ones the brain personally assigned. Different scope, same discipline
//   (grounded, versioned, never fabricated) — not a second reflection
//   engine, an executive-level view the objective-level one doesn't cover.
// ============================================================================
export interface Reflection {
  version: number;
  whatWorked: string;
  whatFailed: string;
  assumptionsWrong: string;
  recommendedChange: string;
  evidenceCount: number;
}

export async function reflect(userId: string, correlationId?: string): Promise<Reflection | null> {
  const client = getClient();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [logRes, perfRes, taskRes] = await Promise.all([
    client.from("execution_log").select("function_name, action, status, error").gte("created_at", since).limit(200),
    client.from("agent_performance_metrics").select("agent_id, task_type, success, error_message").limit(100),
    client.from("orchestration_tasks").select("status").limit(200),
  ]);

  const logs = logRes.data ?? [];
  const perf = perfRes.data ?? [];
  const tasks = taskRes.data ?? [];
  const evidenceCount = logs.length + perf.length + tasks.length;

  if (evidenceCount === 0) return null; // honest — nothing to reflect on, not a fabricated reflection

  const summary = {
    execution_log: { total: logs.length, success: logs.filter((r: { status: string }) => r.status === "success").length, error: logs.filter((r: { status: string }) => r.status === "error").length, byFunction: countBy(logs, "function_name") },
    agent_performance: { total: perf.length, success: perf.filter((r: { success: boolean }) => r.success).length, failed: perf.filter((r: { success: boolean }) => !r.success).length },
    tasks: { total: tasks.length, byStatus: countBy(tasks, "status") },
  };

  const result = await reason(
    "You are the Company reflecting on the last 24 hours of REAL operational activity across every engine — not just what the Founder Brain personally assigned. Given these real counts (not fabricated), state: (1) what worked, (2) what failed, (3) what assumption this data suggests was wrong, (4) one recommended change. Be specific and grounded in the numbers given — if the data is too thin to conclude something, say so instead of inventing a pattern. Return ONLY JSON: {whatWorked, whatFailed, assumptionsWrong, recommendedChange}.",
    JSON.stringify(summary),
    500,
    correlationId,
  );

  let parsed: { whatWorked?: string; whatFailed?: string; assumptionsWrong?: string; recommendedChange?: string } = {};
  try {
    parsed = JSON.parse(result.text);
  } catch {
    return null; // honest empty result, no fabricated reflection if unparseable
  }

  const history = await getReflectionHistory(userId);
  const version = history.length + 1;
  const reflection: Reflection = {
    version,
    whatWorked: parsed.whatWorked ?? "",
    whatFailed: parsed.whatFailed ?? "",
    assumptionsWrong: parsed.assumptionsWrong ?? "",
    recommendedChange: parsed.recommendedChange ?? "",
    evidenceCount,
  };

  try {
    await founderMemory.permanent.set(userId, { kind: "reflection", ...reflection, created_at: new Date().toISOString() });
    await founderMemory.episodic.append({ function_name: "executive-planner", action: "reflect", status: "success", output_summary: `v${version}: ${reflection.recommendedChange}`.slice(0, 300) });
  } catch { /* non-blocking */ }

  return reflection;
}

export async function getReflectionHistory(userId: string): Promise<Reflection[]> {
  const rows = (await founderMemory.permanent.get(userId)) as Array<{ content?: { kind?: string } }> | null;
  if (!rows) return [];
  return rows.filter((r) => r.content?.kind === "reflection").map((r) => r.content as unknown as Reflection);
}

function countBy(rows: Array<Record<string, unknown>>, field: string): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) {
    const key = String(r[field] ?? "unknown");
    out[key] = (out[key] ?? 0) + 1;
  }
  return out;
}

// ============================================================================
// BUSINESS INTUITION — SPRINT 14 (M1-S14)
// ============================================================================
// ENTERPRISE ARCHITECTURE REVIEW: Step1 found agent_performance_metrics
// (task_type + success, already written by multiple engines since before
// this milestone) is the exact statistical basis Intuition needs. No new
// table. Step2 skipped — Self-Learning/Improvement Logic is Constitution's
// always-build list. DECISION: REUSE the data, BUILD only the aggregation.
//
// DELIBERATELY NOT an LLM call. Reflection (Sprint 13) uses reason() to
// synthesize qualitative narrative from recent activity. Intuition is a
// different thing: a real statistical confidence score per task type,
// computed directly from success/failure counts — "explainable evidence"
// per the Human+AI Intelligence document means the evidence IS the
// confidence number, not an LLM's guess at one. Below a sample-size floor,
// intuition is honestly withheld rather than reported on thin data.
// ============================================================================
const MIN_SAMPLE_SIZE = 5; // below this, "confidence" would be statistical noise, not intuition

export interface IntuitionPattern {
  taskType: string;
  confidence: number; // real success_count/total_count * 100, not LLM-estimated
  sampleSize: number;
  evidence: string; // literal count sentence, not a narrative
}

export async function buildIntuition(userId = "founder"): Promise<IntuitionPattern[]> {
  const client = getClient();
  const { data } = await client.from("agent_performance_metrics").select("task_type, success").limit(1000);
  if (!data || data.length === 0) return [];

  const byType = new Map<string, { success: number; total: number }>();
  for (const row of data as Array<{ task_type: string | null; success: boolean }>) {
    const type = row.task_type ?? "unlabeled";
    const entry = byType.get(type) ?? { success: 0, total: 0 };
    entry.total++;
    if (row.success) entry.success++;
    byType.set(type, entry);
  }

  const patterns: IntuitionPattern[] = [];
  for (const [taskType, { success, total }] of byType.entries()) {
    if (total < MIN_SAMPLE_SIZE) continue; // honest withholding, not a fabricated confidence
    patterns.push({
      taskType,
      confidence: Math.round((success / total) * 100),
      sampleSize: total,
      evidence: `${success} of ${total} recorded attempts succeeded`,
    });
  }

  patterns.sort((a, b) => b.sampleSize - a.sampleSize);

  try {
    await founderMemory.permanent.set(userId, { kind: "intuition", patterns, computed_at: new Date().toISOString() });
  } catch { /* non-blocking — intuition is recomputed fresh each call anyway, not required to persist to be useful this cycle */ }

  return patterns;
}

// ============================================================================
// TOKEN ECONOMY TRANSPARENCY — Evolution Phase B (post-Sprint-14)
// ============================================================================
// Evolution Before Addition: does this capability already exist somewhere,
// waiting to be extended? YES — agent_performance_metrics already has
// input_tokens/output_tokens/estimated_cost_usd/model/provider/latency_ms
// columns (found during the Sprint 8 audit, actively written by
// auto-agents-engine and others). This function only READS it. No new
// table, no new instrumentation added here.
//
// HONEST GAP, stated not hidden: founder-brain.ts's reason() (the actual
// Founder Brain reasoning path used by cognitiveTick/reflect/buildIntuition/
// curiosityTick/etc.) does NOT currently write to agent_performance_metrics
// — it's a separate LLM-calling path from the one instrumented here. This
// report can only show what's ALREADY tracked (other engines' calls), not
// the Founder Brain's own token spend. Making reason() itself instrumented
// is real follow-up work, not done in this pass — flagged, not silently
// left out of the report's own caveats.
// ============================================================================
export interface ProviderUsage {
  provider: string;
  calls: number;
  successCount: number;
  failureCount: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number | null;
}

export interface TokenEconomyReport {
  windowHours: number;
  providers: ProviderUsage[];
  claudeTokensConsumed: number | null; // null = "unavailable", never fabricated
  claudeTokensRemaining: "unavailable"; // no budget/quota table exists anywhere in this codebase — stated honestly, not guessed
  totalEstimatedCostUsd: number;
  caveat: string;
}

export async function getTokenEconomyReport(windowHours = 24): Promise<TokenEconomyReport> {
  const client = getClient();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("agent_performance_metrics")
    .select("provider, success, input_tokens, output_tokens, estimated_cost_usd, latency_ms")
    .gte("created_at", since)
    .limit(2000);

  const rows = data ?? [];
  const byProvider = new Map<string, { calls: number; success: number; failure: number; inTok: number; outTok: number; cost: number; latencySum: number; latencyCount: number }>();

  for (const r of rows as Array<{ provider: string | null; success: boolean; input_tokens: number | null; output_tokens: number | null; estimated_cost_usd: number | null; latency_ms: number | null }>) {
    const p = r.provider ?? "unknown";
    const e = byProvider.get(p) ?? { calls: 0, success: 0, failure: 0, inTok: 0, outTok: 0, cost: 0, latencySum: 0, latencyCount: 0 };
    e.calls++;
    if (r.success) e.success++; else e.failure++;
    e.inTok += r.input_tokens ?? 0;
    e.outTok += r.output_tokens ?? 0;
    e.cost += r.estimated_cost_usd ?? 0;
    if (r.latency_ms != null) { e.latencySum += r.latency_ms; e.latencyCount++; }
    byProvider.set(p, e);
  }

  const providers: ProviderUsage[] = Array.from(byProvider.entries()).map(([provider, e]) => ({
    provider,
    calls: e.calls,
    successCount: e.success,
    failureCount: e.failure,
    totalInputTokens: e.inTok,
    totalOutputTokens: e.outTok,
    totalCostUsd: Math.round(e.cost * 10000) / 10000,
    avgLatencyMs: e.latencyCount > 0 ? Math.round(e.latencySum / e.latencyCount) : null,
  })).sort((a, b) => b.calls - a.calls);

  const anthropicUsage = providers.find((p) => p.provider === "anthropic");
  const totalCost = providers.reduce((sum, p) => sum + p.totalCostUsd, 0);

  return {
    windowHours,
    providers,
    claudeTokensConsumed: anthropicUsage ? anthropicUsage.totalInputTokens + anthropicUsage.totalOutputTokens : null,
    claudeTokensRemaining: "unavailable",
    totalEstimatedCostUsd: Math.round(totalCost * 10000) / 10000,
    caveat: "Reflects agent_performance_metrics — includes the Founder Brain's own reason() calls (self-recorded since commit 5ba06fc: cognitiveTick/reflect/buildIntuition/curiosityTick all now write here under agent_id='founder-brain') alongside every other engine that writes to this table. estimated_cost_usd is only populated where the writing engine computed it — founder-brain's own rows currently have no cost figure (no per-model pricing table exists anywhere in this codebase), so totalEstimatedCostUsd understates true spend by exactly that much. Stated honestly, not silently rounded away.",
  };
}

// ============================================================================
// PROVIDER PERFORMANCE (evidence-based, not assumed) — Tool Selection Engine
// ============================================================================
// Constitution rule 11: "The Brain continuously learns which provider is
// fastest/cheapest/most accurate... using historical evidence, not
// assumptions." And a founder addition: "a provider selection layer should
// choose the best available provider based on capability, cost, latency,
// availability, and confidence."
//
// HONEST SCOPE, stated plainly rather than overclaimed: this is NOT a
// multi-provider selection layer across Claude/Gemini/OpenAI/DeepSeek/Grok/
// Perplexity/Mistral/Ollama/n8n. Only Anthropic, Gemini, and OpenAI have any
// API key referenced anywhere in this codebase (founder-brain.ts's
// reasonCore() fallback chain) — no credentials for the others exist here.
// Building a selector across providers with no real credentials would
// violate the same document's own rule 8 ("No Placeholders... never fake
// data"). What this DOES do, honestly: surface which of the 3 REAL,
// configured providers has actually performed best, using the real data
// reason() has self-recorded since commit 5ba06fc — turning "historical
// evidence" from an aspiration into an actual queryable fact. Does NOT
// change reasonCore()'s fixed Anthropic->Gemini->OpenAI fallback order —
// that stays as the reliability chain it always was; re-ordering it based
// on this data is real follow-up work, not done in this pass (the fallback
// chain is on every reasoning call in the codebase; changing its order
// deserves its own dedicated, carefully-verified change, not a same-commit
// bundle with a new reporting function).
export interface ProviderPerformance {
  provider: string;
  calls: number;
  successRate: number | null; // null below the sample-size floor — same honesty pattern as buildIntuition()
  avgLatencyMs: number | null;
  evidence: string;
}

const PROVIDER_MIN_SAMPLE = 5; // same floor buildIntuition() uses — below this, a rate is noise, not evidence

export async function getProviderPerformance(windowHours = 168): Promise<ProviderPerformance[]> {
  const client = getClient();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("agent_performance_metrics")
    .select("provider, success, latency_ms")
    .eq("agent_id", "founder-brain")
    .gte("created_at", since)
    .limit(2000);

  const rows = data ?? [];
  const byProvider = new Map<string, { calls: number; success: number; latencySum: number; latencyCount: number }>();
  for (const r of rows as Array<{ provider: string | null; success: boolean; latency_ms: number | null }>) {
    const p = r.provider ?? "unknown";
    const e = byProvider.get(p) ?? { calls: 0, success: 0, latencySum: 0, latencyCount: 0 };
    e.calls++;
    if (r.success) e.success++;
    if (r.latency_ms != null) { e.latencySum += r.latency_ms; e.latencyCount++; }
    byProvider.set(p, e);
  }

  return Array.from(byProvider.entries()).map(([provider, e]) => {
    const belowFloor = e.calls < PROVIDER_MIN_SAMPLE;
    return {
      provider,
      calls: e.calls,
      successRate: belowFloor ? null : Math.round((e.success / e.calls) * 100),
      avgLatencyMs: e.latencyCount > 0 ? Math.round(e.latencySum / e.latencyCount) : null,
      evidence: belowFloor
        ? `only ${e.calls} calls in the last ${windowHours}h — below the ${PROVIDER_MIN_SAMPLE}-call floor, not enough evidence to report a rate`
        : `${e.success} of ${e.calls} founder-brain calls succeeded in the last ${windowHours}h`,
    };
  }).sort((a, b) => b.calls - a.calls);
}
