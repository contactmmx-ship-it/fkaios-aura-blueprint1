// ============================================================
// workday-engine v1 — autonomous agent workday simulation
//
// Runs in 4 scheduled phases (pg_cron, IST business hours) plus manual
// trigger from the UI:
//   09:00 IST — 'morning': each of the 27 agents writes a plan for the day,
//               grounded in its role_charter (job_title/responsibilities/KPI)
//               and yesterday's manager_feedback if any.
//   14:00 IST — 'midday': each agent checks real activity so far today
//               (from agent_dispatch_log, its own real dispatch history —
//               NOT invented busywork) against its plan and reports honestly
//               whether it's on track.
//   19:00 IST — 'evening': each agent submits a day summary + self-rating
//               (1-10), grounded in the same real activity count.
//   19:15 IST — 'ceo': ONE Claude call reads every submitted workday row +
//               charter, writes manager_rating + manager_feedback back onto
//               each agent_workday row, and produces the combined
//               ceo_daily_briefing. Doing this as one grouped review (rather
//               than 27 separate "manager" calls) is both cheaper and closer
//               to how a real manager reviews a team at day's end.
//
// Every phase uses the same Claude→Gemini fallback pattern as the other
// engines. No step fabricates activity counts — agents with zero real
// dispatch activity are told to report that honestly.
// ============================================================
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-heartbeat-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

const ANTHROPIC_MODEL = 'claude-sonnet-4-6';
const GEMINI_MODEL = 'gemini-2.5-flash';
const RATES: Record<string, { inp: number; out: number }> = {
  [ANTHROPIC_MODEL]: { inp: 270, out: 1350 },
  [GEMINI_MODEL]: { inp: 27, out: 220 },
};

interface LLMResult { text: string; inputTokens: number; outputTokens: number; model: string; fellBack: boolean; }

