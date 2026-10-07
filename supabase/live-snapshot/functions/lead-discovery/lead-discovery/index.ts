// LEAD-DISCOVERY v2 — fixes a real bug found 2026-07-08: leads were
// inserted with lead_score=0, which is NOT null, so auto-agents-engine's
// 'qualify' phase (real Claude BANT scoring, filters on lead_score IS NULL)
// silently never picked up a single AI-discovered lead. Every one only ever
// got auto-pilot's crude deterministic point score instead. Changed to
// insert lead_score=null so real AI qualification actually runs.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, x-heartbeat-secret',
  'Content-Type': 'application/json'
};
const ok = (d)=>new Response(JSON.stringify(d), {
    status: 200,
    headers: CORS
  });
const err = (m, s = 500)=>new Response(JSON.stringify({
    error: m
  }), {
    status: s,
    headers: CORS
  });
const MODEL = 'claude-sonnet-4-6';
function extractJson(raw) {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw.trim();
  const start = s.indexOf('{');
  return JSON.parse(start > 0 ? s.slice(start) : s);
}
function norm(s) {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}
Deno.serve(async (req)=>{
  if (req.method === 'OPTIONS') return new Response(null, {
    headers: CORS
  });
  const t0 = Date.now();
  try {
    const secret = Deno.env.get('HEARTBEAT_SECRET');
    const provided = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    const authHeader = req.headers.get('Authorization');
    if (secret && provided !== secret && !authHeader) return err('Unauthorized', 401);
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY'));
    const body = await req.json().catch(()=>({}));
    const action = body.action ?? 'status';
    async function logExec(actionName, status, inputSummary, outputSummary, error) {
      try {
        await db.from('execution_log').insert({
          function_name: 'lead-discovery',
          department_code: 'SALES',
          action: actionName,
          status,
          input_summary: inputSummary.slice(0, 500),
          output_summary: outputSummary.slice(0, 500),
          error: error?.slice(0, 500) ?? null,
          latency_ms: Date.now() - t0
        });
      } catch (_) {}
    }
    if (action === 'status') {
      const { count: discovered } = await db.from('leads').select('id', {
        count: 'exact',
        head: true
      }).eq('lead_source', 'ai_discovery');
      const { data: recentRuns } = await db.from('research_runs').select('id, query, status, result_count, created_at').order('created_at', {
        ascending: false
      }).limit(5);
      return ok({
        ai_discovered_leads_total: discovered ?? 0,
        recent_research_runs: recentRuns ?? [],
        scheduling: 'manual-trigger only — no cron wired to this function by design',
        note: 'Free check — no credits spent.'
      });
    }
    if (action !== 'discover' && action !== 'ingest') return err(`Unknown action: ${action}`, 400);
    if (!anthropicKey) return err('Missing ANTHROPIC_API_KEY');
    const requestedBy = body.requested_by ?? 'founder';
    const city = body.city ?? null;
    let brandId = null;
    if (body.brand) {
      const { data: b } = await db.from('brands').select('id, name').ilike('name', `%${body.brand}%`).limit(1).maybeSingle();
      brandId = b?.id ?? null;
    }
    let results = [];
    let runId = null;
    let query = '';
    if (action === 'discover') {
      query = body.query ?? '';
      if (!query.trim()) return err('query is required for discover', 400);
      const rRes = await fetch(`${supabaseUrl}/functions/v1/research-engine?secret=${secret}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          action: 'run',
          query,
          requested_by: requestedBy
        })
      });
      if (!rRes.ok) {
        const t = await rRes.text();
        await logExec('discover', 'failure', query, '', `research-engine: ${t.slice(0, 300)}`);
        return err(`Research failed: ${t.slice(0, 300)}`, 502);
      }
      const rData = await rRes.json();
      results = rData.results ?? [];
      runId = rData.run_id ?? null;
    } else {
      runId = body.run_id ?? null;
      if (!runId) return err('run_id is required for ingest', 400);
      const { data: run } = await db.from('research_runs').select('id, query, status, results').eq('id', runId).maybeSingle();
      if (!run) return err('research run not found', 404);
      if (run.status !== 'completed') return err(`run status is ${run.status}, not completed`, 400);
      results = run.results ?? [];
      query = run.query;
    }
    const flat = [];
    for (const item of results){
      if (Array.isArray(item?.organicResults)) flat.push(...item.organicResults);
      else flat.push(item);
    }
    if (flat.length === 0) {
      await logExec(action, 'success', query, '0 raw results — nothing to extract');
      return ok({
        run_id: runId,
        query,
        raw_results: 0,
        extracted: 0,
        inserted: 0,
        skipped_duplicates: 0,
        leads: []
      });
    }
    const extractSystem = `You extract franchise/dealer business leads from raw web search results for Franchise Kart's Lead Hunter AI. Output ONLY JSON (no markdown fences):
{"leads":[{"company_name":"...","contact_phone":"..."|null,"contact_email":"..."|null,"location":"..."|null,"website":"..."|null,"why_relevant":"one short sentence"}]}

STRICT RULES:
- company_name must be an actual specific business named in a result's title or snippet. Skip directory/aggregator pages (Justdial, IndiaMART, Sulekha category pages, "top 10" listicles) unless a specific business is named in the text itself.
- contact_phone and contact_email MUST be null unless the exact phone/email literally appears in the result text. NEVER guess, infer, or fabricate contact details.
- website should be the result's URL if it is the business's own site, else null.
- location only if stated in the text${city ? ` (search context city: ${city})` : ''}.
- Deduplicate within your own output. Max 15 leads. If nothing qualifies, return {"leads":[]}.`;
    const claudeRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1500,
        system: extractSystem,
        messages: [
          {
            role: 'user',
            content: `Search query: ${query}\n\nRaw results:\n${JSON.stringify(flat.slice(0, 30)).slice(0, 12000)}`
          }
        ]
      })
    });
    if (!claudeRes.ok) {
      const t = await claudeRes.text();
      await logExec(action, 'failure', query, '', `Anthropic: ${t.slice(0, 300)}`);
      return err(`Extraction failed: ${t.slice(0, 300)}`, 502);
    }
    const claudeData = await claudeRes.json();
    let extracted;
    try {
      extracted = extractJson(claudeData.content?.[0]?.text ?? '').leads ?? [];
    } catch  {
      await logExec(action, 'failure', query, '', 'extraction JSON parse failed');
      return err('Extraction JSON parse failed', 502);
    }
    const candidateNames = extracted.map((l)=>norm(l.company_name)).filter(Boolean);
    let existing = [];
    if (candidateNames.length > 0) {
      const { data: ex } = await db.from('leads').select('company_name, city').eq('is_active', true);
      existing = ex ?? [];
    }
    const existingKeys = new Set(existing.map((e)=>`${norm(e.company_name)}|${norm(e.city)}`));
    const existingNames = new Set(existing.map((e)=>norm(e.company_name)));
    const toInsert = [];
    let skipped = 0;
    for (const l of extracted){
      const nName = norm(l.company_name);
      if (!nName) continue;
      const key = `${nName}|${norm(city ?? l.location)}`;
      if (existingKeys.has(key) || existingNames.has(nName)) {
        skipped++;
        continue;
      }
      existingNames.add(nName);
      toInsert.push({
        company_name: l.company_name,
        contact_phone: l.contact_phone ?? null,
        contact_email: l.contact_email ?? null,
        location: l.location ?? city ?? null,
        city: city ?? null,
        brand_id: brandId,
        stage: 'new',
        lead_score: null,
        lead_source: 'ai_discovery',
        source: 'Apify Discovery',
        notes: `AI-discovered (run ${runId ?? 'n/a'}). ${l.website ? `Source: ${l.website}. ` : ''}${l.why_relevant ?? ''}${!l.contact_phone && !l.contact_email ? ' [No contact info found in source — requires manual research before this is a workable lead.]' : ''}`.slice(0, 900)
      });
    }
    let inserted = 0;
    let insertError = null;
    if (toInsert.length > 0) {
      const { data: ins, error: insErr } = await db.from('leads').insert(toInsert).select('id, company_name');
      if (insErr) insertError = insErr.message;
      else inserted = ins?.length ?? 0;
    }
    await logExec(action, insertError ? 'partial_failure' : 'success', query, `raw=${flat.length} extracted=${extracted.length} inserted=${inserted} skipped=${skipped}`, insertError ?? undefined);
    return ok({
      run_id: runId,
      query,
      raw_results: flat.length,
      extracted: extracted.length,
      inserted,
      skipped_duplicates: skipped,
      insert_error: insertError,
      leads: toInsert.map((l)=>({
          company_name: l.company_name,
          contact_phone: l.contact_phone,
          contact_email: l.contact_email,
          location: l.location
        })),
      note: action === 'discover' ? 'Real Apify credits + Claude tokens were spent on this call.' : 'Reused stored research — only Claude tokens spent.'
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});
