import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { reason, getGoals, founderMemory, type Goal, getImaginationHistory, type ImaginationEntry, FOUNDER_BRAIN_DEPARTMENT, getFounderIdentity, getFounderPrinciples, type FounderIdentitySnapshot, type FounderPrincipleSnapshot } from "./founder-brain.ts";
import { CAPABILITY_REGISTRY } from "./company-os.ts";

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
    role: "general",
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
  } catch { }

  return { projectId: proj.id, tasksCreated: tasks.length };
}

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

export async function escalateBlocked(correlationId?: string): Promise<{ escalated: number }> {
  const client = getClient();
  const { data: stuckTasks } = await client.from("orchestration_tasks").select("id, project_id, title, attempts, status").gte("attempts", 2).neq("status", "done").neq("status", "approved");
  const { data: stuckProjects } = await client.from("orchestration_projects").select("id, request, status").eq("status", "reworking");

  let escalated = 0;
  const seenProjects = new Set<string>();

  for (const t of stuckTasks ?? []) {
    if (seenProjects.has(t.project_id)) continue;
    seenProjects.add(t.project_id);
    try {
      await client.from("approvals").insert({
        action_type: "escalation_blocked_task",
        payload: { project_id: t.project_id, task_id: t.id, title: t.title, attempts: t.attempts },
        risk_level: "medium",
        reason: `Task "${t.title}" has failed/reworked ${t.attempts} times without completing — escalated to the Founder Brain for a decision.`,
      });
      escalated++;
    } catch { }
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
    } catch { }
  }

  if (escalated > 0) {
    try {
      await founderMemory.episodic.append({ function_name: "executive-planner", action: "escalate_blocked", status: "success", output_summary: `${escalated} item(s) escalated` });
    } catch { }
  }

  return { escalated };
}

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

  if (evidenceCount === 0) return null;

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
    return null;
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
  } catch { }

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

const MIN_SAMPLE_SIZE = 5;

export interface IntuitionPattern {
  taskType: string;
  confidence: number;
  sampleSize: number;
  evidence: string;
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
    if (total < MIN_SAMPLE_SIZE) continue;
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
  } catch { }

  return patterns;
}

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
  claudeTokensConsumed: number | null;
  claudeTokensRemaining: "unavailable";
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
    caveat: "Reflects agent_performance_metrics — includes the Founder Brain's own reason() calls alongside every other engine that writes to this table. estimated_cost_usd is only populated where the writing engine computed it.",
  };
}

export interface ProviderPerformance {
  provider: string;
  calls: number;
  successRate: number | null;
  avgLatencyMs: number | null;
  evidence: string;
}

const PROVIDER_MIN_SAMPLE = 5;

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

export interface CapabilityGraphNode {
  id: string;
  description: string;
}

export interface CapabilityGraphEdge {
  from: string;
  to: string;
  weight: number | null;
  sampleSize: number;
  evidence: string;
}

export interface CapabilityGraph {
  nodes: CapabilityGraphNode[];
  edges: CapabilityGraphEdge[];
  builtAt: string;
}

export async function getCapabilityGraph(): Promise<CapabilityGraph> {
  const client = getClient();
  const nodes: CapabilityGraphNode[] = [];
  const edges: CapabilityGraphEdge[] = [];

  for (const [capabilityId, def] of Object.entries(CAPABILITY_REGISTRY)) {
    if (!def.verified) continue;
    nodes.push({ id: capabilityId, description: def.description });

    const { data } = await client.from("execution_log").select("status").eq("function_name", "company-os").eq("action", capabilityId).limit(200);
    const rows = data ?? [];
    const total = rows.length;
    const success = rows.filter((r: { status: string }) => r.status === "success").length;
    const belowFloor = total < 5;

    edges.push({
      from: capabilityId,
      to: def.edgeFunction,
      weight: belowFloor ? null : Math.round((success / total) * 100),
      sampleSize: total,
      evidence: belowFloor ? `only ${total} real dispatches logged — below the 5-call floor, no weight assigned` : `${success} of ${total} real dispatches succeeded`,
    });
  }

  nodes.push({ id: "reasoning", description: "Founder Brain reasoning — grounded, evidence-based thinking (reason())" });
  const reasoningProviders = await getProviderPerformance();
  for (const p of reasoningProviders) {
    edges.push({
      from: "reasoning",
      to: p.provider,
      weight: p.successRate,
      sampleSize: p.calls,
      evidence: p.evidence,
    });
  }

  return { nodes, edges, builtAt: new Date().toISOString() };
}

export interface AttentionItem {
  type: "approval" | "goal" | "learning" | "contradiction";
  description: string;
  urgency: "urgent" | "normal";
  reason: string;
}

