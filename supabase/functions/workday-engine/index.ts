/// <reference lib="deno.ns" />
// ============================================================
// workday-engine v3 — agent workday routine, resource-routed.
//
// v3 (9 Oct 2026): brought back in line with the deployed v22 (founder
// principles in every phase) and moved off the hard-wired Anthropic →
// gemini-2.5-flash pair. On 9 Oct the morning phase failed for all 41 agents
// (Anthropic has no credit; the fixed Gemini model failed too) and the reason
// was never recorded. Every call now goes through FKAIOS resource selection
// (policy order, health, verified learning) with the output schema enforced,
// and a failure is logged with its reason.
//
// Phases (pg_cron, IST business hours): 'morning' plan, 'midday' check-in,
// 'evening' submission (all grounded in the agent's real dispatch activity —
// never invented), and one grouped 'ceo' review. Re-runs are idempotent.
// ============================================================
import { createClient } from "npm:@supabase/supabase-js@2.57.4";
import { authenticateCaller, timingSafeEqual } from "../_shared/internal-auth.ts";
import { routedStructuredCall } from "../_shared/structured-reasoning.ts";

const ENGINE = "workday-engine";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-heartbeat-secret", "Access-Control-Allow-Methods": "POST, OPTIONS", "Content-Type": "application/json" };
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

interface LLMResult { value: Record<string, unknown>; model: string | null; inputTokens: number; outputTokens: number; costUsd: number }

const schema = (name: string, properties: Record<string, unknown>, required: string[]) => ({ name, description: "The ONLY way to answer.", input_schema: { type: "object", properties, required } });
const PLAN = schema("emit_plan", { plan: { type: "string", description: "2-4 sentences" }, tasks_planned: { type: "integer" } }, ["plan", "tasks_planned"]);
const CHECKIN = schema("emit_checkin", { update: { type: "string", description: "1-3 sentences" }, on_track: { type: "boolean" } }, ["update", "on_track"]);
const SUBMIT = schema("emit_submission", { summary: { type: "string", description: "2-4 sentences" }, self_rating: { type: "integer" }, tasks_completed: { type: "integer" } }, ["summary", "self_rating", "tasks_completed"]);
const REVIEW = schema("emit_review", {
  summary: { type: "string", description: "3-5 sentence founder briefing" },
  blockers: { type: "string", description: "company-wide blockers, or empty string" },
  per_agent: { type: "array", items: { type: "object", properties: { agent_id: { type: "string" }, manager_rating: { type: "integer" }, manager_feedback: { type: "string" } }, required: ["agent_id", "manager_rating", "manager_feedback"] } },
  top_performers: { type: "array", items: { type: "object", properties: { agent_id: { type: "string" }, name: { type: "string" }, reason: { type: "string" } } } },
  underperformers: { type: "array", items: { type: "object", properties: { agent_id: { type: "string" }, name: { type: "string" }, reason: { type: "string" } } } },
}, ["summary", "per_agent"]);

class RoutedCallError extends Error {}

// deno-lint-ignore no-explicit-any
async function callLLM(db: any, system: string, user: string, toolSchema: ReturnType<typeof schema>, maxTokens: number): Promise<LLMResult> {
  const r = await routedStructuredCall(db, { engine: ENGINE, taskClass: "writing", system, user, toolSchema, maxTokens });
  if (!r.ok || !r.input) throw new RoutedCallError(r.failure ?? "no schema-valid answer");
  return { value: r.input, model: r.resourceRef, inputTokens: r.inputTokens, outputTokens: r.outputTokens, costUsd: r.costUsd };
}

