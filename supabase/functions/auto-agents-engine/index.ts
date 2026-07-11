// ============================================================
// auto-agents-engine v6 — multi-company autonomous agent runs.
//
// v6 PIPELINE REPAIR (Founder Directive — commercial pipeline root cause):
//   The 'qualify' phase selected a non-existent column `name` from `leads`
//   (real columns are company_name / contact_name). PostgREST returned an
//   error + null data, which the old code treated as "no unscored leads" —
//   so it logged "none found — nothing to qualify" on all 251 runs while 60
//   null-score leads sat untouched. Root cause fixed: correct columns, and
//   query errors are now surfaced (status 'failed') instead of masked as
//   "none found". Additionally, a qualified lead (score >= 40, matching
//   auto-pilot's own bar) is advanced 'new' -> 'contacted' so it enters
//   auto-pilot's EXISTING nurture -> qualified -> proposal flow (ai_discovery
//   leads were otherwise never promoted out of 'new'). Reuse, not parallel.
//
// v5 notes preserved: hunt-leads supports Franchise Kart + Aura Tech and
// rotates ToS-compliant Google-indexed public-post queries via the Google
// Search Scraper actor. daily-report triggers staff-engine. Every run logs to
// agent_dispatch_log against the real agent_id.
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

      // ROOT-CAUSE FIX: real columns (was `name`, which does not exist ->
      // silent error -> perpetual "none found"). Errors are now surfaced.
      const { data: unscored, error: unscoredErr } = await db.from('leads')
        .select('id, company_name, contact_name, city, source, investment_capacity, contact_phone, contact_email, stage')
        .is('lead_score', null).eq('is_active', true).limit(5);

      if (unscoredErr) {
        await logDispatch(agent.id, 'qualify_leads', 'failed', 'select unscored leads', `query error: ${unscoredErr.message}`);
        return err(`unscored select failed: ${unscoredErr.message}`, 500);
      }
      if (!unscored || unscored.length === 0) {
        await logDispatch(agent.id, 'qualify_leads', 'completed', 'checked for unscored leads', 'none found — nothing to qualify right now');
        return ok({ phase: 'qualify', found: 0, message: 'No unscored leads right now — real check, not a skipped one.' });
      }

      let scored = 0, advanced = 0;
      for (const lead of unscored) {
        const label = lead.company_name ?? lead.contact_name ?? lead.id;
        try {
          const system = 'You are the Lead Qualifier AI for Franchise Kart. Score this franchise lead 0-100 on BANT (Budget, Authority, Need, Timeline) fit, using ONLY the real fields given. Missing contact details (no phone, no email, no city, no stated investment capacity) mean low Authority/Budget confidence — score honestly and low for thin, uncontactable leads. Respond with ONLY JSON: {"score": number, "reasoning": "1-2 sentences"}';
          const raw = await callAnthropic(anthropicKey, system, JSON.stringify(lead), 300);
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/```\s*$/i, '');
          const parsed = JSON.parse(cleaned);
          const score = Math.max(0, Math.min(100, Number(parsed.score) || 0));
          // Advance into auto-pilot's EXISTING nurture flow at the same >=40
          // bar auto-pilot uses; thin/junk leads correctly stay in 'new'.
          const nextStage = score >= 40 ? 'contacted' : lead.stage;
          const upd: Record<string, unknown> = { lead_score: score, updated_at: new Date().toISOString() };
          if (nextStage !== lead.stage) upd.stage = nextStage;
          await db.from('leads').update(upd).eq('id', lead.id);
          if (nextStage !== lead.stage) advanced++;
          await logDispatch(agent.id, 'qualify_leads', 'completed', `lead: ${label}`,
            `score ${score}${nextStage !== lead.stage ? ` -> ${nextStage}` : ''}: ${parsed.reasoning ?? ''}`);
          scored++;
        } catch (e) {
          await logDispatch(agent.id, 'qualify_leads', 'failed', `lead: ${label}`, e instanceof Error ? e.message : 'unknown error');
        }
      }
      return ok({ phase: 'qualify', found: unscored.length, scored, advanced });
    }

    if (phase === 'daily-report') {
      const { data: agent } = await db.from('ai_agents').select('id, name').eq('task', 'GENERATE_REPORT').maybeSingle();
      if (!agent) return err('MIS AI not found');

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

    if (phase === 'hunt-leads') {
      const targetCompany: string = body.company === 'aura-tech' ? 'Aura Tech' : 'Franchise Kart';
      const { data: company } = await db.from('companies').select('id').eq('name', targetCompany).maybeSingle();
      const { data: agent } = await db.from('ai_agents').select('id, name').eq('task', 'CAPTURE_LEADS')
        .eq('company_id', company?.id ?? '').maybeSingle();
      if (!agent) return err(`Lead sourcing agent not found for ${targetCompany}`);

      const FK_TARGETS = [
        'chicken restaurant franchise opportunity India', 'construction chemicals distributor dealership India',
        'paint dealership franchise opportunity India', 'furniture showroom franchise India',
        'street food QSR franchise opportunity India', 'diagnostic lab franchise opportunity India',
      ];
      const AURA_TARGETS = [
        'small business needs website India', 'startup looking for app developer India',
        'clinic needs CRM software India', 'retail shop needs online store India',
        'real estate company needs CRM India', 'restaurant needs online ordering website India',
      ];
      const PLATFORM_PREFIXES = ['', 'site:instagram.com ', 'site:facebook.com ', 'site:youtube.com '];

      const targets = targetCompany === 'Aura Tech' ? AURA_TARGETS : FK_TARGETS;
      const dayIndex = Math.floor(Date.now() / 86400000);
      const baseQuery = targets[dayIndex % targets.length];
      const platformPrefix = PLATFORM_PREFIXES[dayIndex % PLATFORM_PREFIXES.length];
      const finalQuery = `${platformPrefix}${baseQuery}`;

      const res = await fetch(`${supabaseUrl}/functions/v1/lead-discovery?secret=${hbSecret}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-heartbeat-secret': hbSecret ?? '' },
        body: JSON.stringify({ action: 'discover', query: finalQuery, brand: targetCompany, requested_by: 'auto-agents-engine' }),
      });
      const text = await res.text();
      if (!res.ok) {
        await logDispatch(agent.id, 'hunt_leads', 'failed', finalQuery, text.slice(0, 300));
        return err(`lead-discovery call failed: ${text.slice(0, 300)}`, 502);
      }
      let parsed: any = {};
      try { parsed = JSON.parse(text); } catch {}
      await logDispatch(agent.id, 'hunt_leads', 'completed', finalQuery, `[${targetCompany}] inserted ${parsed.inserted ?? 0}, skipped ${parsed.skipped_duplicates ?? 0} duplicates, ${parsed.raw_results ?? 0} raw results`);
      return ok({ phase: 'hunt-leads', company: targetCompany, target: finalQuery, ...parsed });
    }

    return err(`Unknown phase: ${phase}. Use qualify | daily-report | hunt-leads`, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('AUTO-AGENTS-ENGINE ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