export interface BrainState {
  currentGoals: Goal[];
  capabilityHealth: CapabilityGraph;
  confidence: IntuitionPattern[];
  recentReflection: Reflection | null;
  recentImagination: ImaginationEntry[];
  learningTrend: LearningTrend;
  intelligenceIndex: BrainIntelligenceIndex;
  importanceScores: ImportanceScore[];
  runningTasks: { pendingTasks: number; assignedTasks: number; pendingJobs: number; runningJobs: number };
  pendingApprovals: { total: number; highOrCritical: number };
  executiveAttention: AttentionItem[];
  computedAt: string;
}

export async function getLatestConfidenceState(userId: string): Promise<IntuitionPattern[]> {
  const rows = (await founderMemory.permanent.get(userId)) as Array<{ content?: { kind?: string; patterns?: IntuitionPattern[] } }> | null;
  if (!rows) return [];
  const intuitionEntries = rows.filter((r) => r.content?.kind === "intuition");
  if (intuitionEntries.length === 0) return [];
  return intuitionEntries[0].content?.patterns ?? [];
}

export async function getBrainState(userId = "founder"): Promise<BrainState> {
  const client = getClient();

  const [currentGoals, capabilityHealth, confidence, reflectionHistory, imaginationHistory, learningTrend, providerPerformance, taskCounts, jobCounts, approvalsData] = await Promise.all([
    getGoals(userId),
    getCapabilityGraph(),
    getLatestConfidenceState(userId),
    getReflectionHistory(userId),
    getImaginationHistory(userId),
    getLearningTrend(),
    getProviderPerformance(),
    client.from("orchestration_tasks").select("status").in("status", ["pending", "assigned"]),
    client.from("ai_jobs").select("status").in("status", ["pending", "running"]).eq("type", "work_engine_task"),
    client.from("approvals").select("id, risk_level").eq("status", "pending"),
  ]);
  const intelligenceIndex = computeBrainIntelligenceIndex(learningTrend, confidence, providerPerformance, currentGoals);
  const importanceScores = computeImportanceScores(reflectionHistory, learningTrend, currentGoals);

  const tasks = taskCounts.data ?? [];
  const jobs = jobCounts.data ?? [];
  const approvalsRows = (approvalsData.data ?? []) as Array<{ id: string; risk_level: string | null }>;
  const highRiskApprovals = approvalsRows.filter((a) => a.risk_level === "high" || a.risk_level === "critical");

  const executiveAttention: AttentionItem[] = [];
  for (const a of highRiskApprovals.slice(0, 3)) {
    executiveAttention.push({ type: "approval", description: `Pending ${a.risk_level}-risk approval (${a.id})`, urgency: "urgent", reason: "high/critical risk items outrank everything else the Brain is tracking" });
  }
  if (learningTrend.successRate !== null && learningTrend.successRate < 50) {
    executiveAttention.push({ type: "learning", description: `Recent execution success rate has dropped to ${learningTrend.successRate}% (${learningTrend.totalOutcomes} outcomes, last ${learningTrend.windowHours}h)`, urgency: "urgent", reason: "a declining success rate is evidence something in execution needs review, not just a number to report later" });
  }
  const contradictionScore = importanceScores.find((s) => s.source === "reflection" && s.signals.some((sig) => sig.includes("contradiction")));
  if (contradictionScore && contradictionScore.score >= 60) {
    const latestReflection = reflectionHistory.length > 0 ? reflectionHistory[reflectionHistory.length - 1] : null;
    executiveAttention.push({ type: "contradiction", description: latestReflection ? `The Brain found a contradiction: ${latestReflection.assumptionsWrong.slice(0, 150)}` : "A recent reflection contained a stated contradiction", urgency: "urgent", reason: `importance score ${contradictionScore.score}/100 — the Brain explicitly stated an assumption was wrong, the strongest salience signal available` });
  }
  if (executiveAttention.length === 0 && currentGoals.length > 0) {
    executiveAttention.push({ type: "goal", description: currentGoals[0].description, urgency: "normal", reason: "no urgent approvals pending — surfacing the top goal, not a ranked stalled-goal analysis this codebase can't yet support honestly" });
  }

  return {
    currentGoals,
    capabilityHealth,
    confidence,
    recentReflection: reflectionHistory.length > 0 ? reflectionHistory[reflectionHistory.length - 1] : null,
    recentImagination: imaginationHistory.slice(-3),
    learningTrend,
    intelligenceIndex,
    importanceScores,
    runningTasks: {
      pendingTasks: tasks.filter((t: { status: string }) => t.status === "pending").length,
      assignedTasks: tasks.filter((t: { status: string }) => t.status === "assigned").length,
      pendingJobs: jobs.filter((j: { status: string }) => j.status === "pending").length,
      runningJobs: jobs.filter((j: { status: string }) => j.status === "running").length,
    },
    pendingApprovals: { total: approvalsRows.length, highOrCritical: highRiskApprovals.length },
    executiveAttention,
    computedAt: new Date().toISOString(),
  };
}