function todayIST(): string {
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

// deno-lint-ignore no-explicit-any
async function getFounderPrinciplesBlock(db: any, agentName: string): Promise<string> {
  try {
    const { data, error } = await db.from("founder_principles").select("principle, weight, applies_to").eq("active", true).order("weight", { ascending: false });
    if (error || !data) return "";
    // deno-lint-ignore no-explicit-any
    const relevant = data.filter((p: any) => Array.isArray(p.applies_to) && (p.applies_to.includes("*") || p.applies_to.includes(agentName)));
    if (relevant.length === 0) return "";
    // deno-lint-ignore no-explicit-any
    return `\n\n=== FOUNDER OPERATING PRINCIPLES (non-negotiable — apply these to every response below) ===\n${relevant.map((p: any) => `- ${p.principle}`).join("\n")}\n=== END FOUNDER OPERATING PRINCIPLES ===`;
  } catch { return ""; }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY");
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!supabaseUrl || !supabaseAnon) return err("Missing Supabase env");

    const hbSecret = Deno.env.get("HEARTBEAT_SECRET");
    const providedSecret = req.headers.get("x-heartbeat-secret") ?? new URL(req.url).searchParams.get("secret");
    // deno-lint-ignore no-explicit-any
    let db: any;
    // The query-string secret is still read because the pg_cron jobs send it
    // that way until the rotation + header cutover in
    // docs/FKAIOS_P0_CRON_SECRET_PLAN.md. Any other caller must be proven:
    // previously any "Bearer <anything>" passed, and with gateway JWT
    // verification off for this function that let anyone start a workday run.
    if (hbSecret && providedSecret && serviceKey && timingSafeEqual(providedSecret, hbSecret)) {
      db = createClient(supabaseUrl, serviceKey);
    } else {
      const authClient = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
      const auth = await authenticateCaller(req.headers.get("Authorization"), {
        serviceKeys: [serviceKey, Deno.env.get("SUPABASE_SECRET_KEY")],
        getUser: async (token) => {
          const { data, error } = await authClient.auth.getUser(token);
          return error || !data?.user ? null : { id: data.user.id };
        },
      });
      if (!auth.ok) return err("Unauthorized", 401);
      db = auth.caller.kind === "service"
        ? createClient(supabaseUrl, serviceKey!)
        : createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: `Bearer ${auth.caller.token}` } } });
    }
    // Resource selection and evidence rows need the service role; the caller was authenticated above.
    const routerDb = serviceKey ? createClient(supabaseUrl, serviceKey) : db;

    // deno-lint-ignore no-explicit-any
    const body = await req.json().catch(() => ({})) as any;
    const phase: string = body.phase;
    const workDate: string = body.work_date ?? todayIST();

    async function logStep(agentName: string, action: string, status: string, r?: LLMResult, latencyMs?: number, failure?: string) {
      try {
        await db.from("execution_log").insert({
          function_name: ENGINE, action, status, input_summary: agentName.slice(0, 500),
          output_summary: failure ? `failed: ${failure}`.slice(0, 500) : "", model: r?.model ?? null,
          input_tokens: r?.inputTokens ?? null, output_tokens: r?.outputTokens ?? null, cost_estimate_inr: null, latency_ms: latencyMs ?? null,
        });
      } catch (_) { /* logging must never break a phase */ }
    }
    const reason = (e: unknown) => (e instanceof Error ? e.message : String(e)).slice(0, 400);

    async function realActivityCount(agentId: string): Promise<number> {
      const { count } = await db.from("agent_dispatch_log").select("id", { count: "exact", head: true }).eq("agent_id", agentId).gte("created_at", `${workDate}T00:00:00Z`).lt("created_at", `${workDate}T23:59:59Z`);
      return count ?? 0;
    }

    const { data: roster, error: rosterErr } = await db
      .from("agent_role_charter")
      .select("agent_id, job_title, responsibilities, kpi_name, kpi_target, kpi_unit, reports_to, ai_agents!agent_role_charter_agent_id_fkey!inner(id, name, is_active)")
      .eq("ai_agents.is_active", true);
    if (rosterErr) return err(`Roster load failed: ${rosterErr.message}`);
    if (!roster || roster.length === 0) return err("No agent charters found — seed agent_role_charter first");

    if (phase === "morning") {
      const principlesBlock = await getFounderPrinciplesBlock(db, ENGINE);
      let done = 0, failed = 0;
      const failures: string[] = [];
      for (const agent of roster) {
        const t0 = Date.now();
        const name = agent.ai_agents.name;
        try {
          const { data: existing } = await db.from("agent_workday").select("id").eq("agent_id", agent.agent_id).eq("work_date", workDate).maybeSingle();
          if (existing) continue;
          const { data: yesterday } = await db.from("agent_workday").select("manager_feedback, self_rating").eq("agent_id", agent.agent_id).lt("work_date", workDate).order("work_date", { ascending: false }).limit(1).maybeSingle();
          const system = `You are "${name}", ${agent.job_title} at Franchise Kart's FK AIOS.\nResponsibilities: ${(agent.responsibilities ?? []).join("; ")}\nYour KPI target: ${agent.kpi_target} ${agent.kpi_unit}.\n${yesterday?.manager_feedback ? `Yesterday's manager feedback: ${yesterday.manager_feedback}` : "No prior feedback yet."}\n\nWrite a short, concrete plan for today. Do not invent numbers you cannot back up.${principlesBlock}`;
          const r = await callLLM(routerDb, system, "Write today's plan.", PLAN, 400);
          await db.from("agent_workday").insert({ agent_id: agent.agent_id, work_date: workDate, status: "planned", morning_plan: String(r.value.plan ?? ""), tasks_planned: Number(r.value.tasks_planned) || 0 });
          await logStep(name, "morning_plan", "success", r, Date.now() - t0);
          done++;
        } catch (e) {
          await logStep(name, "morning_plan", "failure", undefined, Date.now() - t0, reason(e));
          failures.push(reason(e));
          failed++;
        }
      }
      return ok({ phase: "morning", work_date: workDate, agents: roster.length, done, failed, first_failure: failures[0] ?? null });
    }

    if (phase === "midday") {
      const principlesBlock = await getFounderPrinciplesBlock(db, ENGINE);
      let done = 0, failed = 0;
      const failures: string[] = [];
      for (const agent of roster) {
        const t0 = Date.now();
        const name = agent.ai_agents.name;
        try {
          const { data: wd } = await db.from("agent_workday").select("*").eq("agent_id", agent.agent_id).eq("work_date", workDate).maybeSingle();
          if (!wd || wd.status !== "planned") continue;
          const activity = await realActivityCount(agent.agent_id);
          const system = `You are "${name}", ${agent.job_title}. Your plan for today was: "${wd.morning_plan}". Your KPI target is ${agent.kpi_target} ${agent.kpi_unit}. Real system activity logged under your name so far today: ${activity}. Report honestly whether you are on track — if activity is 0, say so plainly rather than inventing progress.${principlesBlock}`;
          const r = await callLLM(routerDb, system, "Give your midday check-in.", CHECKIN, 300);
          await db.from("agent_workday").update({ status: "midday_checked", midday_update: String(r.value.update ?? ""), midday_on_track: !!r.value.on_track, real_activity_count: activity, updated_at: new Date().toISOString() }).eq("id", wd.id);
          await logStep(name, "midday_checkin", "success", r, Date.now() - t0);
          done++;
        } catch (e) {
          await logStep(name, "midday_checkin", "failure", undefined, Date.now() - t0, reason(e));
          failures.push(reason(e));
          failed++;
        }
      }
      return ok({ phase: "midday", work_date: workDate, agents: roster.length, done, failed, first_failure: failures[0] ?? null });
    }

    if (phase === "evening") {
      const principlesBlock = await getFounderPrinciplesBlock(db, ENGINE);
      let done = 0, failed = 0;
      const failures: string[] = [];
      for (const agent of roster) {
        const t0 = Date.now();
        const name = agent.ai_agents.name;
        try {
          const { data: wd } = await db.from("agent_workday").select("*").eq("agent_id", agent.agent_id).eq("work_date", workDate).maybeSingle();
          if (!wd || wd.status !== "midday_checked") continue;
          const activity = await realActivityCount(agent.agent_id);
          const system = `You are "${name}", ${agent.job_title}. Plan: "${wd.morning_plan}". Midday update: "${wd.midday_update}". KPI target: ${agent.kpi_target} ${agent.kpi_unit}. Real logged activity today: ${activity}. Write your end-of-day submission and rate your own day 1-10 — an honest low rating on a quiet day (e.g. zero real leads to work) is expected and correct, do not inflate it.${principlesBlock}`;
          const r = await callLLM(routerDb, system, "Submit your end-of-day report.", SUBMIT, 400);
          await db.from("agent_workday").update({ status: "submitted", evening_summary: String(r.value.summary ?? ""), self_rating: Math.max(1, Math.min(10, Number(r.value.self_rating) || 5)), tasks_completed: Number(r.value.tasks_completed) || 0, real_activity_count: activity, updated_at: new Date().toISOString() }).eq("id", wd.id);
          await logStep(name, "evening_submit", "success", r, Date.now() - t0);
          done++;
        } catch (e) {
          await logStep(name, "evening_submit", "failure", undefined, Date.now() - t0, reason(e));
          failures.push(reason(e));
          failed++;
        }
      }
      return ok({ phase: "evening", work_date: workDate, agents: roster.length, done, failed, first_failure: failures[0] ?? null });
    }

    if (phase === "ceo") {
      const t0 = Date.now();
      const { data: submitted } = await db.from("agent_workday").select("id, agent_id, morning_plan, midday_update, evening_summary, self_rating, tasks_planned, tasks_completed, real_activity_count").eq("work_date", workDate).eq("status", "submitted");
      if (!submitted || submitted.length === 0) return ok({ phase: "ceo", work_date: workDate, message: "No submitted workdays yet for this date." });
      // deno-lint-ignore no-explicit-any
      const byAgent = new Map(roster.map((a: any) => [a.agent_id, a]));
      // deno-lint-ignore no-explicit-any
      const rows = submitted.map((s: any) => {
        // deno-lint-ignore no-explicit-any
        const charter: any = byAgent.get(s.agent_id);
        return `AGENT_ID: ${s.agent_id}\nNAME: ${charter?.ai_agents.name}\nROLE: ${charter?.job_title}\nKPI TARGET: ${charter?.kpi_target} ${charter?.kpi_unit}\nTASKS COMPLETED: ${s.tasks_completed}/${s.tasks_planned}\nREAL ACTIVITY LOGGED: ${s.real_activity_count}\nSELF-RATING: ${s.self_rating}/10\nSUMMARY: ${s.evening_summary}`;
      }).join("\n\n---\n\n");
      const principlesBlock = await getFounderPrinciplesBlock(db, "ceo-ai");
      const system = `You are the Chief Executive AI reviewing today's work across Franchise Kart's FK AIOS team. Judge each agent against its OWN kpi target and real logged activity — not against each other's absolute numbers, since departments differ wildly in expected volume. An agent with zero real leads to work is not a poor performer if the company itself had zero leads that day; say so. Do not invent achievements.${principlesBlock}`;
      let r: LLMResult;
      try {
        r = await callLLM(routerDb, system, `Today's submitted workdays (${submitted.length} agents):\n\n${rows}`, REVIEW, 6000);
      } catch (e) {
        await logStep("CEO AI", "ceo_briefing", "failure", undefined, Date.now() - t0, reason(e));
        return err(`CEO briefing failed: ${reason(e)}`, 502);
      }
      // deno-lint-ignore no-explicit-any
      const parsed = r.value as any;
      for (const pa of parsed.per_agent ?? []) {
        await db.from("agent_workday").update({ manager_rating: Math.max(1, Math.min(10, Number(pa.manager_rating) || 5)), manager_feedback: String(pa.manager_feedback ?? "").slice(0, 1000), updated_at: new Date().toISOString() }).eq("agent_id", pa.agent_id).eq("work_date", workDate);
      }
      const { count: leadsToday } = await db.from("leads").select("id", { count: "exact", head: true }).gte("created_at", `${workDate}T00:00:00Z`);
      await db.from("ceo_daily_briefing").upsert({ work_date: workDate, summary: parsed.summary, blockers: parsed.blockers ?? null, top_performers: parsed.top_performers ?? [], underperformers: parsed.underperformers ?? [], company_kpi_snapshot: { agents_reporting: submitted.length, agents_total: roster.length, leads_today: leadsToday ?? 0 } }, { onConflict: "work_date" });
      await logStep("CEO AI", "ceo_briefing", "success", r, Date.now() - t0);
      return ok({ phase: "ceo", work_date: workDate, agents_reviewed: submitted.length, model: r.model });
    }

    return err(`Unknown phase: ${phase}. Use morning | midday | evening | ceo`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log("WORKDAY-ENGINE ERROR", msg);
    return err(`Uncaught: ${msg}`);
  }
});