async function callAnthropic(key: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: ANTHROPIC_MODEL, max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Anthropic ${res.status}: ${t.slice(0, 300)}`); }
  const d = await res.json() as any;
  return { text: d.content?.[0]?.text ?? '', inputTokens: d.usage?.input_tokens ?? 0, outputTokens: d.usage?.output_tokens ?? 0, model: ANTHROPIC_MODEL, fellBack: false };
}

async function callGemini(key: string, system: string, user: string, maxTokens: number): Promise<LLMResult> {
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': key, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: system }] },
      contents: [{ role: 'user', parts: [{ text: user }] }],
      generationConfig: { maxOutputTokens: maxTokens + 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!res.ok) { const t = await res.text(); throw new Error(`Gemini ${res.status}: ${t.slice(0, 300)}`); }
  const d = await res.json() as any;
  const text = (d.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  return { text, inputTokens: d.usageMetadata?.promptTokenCount ?? 0, outputTokens: d.usageMetadata?.candidatesTokenCount ?? 0, model: GEMINI_MODEL, fellBack: false };
}

function makeLLM(anthropicKey: string | undefined, geminiKey: string | undefined) {
  return async (system: string, user: string, maxTokens: number): Promise<LLMResult> => {
    if (!anthropicKey && !geminiKey) throw new Error('Neither ANTHROPIC_API_KEY nor GEMINI_API_KEY is set');
    if (!anthropicKey) { const r = await callGemini(geminiKey!, system, user, maxTokens); return { ...r, fellBack: true }; }
    try { return await callAnthropic(anthropicKey, system, user, maxTokens); }
    catch (pe) {
      const pMsg = pe instanceof Error ? pe.message : String(pe);
      console.log('LLM FALLBACK to Gemini —', pMsg.slice(0, 200));
      if (!geminiKey) throw pe;
      try { const r = await callGemini(geminiKey, system, user, maxTokens); return { ...r, fellBack: true }; }
      catch (fe) { throw new Error(`Both providers failed. Primary: ${pMsg.slice(0, 200)} | Fallback: ${fe instanceof Error ? fe.message : String(fe)}`.slice(0, 450)); }
    }
  };
}

const costInr = (m: string, i: number, o: number) => { const r = RATES[m] ?? RATES[ANTHROPIC_MODEL]; return (i / 1e6) * r.inp + (o / 1e6) * r.out; };

function parseJson(raw: string): any {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw.trim();
  const start = s.indexOf('{');
  return JSON.parse(start > 0 ? s.slice(start) : s);
}

function todayIST(): string {
  // work_date is a calendar date in IST, not UTC, so 09:00/14:00/19:00 IST
  // cron runs (03:30/08:30/13:30 UTC) all land on the same IST day.
  const now = new Date(Date.now() + 5.5 * 3600 * 1000);
  return now.toISOString().slice(0, 10);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const geminiKey = Deno.env.get('GEMINI_API_KEY');
    if (!supabaseUrl || !supabaseAnon) return err('Missing Supabase env');
    if (!anthropicKey && !geminiKey) return err('Missing both ANTHROPIC_API_KEY and GEMINI_API_KEY');
    const callLLM = makeLLM(anthropicKey, geminiKey);

    const hbSecret = Deno.env.get('HEARTBEAT_SECRET');
    const providedSecret = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    let db: any;
    if (hbSecret && providedSecret === hbSecret && serviceKey) {
      db = createClient(supabaseUrl, serviceKey);
    } else {
      const authHeader = req.headers.get('Authorization') ?? '';
      if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
      db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });
    }

    const body = await req.json().catch(() => ({})) as any;
    const phase: string = body.phase;
    const workDate: string = body.work_date ?? todayIST();

    async function logStep(agentName: string, action: string, status: string, r?: LLMResult, latencyMs?: number) {
      try {
        await db.from('execution_log').insert({
          function_name: 'workday-engine', action, status, input_summary: agentName.slice(0, 500),
          output_summary: '', model: r?.model ?? null, input_tokens: r?.inputTokens ?? null,
          output_tokens: r?.outputTokens ?? null, cost_estimate_inr: r ? costInr(r.model, r.inputTokens, r.outputTokens) : null,
          latency_ms: latencyMs ?? null,
        });
      } catch (_) {}
    }

    // Real activity signal for an agent on workDate — counts actual
    // dispatch/execution rows, never invented.
    async function realActivityCount(agentId: string): Promise<number> {
      const { count } = await db.from('agent_dispatch_log').select('id', { count: 'exact', head: true })
        .eq('agent_id', agentId).gte('created_at', `${workDate}T00:00:00Z`).lt('created_at', `${workDate}T23:59:59Z`);
      return count ?? 0;
    }

    const { data: roster, error: rosterErr } = await db
      .from('agent_role_charter')
      .select('agent_id, job_title, responsibilities, kpi_name, kpi_target, kpi_unit, reports_to, ai_agents!agent_role_charter_agent_id_fkey!inner(id, name, is_active)')
      .eq('ai_agents.is_active', true);
    if (rosterErr) return err(`Roster load failed: ${rosterErr.message}`);
    if (!roster || roster.length === 0) return err('No agent charters found — seed agent_role_charter first');

    // ── PHASE: morning plan ──────────────────────────────────────────────
    if (phase === 'morning') {
      let done = 0, failed = 0;
      for (const agent of roster) {
        const t0 = Date.now();
        const name = agent.ai_agents.name;
        try {
          const { data: existing } = await db.from('agent_workday').select('id').eq('agent_id', agent.agent_id).eq('work_date', workDate).maybeSingle();
          if (existing) continue; // already planned today, skip (idempotent re-runs)

          const { data: yesterday } = await db.from('agent_workday').select('manager_feedback, self_rating')
            .eq('agent_id', agent.agent_id).lt('work_date', workDate).order('work_date', { ascending: false }).limit(1).maybeSingle();

          const system = `You are "${name}", ${agent.job_title} at Franchise Kart's FK AIOS.\nResponsibilities: ${(agent.responsibilities ?? []).join('; ')}\nYour KPI target: ${agent.kpi_target} ${agent.kpi_unit}.\n${yesterday?.manager_feedback ? `Yesterday's manager feedback: ${yesterday.manager_feedback}` : 'No prior feedback yet.'}\n\nWrite a short, concrete plan for today. Do not invent numbers you cannot back up. Respond with ONLY JSON: {"plan": "2-4 sentences", "tasks_planned": integer}`;
          const r = await callLLM(system, 'Write today\'s plan.', 400);
          let parsed: any;
          try { parsed = parseJson(r.text); } catch { parsed = { plan: r.text.slice(0, 500), tasks_planned: 0 }; }

          await db.from('agent_workday').insert({
            agent_id: agent.agent_id, work_date: workDate, status: 'planned',
            morning_plan: parsed.plan, tasks_planned: Number(parsed.tasks_planned) || 0,
          });
          await logStep(name, 'morning_plan', r.fellBack ? 'success_fallback' : 'success', r, Date.now() - t0);
          done++;
        } catch (e) {
          await logStep(name, 'morning_plan', 'failure', undefined, Date.now() - t0);
          failed++;
        }
      }
      return ok({ phase: 'morning', work_date: workDate, agents: roster.length, done, failed });
    }

    // ── PHASE: midday check-in ───────────────────────────────────────────
    if (phase === 'midday') {
      let done = 0, failed = 0;
      for (const agent of roster) {
        const t0 = Date.now();
        const name = agent.ai_agents.name;
        try {
          const { data: wd } = await db.from('agent_workday').select('*').eq('agent_id', agent.agent_id).eq('work_date', workDate).maybeSingle();
          if (!wd || wd.status !== 'planned') continue; // no plan yet, or already checked

          const activity = await realActivityCount(agent.agent_id);
          const system = `You are "${name}", ${agent.job_title}. Your plan for today was: "${wd.morning_plan}". Your KPI target is ${agent.kpi_target} ${agent.kpi_unit}. Real system activity logged under your name so far today: ${activity}. Report honestly whether you are on track — if activity is 0, say so plainly rather than inventing progress. Respond with ONLY JSON: {"update": "1-3 sentences", "on_track": true|false}`;
          const r = await callLLM(system, 'Give your midday check-in.', 300);
          let parsed: any;
          try { parsed = parseJson(r.text); } catch { parsed = { update: r.text.slice(0, 400), on_track: activity > 0 }; }

          await db.from('agent_workday').update({
            status: 'midday_checked', midday_update: parsed.update, midday_on_track: !!parsed.on_track,
            real_activity_count: activity, updated_at: new Date().toISOString(),
          }).eq('id', wd.id);
          await logStep(name, 'midday_checkin', r.fellBack ? 'success_fallback' : 'success', r, Date.now() - t0);
          done++;
        } catch (e) {
          await logStep(name, 'midday_checkin', 'failure', undefined, Date.now() - t0);
          failed++;
        }
      }
      return ok({ phase: 'midday', work_date: workDate, agents: roster.length, done, failed });
    }

    // ── PHASE: evening submission ────────────────────────────────────────
    if (phase === 'evening') {
      let done = 0, failed = 0;
      for (const agent of roster) {
        const t0 = Date.now();
        const name = agent.ai_agents.name;
        try {
          const { data: wd } = await db.from('agent_workday').select('*').eq('agent_id', agent.agent_id).eq('work_date', workDate).maybeSingle();
          if (!wd || wd.status !== 'midday_checked') continue;

          const activity = await realActivityCount(agent.agent_id);
          const system = `You are "${name}", ${agent.job_title}. Plan: "${wd.morning_plan}". Midday update: "${wd.midday_update}". KPI target: ${agent.kpi_target} ${agent.kpi_unit}. Real logged activity today: ${activity}. Write your end-of-day submission and rate your own day 1-10 — an honest low rating on a quiet day (e.g. zero real leads to work) is expected and correct, do not inflate it. Respond with ONLY JSON: {"summary": "2-4 sentences", "self_rating": number, "tasks_completed": integer}`;
          const r = await callLLM(system, 'Submit your end-of-day report.', 400);
          let parsed: any;
          try { parsed = parseJson(r.text); } catch { parsed = { summary: r.text.slice(0, 500), self_rating: activity > 0 ? 6 : 3, tasks_completed: 0 }; }

          await db.from('agent_workday').update({
            status: 'submitted', evening_summary: parsed.summary,
            self_rating: Math.max(1, Math.min(10, Number(parsed.self_rating) || 5)),
            tasks_completed: Number(parsed.tasks_completed) || 0, real_activity_count: activity,
            updated_at: new Date().toISOString(),
          }).eq('id', wd.id);
          await logStep(name, 'evening_submit', r.fellBack ? 'success_fallback' : 'success', r, Date.now() - t0);
          done++;
        } catch (e) {
          await logStep(name, 'evening_submit', 'failure', undefined, Date.now() - t0);
          failed++;
        }
      }
      return ok({ phase: 'evening', work_date: workDate, agents: roster.length, done, failed });
    }

    // ── PHASE: CEO roll-up + manager ratings ─────────────────────────────
    if (phase === 'ceo') {
      const t0 = Date.now();
      const { data: submitted } = await db.from('agent_workday').select('id, agent_id, morning_plan, midday_update, evening_summary, self_rating, tasks_planned, tasks_completed, real_activity_count')
        .eq('work_date', workDate).eq('status', 'submitted');
      if (!submitted || submitted.length === 0) return ok({ phase: 'ceo', work_date: workDate, message: 'No submitted workdays yet for this date.' });

      const byAgent = new Map(roster.map((a: any) => [a.agent_id, a]));
      const rows = submitted.map((s: any) => {
        const charter = byAgent.get(s.agent_id);
        return `AGENT_ID: ${s.agent_id}\nNAME: ${charter?.ai_agents.name}\nROLE: ${charter?.job_title}\nKPI TARGET: ${charter?.kpi_target} ${charter?.kpi_unit}\nTASKS COMPLETED: ${s.tasks_completed}/${s.tasks_planned}\nREAL ACTIVITY LOGGED: ${s.real_activity_count}\nSELF-RATING: ${s.self_rating}/10\nSUMMARY: ${s.evening_summary}`;
      }).join('\n\n---\n\n');

      const system = `You are the Chief Executive AI reviewing today's work across Franchise Kart's FK AIOS team. Judge each agent against its OWN kpi target and real logged activity — not against each other's absolute numbers, since departments differ wildly in expected volume. An agent with zero real leads to work is not a poor performer if the company itself had zero leads that day; say so. Do not invent achievements. Respond with ONLY JSON:\n{"summary": "3-5 sentence founder briefing", "blockers": "1-3 sentences on company-wide blockers, or empty string if none", "per_agent": [{"agent_id": "uuid", "manager_rating": number 1-10, "manager_feedback": "1-2 sentences, specific"}], "top_performers": [{"agent_id":"uuid","name":"string","reason":"string"}], "underperformers": [{"agent_id":"uuid","name":"string","reason":"string"}]}`;
      const r = await callLLM(system, `Today's submitted workdays (${submitted.length} agents):\n\n${rows}`, 6000);
      let parsed: any;
      try { parsed = parseJson(r.text); } catch { return err(`CEO briefing failed to parse LLM output: ${r.text.slice(0, 400)}`); }

      for (const pa of parsed.per_agent ?? []) {
        await db.from('agent_workday').update({
          manager_rating: Math.max(1, Math.min(10, Number(pa.manager_rating) || 5)),
          manager_feedback: String(pa.manager_feedback ?? '').slice(0, 1000),
          updated_at: new Date().toISOString(),
        }).eq('agent_id', pa.agent_id).eq('work_date', workDate);
      }

      const { count: leadsToday } = await db.from('leads').select('id', { count: 'exact', head: true }).gte('created_at', `${workDate}T00:00:00Z`);
      await db.from('ceo_daily_briefing').upsert({
        work_date: workDate, summary: parsed.summary, blockers: parsed.blockers ?? null,
        top_performers: parsed.top_performers ?? [], underperformers: parsed.underperformers ?? [],
        company_kpi_snapshot: { agents_reporting: submitted.length, agents_total: roster.length, leads_today: leadsToday ?? 0 },
      }, { onConflict: 'work_date' });

      await logStep('CEO AI', 'ceo_briefing', r.fellBack ? 'success_fallback' : 'success', r, Date.now() - t0);
      return ok({ phase: 'ceo', work_date: workDate, agents_reviewed: submitted.length, model: r.model });
    }

    return err(`Unknown phase: ${phase}. Use morning | midday | evening | ceo`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('WORKDAY-ENGINE ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
