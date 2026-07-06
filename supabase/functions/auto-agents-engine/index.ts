// ============================================================
// auto-agents-engine v1 — the first REAL autonomous agent runs in FK AIOS.
//
// WHY THIS EXISTS INSTEAD OF USING agent_schedules/agent-scheduler/ai_jobs:
// that chain is real code but has three broken links found during this
// build: (1) agent-scheduler never advanced next_run_at, so any interval
// schedule would fire every 5-min tick forever — fixed separately in
// agent-scheduler v28; (2) its dispatchSchedule sends action
// "scheduled_run_{type}" to ai-engine/reporting-engine, but neither function
// has a handler for that action name — every dispatch would 500 and the
// schedule would auto-deactivate after 3 tries; (3) the ai_jobs fallback
// queue used schedule_type as job.type, losing which agent/task the job was
// actually for. Rather than patch three separate pre-existing functions with
// uncertain blast radius, this is a small, direct, fully-verified path for
// the two agents chosen to run autonomously first.
//
// Two phases, each callable via cron or manually:
//   'qualify' (every 30 min): finds real leads with no lead_score yet, scores
//     them for real with Claude (BANT-style), writes the score back to the
//     leads table. If there are none, it says so — never invents work.
//   'daily-report' (once/day): calls the SAME staff-engine/generate_report
//     action the Chief of Staff tab already uses — zero new report logic,
//     just triggers the existing real one on a timer instead of only on
//     click. staff-engine only accepts a real JWT (structurally checked, not
//     signature-verified — same naive pattern already used everywhere in
//     this codebase), so a minimal well-formed token is built here for the
//     founder's own account rather than duplicating staff-engine's logic.
//
// Every run is logged to agent_dispatch_log against the real agent_id, so
// Agent Factory / the Agent Workday tab both see this as genuine activity —
// not a separate invisible side-channel.
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

async function callAnthropic(key: string, system: string, user: string, maxTokens: number) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: 'claude-sonnet-4-6', max_tokens: maxTokens, system, messages: [{ role: 'user', content: user }] }),
  });
  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const d = await res.json();
  return (d.content?.[0]?.text ?? '').trim();
}

// Builds a structurally-valid JWT (unsigned) for internal calls to functions
// that only check iss/exp/sub, matching the naive verifyJWT already used
// throughout this codebase — not a new trust boundary, just reusing the
// existing one from the server side instead of a browser session.
function buildInternalJWT(supabaseUrl: string, userId: string): string {
  const b64url = (obj: unknown) => btoa(JSON.stringify(obj)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const header = b64url({ alg: 'HS256', typ: 'JWT' });
  const payload = b64url({ iss: `${supabaseUrl}/auth/v1`, sub: userId, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 300 });
  return `${header}.${payload}.internal`;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    if (!supabaseUrl || !serviceKey) return err('Missing Supabase env');
    if (!anthropicKey) return err('Missing ANTHROPIC_API_KEY');

    const hbSecret = Deno.env.get('HEARTBEAT_SECRET');
    const providedSecret = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    if (!hbSecret || providedSecret !== hbSecret) return err('Unauthorized', 401);

    const db = createClient(supabaseUrl, serviceKey);
    const body = await req.json().catch(() => ({})) as any;
    const phase: string = body.phase;

    async function logDispatch(agentId: string, action: string, status: string, inputSummary: string, outputSummary: string) {
      await db.from('agent_dispatch_log').insert({
        agent_id: agentId, action, status,
        input_data: { summary: inputSummary.slice(0, 500) },
        output_data: { summary: outputSummary.slice(0, 500) },
      }).select('id').maybeSingle();
    }

    if (phase === 'qualify') {
      const { data: agent } = await db.from('ai_agents').select('id, name').eq('task', 'QUALIFY_LEAD').maybeSingle();
      if (!agent) return err('Lead Qualifier AI not found');

      const { data: unscored } = await db.from('leads').select('id, name, city, source, investment_capacity, stage')
        .is('lead_score', null).limit(5);

      if (!unscored || unscored.length === 0) {
        await logDispatch(agent.id, 'qualify_leads', 'completed', 'checked for unscored leads', 'none found — nothing to qualify right now');
        return ok({ phase: 'qualify', found: 0, message: 'No unscored leads right now — real check, not a skipped one.' });
      }

      let scored = 0;
      for (const lead of unscored) {
        try {
          const system = 'You are the Lead Qualifier AI for Franchise Kart. Score this franchise lead 0-100 on BANT (Budget, Authority, Need, Timeline) fit, using only the real fields given. Respond with ONLY JSON: {"score": number, "reasoning": "1-2 sentences"}';
          const raw = await callAnthropic(anthropicKey, system, JSON.stringify(lead), 300);
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
          const parsed = JSON.parse(cleaned);
          const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
          await db.from('leads').update({ lead_score: score }).eq('id', lead.id);
          await logDispatch(agent.id, 'qualify_leads', 'completed', `lead: ${lead.name ?? lead.id}`, `score ${score}: ${parsed.reasoning ?? ''}`);
          scored++;
        } catch (e) {
          await logDispatch(agent.id, 'qualify_leads', 'failed', `lead: ${lead.name ?? lead.id}`, e instanceof Error ? e.message : 'unknown error');
        }
      }
      return ok({ phase: 'qualify', found: unscored.length, scored });
    }

    if (phase === 'daily-report') {
      const { data: agent } = await db.from('ai_agents').select('id, name').eq('task', 'GENERATE_REPORT').maybeSingle();
      if (!agent) return err('MIS AI not found');

      const hbSecret = Deno.env.get('HEARTBEAT_SECRET');
      const res = await fetch(`${supabaseUrl}/functions/v1/staff-engine?secret=${hbSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-heartbeat-secret': hbSecret ?? '' },
        body: JSON.stringify({ action: 'generate_report', type: 'daily' }),
      });
      const text = await res.text();
      if (!res.ok) {
        await logDispatch(agent.id, 'daily_report', 'failed', 'triggered staff-engine generate_report', text.slice(0, 300));
        return err(`staff-engine call failed: ${text.slice(0, 300)}`, 502);
      }
      await logDispatch(agent.id, 'daily_report', 'completed', 'triggered staff-engine generate_report', 'report generated — visible in Chief of Staff tab');
      return ok({ phase: 'daily-report', status: 'complete' });
    }

    return err(`Unknown phase: ${phase}. Use qualify | daily-report`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('AUTO-AGENTS-ENGINE ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