export interface LearningTrend {
  windowHours: number;
  totalOutcomes: number;
  successRate: number | null;
}

const LEARNING_MIN_SAMPLE = 5;

export async function getLearningTrend(windowHours = 24): Promise<LearningTrend> {
  const client = getClient();
  const since = new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from("fleet_memory")
    .select("confidence")
    .eq("source_department", FOUNDER_BRAIN_DEPARTMENT)
    .eq("memory_type", "learning")
    .gte("created_at", since)
    .limit(2000);
  const rows = data ?? [];
  if (rows.length < LEARNING_MIN_SAMPLE) {
    return { windowHours, totalOutcomes: rows.length, successRate: null };
  }
  const confidences = rows.map((r: { confidence: number | null }) => r.confidence ?? 0);
  const avg = confidences.reduce((a: number, b: number) => a + b, 0) / confidences.length;
  return { windowHours, totalOutcomes: rows.length, successRate: Math.round(avg) };
}

export interface BrainIntelligenceIndex {
  learning: { score: number | null; basis: string };
  confidence: { score: number | null; basis: string };
  executionReliability: { score: number | null; basis: string };
  missionAlignment: { score: number | null; basis: string };
  unmeasured: string[];
  computedAt: string;
}

export function computeBrainIntelligenceIndex(learningTrend: LearningTrend, patterns: IntuitionPattern[], providers: ProviderPerformance[], goals: Goal[]): BrainIntelligenceIndex {
  const confidenceScores = patterns.filter((p) => p.confidence !== null).map((p) => p.confidence as number);
  const avgConfidence = confidenceScores.length > 0 ? Math.round(confidenceScores.reduce((a, b) => a + b, 0) / confidenceScores.length) : null;

  const providerRates = providers.filter((p) => p.successRate !== null).map((p) => p.successRate as number);
  const avgProviderReliability = providerRates.length > 0 ? Math.round(providerRates.reduce((a, b) => a + b, 0) / providerRates.length) : null;

  const milestoneKeywords = ["5 crore", "1,100 crore", "1100 crore"];
  const milestonesPresent = milestoneKeywords.filter((kw) => goals.some((g) => g.description.toLowerCase().includes(kw))).length;
  const missionAlignmentScore = goals.length > 0 ? Math.round((Math.min(milestonesPresent, 2) / 2) * 100) : null;

  return {
    learning: { score: learningTrend.successRate, basis: learningTrend.successRate !== null ? `${learningTrend.totalOutcomes} real outcomes, last 24h` : `only ${learningTrend.totalOutcomes} outcomes recorded — below the evidence floor` },
    confidence: { score: avgConfidence, basis: confidenceScores.length > 0 ? `averaged across ${confidenceScores.length} task-type patterns with sufficient sample size` : "no task type has reached the 5-observation floor yet" },
    executionReliability: { score: avgProviderReliability, basis: providerRates.length > 0 ? `averaged across ${providerRates.length} reasoning providers with sufficient call history` : "no provider has reached the 5-call floor yet" },
    missionAlignment: { score: missionAlignmentScore, basis: goals.length > 0 ? `${milestonesPresent}/2 stated milestones (₹5 Cr, ₹1,100 Cr) present in the goal hierarchy` : "goal hierarchy is empty" },
    unmeasured: [
      "Thinking (produces text, not a score)", "Reasoning quality (no ground-truth to grade against)",
      "Prediction accuracy (predictions aren't checked against real outcomes yet)", "Planning quality (no completion-vs-plan comparison exists)",
      "Creativity/Curiosity (no evaluation criteria defined)", "Reflection quality (reflect() output isn't scored, only generated)",
      "Risk Awareness quality (assessedRisk exists but isn't checked against real incident outcomes)", "Self Awareness (Brain State exists but isn't itself scored)",
      "Wisdom (no long-horizon outcome-tracking exists to measure this against)",
    ],
    computedAt: new Date().toISOString(),
  };
}

export async function getBrainIntelligenceIndex(userId = "founder"): Promise<BrainIntelligenceIndex> {
  const [learningTrend, patterns, providers, goals] = await Promise.all([
    getLearningTrend(),
    buildIntuition(userId),
    getProviderPerformance(),
    getGoals(userId),
  ]);
  return computeBrainIntelligenceIndex(learningTrend, patterns, providers, goals);
}

export interface ImportanceScore {
  source: "reflection" | "learning_trend";
  score: number;
  signals: string[];
}

export function computeImportanceScores(reflectionHistory: Reflection[], trend: LearningTrend, goals: Goal[]): ImportanceScore[] {
  const scores: ImportanceScore[] = [];
  const milestoneKeywords = ["5 crore", "1,100 crore", "1100 crore"];
  const goalText = goals.map((g) => g.description.toLowerCase()).join(" ");
  const goalIsMilestoneRelevant = milestoneKeywords.some((kw) => goalText.includes(kw));

  const latestReflection = reflectionHistory.length > 0 ? reflectionHistory[reflectionHistory.length - 1] : null;
  if (latestReflection) {
    const signals: string[] = [];
    let score = 20;
    const hasContradiction = latestReflection.assumptionsWrong.trim().length > 0;
    if (hasContradiction) { score += 50; signals.push("contains a stated contradiction (assumptionsWrong is non-empty) — the strongest real signal available"); }
    if (goalIsMilestoneRelevant && (latestReflection.whatWorked + latestReflection.whatFailed).toLowerCase().match(/crore/)) { score += 15; signals.push("directly references a real milestone"); }
    if (signals.length === 0) signals.push("no contradiction or milestone reference found — baseline importance only");
    scores.push({ source: "reflection", score: Math.min(score, 100), signals });
  }

  if (trend.successRate !== null) {
    const distanceFromMiddle = Math.abs(trend.successRate - 50);
    const magnitudeScore = Math.round((distanceFromMiddle / 50) * 100);
    const signals = [`success rate ${trend.successRate}% is ${distanceFromMiddle < 15 ? "unremarkable, close to 50/50" : distanceFromMiddle < 35 ? "notably skewed" : "extreme — near-total success or failure"}`];
    scores.push({ source: "learning_trend", score: magnitudeScore, signals });
  }

  return scores;
}

export async function getImportanceScores(userId = "founder"): Promise<ImportanceScore[]> {
  const [reflectionHistory, trend, goals] = await Promise.all([
    getReflectionHistory(userId),
    getLearningTrend(),
    getGoals(userId),
  ]);
  return computeImportanceScores(reflectionHistory, trend, goals);
}

export interface PendingDecision {
  id: string;
  description: string;
  riskLevel: string | null;
  status: string;
  source: "approvals" | "orchestrator_requests";
}

export interface FounderIntelligenceContext {
  identity: FounderIdentitySnapshot | null;
  principles: FounderPrincipleSnapshot[];
  goals: Goal[];
  currentPriority: AttentionItem | null;
  pendingDecisions: PendingDecision[];
  risks: PendingDecision[];
  recentActivity: unknown[];
  computedAt: string;
}

async function fetchPendingDecisions(): Promise<{ pending: PendingDecision[]; risks: PendingDecision[] }> {
  const client = getClient();
  const [approvalsRes, requestsRes] = await Promise.all([
    client.from("approvals").select("id, action_type, reason, risk_level, status").eq("status", "pending").limit(20),
    client.from("orchestrator_requests").select("id, raw_request, risk_level, status").eq("status", "awaiting_approval").limit(20),
  ]);
  const pending: PendingDecision[] = [
    ...((approvalsRes.data ?? []) as Array<{ id: string; action_type: string; reason: string | null; risk_level: string | null; status: string }>)
      .map((a) => ({ id: a.id, description: a.reason ?? a.action_type, riskLevel: a.risk_level, status: a.status, source: "approvals" as const })),
    ...((requestsRes.data ?? []) as Array<{ id: string; raw_request: string; risk_level: string | null; status: string }>)
      .map((r) => ({ id: r.id, description: r.raw_request, riskLevel: r.risk_level, status: r.status, source: "orchestrator_requests" as const })),
  ];
  const risks = pending.filter((p) => p.riskLevel === "high" || p.riskLevel === "critical");
  return { pending, risks };
}

export async function buildFounderContext(userId = "founder"): Promise<FounderIntelligenceContext> {
  const client = getClient();
  const [identity, principles, goals, brainState, decisionData, activityRes] = await Promise.all([
    getFounderIdentity(),
    getFounderPrinciples(),
    getGoals(userId),
    getBrainState(userId),
    fetchPendingDecisions(),
    client.from("execution_log").select("function_name, action, status, created_at").order("created_at", { ascending: false }).limit(20),
  ]);
  return {
    identity,
    principles,
    goals,
    currentPriority: brainState.executiveAttention[0] ?? null,
    pendingDecisions: decisionData.pending,
    risks: decisionData.risks,
    recentActivity: activityRes.data ?? [],
    computedAt: new Date().toISOString(),
  };
}
