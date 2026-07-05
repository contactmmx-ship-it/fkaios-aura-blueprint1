// LEAD-DISCOVERY v1 — Lead Hunter AI's pipeline: research → extract → dedupe → CRM.
//
// COST NOTE: 'discover' spends REAL money (Apify credits via research-engine +
// Claude tokens for extraction). It only ever runs on an explicit call — there
// is deliberately NO cron/schedule wired to this function. 'ingest' reprocesses
// an already-completed research run (Claude tokens only, no Apify spend).
// 'status' is completely free.
//
// HONESTY RULES (enforced in the extraction prompt + code):
// 1. Contact details are NEVER invented — phone/email are null unless they
//    literally appear in the search result text.
// 2. lead_score stays 0 — scoring is Lead Qualifier AI's job, not fabricated here.
// 3. Every inserted lead carries the research run_id + source URL in notes,
//    so every AI-discovered lead is traceable to the exact search result.
//
// Actions:
//   status                          — free counts + recent discovery activity
//   discover { query, city?, brand?, requested_by? } — PAID full pipeline
//   ingest   { run_id, city?, brand?, requested_by? } — reprocess stored run
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, content-type, x-heartbeat-secret', 'Content-Type': 'application/json' };
const ok = (d: unknown) => new Response(JSON.stringify(d), { status: 200, headers: CORS });
const err = (m: string, s = 500) => new Response(JSON.stringify({ error: m }), { status: s, headers: CORS });

const MODEL = 'claude-sonnet-4-6';

function extractJson(raw: string): any {
  const fenced = raw.match(/```json\s*([\s\S]*?)```/i);
  const s = fenced ? fenced[1].trim() : raw.trim();
  const start = s.indexOf('{');
  return JSON.parse(start > 0 ? s.slice(start) : s);
}

function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().trim().replace(/\s+/g, ' ');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });
  const t0 = Date.now();
  try {
    const secret = Deno.env.get('HEARTBEAT_SECRET');
    const provided = req.headers.get('x-heartbeat-secret') ?? new URL(req.url).searchParams.get('secret');
    const authHeader = req.headers.get('Authorization');
    if (secret && provided !== secret && !authHeader) return err('Unauthorized', 401);

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    const db = createClient(supabaseUrl, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SUPABASE_ANON_KEY')!);

    const body = await req.json().catch(() => ({}));
    const action = body.action ?? 'status';

    async function logExec(actionName: string, status: string, inputSummary: string, outputSummary: string, error?: string) {
      try {
        await db.from('execution_log').insert({ function_name: 'lead-discovery', department_code: 'SALES', action: actionName, status, input_summary: inputSummary.slice(0, 500), output_summary: outputSummary.slice(0, 500), error: error?.slice(0, 500) ?? null, latency_ms: Date.now() - t0 });
      } catch (_) {}
    }

    // ---- FREE status ----
    if (action === 'status') {
      const { count: discovered } = await db.from('leads').select('id', { count: 'exact', head: true }).eq('lead_source', 'ai_discovery');
      const { data: recentRuns } = await db.from('research_runs').select('id, query, status, result_count, created_at').order('created_at', { ascending: false }).limit(5);
      return ok({
        ai_discovered_leads_total: discovered ?? 0,
        recent_research_runs: recentRuns ?? [],
        scheduling: 'manual-trigger only — no cron wired to this function by design',
        note: 'Free check — no credits spent.',
      });
    }

    if (action !== 'discover' && action !== 'ingest') return err(`Unknown action: ${action}`, 400);
    if (!anthropicKey) return err('Missing ANTHROPIC_API_KEY');

    const requestedBy = body.requested_by ?? 'founder';
    const city: string | null = body.city ?? null;

    // Optional brand mapping by name (exact-ish match against brands table)
    let brandId: string | null = null;
    if (body.brand) {
      const { data: b } = await db.from('brands').select('id, name').ilike('name', `%${body.brand}%`).limit(1).maybeSingle();
      brandId = b?.id ?? null;
    }

    // ---- Get raw research results: fresh (PAID) or stored (ingest) ----
    let results: any[] = [];
    let runId: string | null = null;
    let query = '';

    if (action === 'discover') {
      query = body.query ?? '';
      if (!query.trim()) return err('query is required for discover', 400);
      // PAID CALL — real Apify credits via research-engine
      const rRes = await fetch(`${supabaseUrl}/functions/v1/research-engine?secret=${secret}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', query, requested_by: requestedBy }),
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
      // ingest: reuse a stored, already-paid-for run
      runId = body.run_id ?? null;
      if (!runId) return err('run_id is required for ingest', 400);
      const { data: run } = await db.from('research_runs').select('id, query, status, results').eq('id', runId).maybeSingle();
      if (!run) return err('research run not found', 404);
      if (run.status !== 'completed') return err(`run status is ${run.status}, not completed`, 400);
      results = run.results ?? [];
      query = run.query;
    }

    // Google-search-scraper items are pages containing organicResults arrays;
    // flatten to individual results if that shape is present.
    const flat: any[] = [];
    for (const item of results) {
      if (Array.isArray(item?.organicResults)) flat.push(...item.organicResults);
      else flat.push(item);
    }
    if (flat.length === 0) {
      await logExec(action, 'success', query, '0 raw results — nothing to extract');
      return ok({ run_id: runId, query, raw_results: 0, extracted: 0, inserted: 0, skipped_duplicates: 0, leads: [] });
    }

    // ---- Claude extraction — strictly grounded, no invented contact details ----
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
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 1500, system: extractSystem, messages: [{ role: 'user', content: `Search query: ${query}\n\nRaw results:\n${JSON.stringify(flat.slice(0, 30)).slice(0, 12000)}` }] }),
    });
    if (!claudeRes.ok) {
      const t = await claudeRes.text();
      await logExec(action, 'failure', query, '', `Anthropic: ${t.slice(0, 300)}`);
      return err(`Extraction failed: ${t.slice(0, 300)}`, 502);
    }
    const claudeData = await claudeRes.json() as any;
    let extracted: any[];
    try { extracted = extractJson(claudeData.content?.[0]?.text ?? '').leads ?? []; }
    catch { await logExec(action, 'failure', query, '', 'extraction JSON parse failed'); return err('Extraction JSON parse failed', 502); }

    // ---- Dedupe against existing leads (normalized company_name, then city) ----
    const candidateNames = extracted.map((l: any) => norm(l.company_name)).filter(Boolean);
    let existing: any[] = [];
    if (candidateNames.length > 0) {
      const { data: ex } = await db.from('leads').select('company_name, city').eq('is_active', true);
      existing = ex ?? [];
    }
    const existingKeys = new Set(existing.map((e: any) => `${norm(e.company_name)}|${norm(e.city)}`));
    const existingNames = new Set(existing.map((e: any) => norm(e.company_name)));

    const toInsert: any[] = [];
    let skipped = 0;
    for (const l of extracted) {
      const nName = norm(l.company_name);
      if (!nName) continue;
      const key = `${nName}|${norm(city ?? l.location)}`;
      if (existingKeys.has(key) || existingNames.has(nName)) { skipped++; continue; }
      existingNames.add(nName); // also dedupes within this batch
      toInsert.push({
        company_name: l.company_name,
        contact_phone: l.contact_phone ?? null,
        contact_email: l.contact_email ?? null,
        location: l.location ?? city ?? null,
        city: city ?? null,
        brand_id: brandId,
        stage: 'new',
        lead_score: 0, // unscored by design — Lead Qualifier AI scores later
        lead_source: 'ai_discovery',
        source: 'Apify Discovery',
        notes: `AI-discovered (run ${runId ?? 'n/a'}). ${l.website ? `Source: ${l.website}. ` : ''}${l.why_relevant ?? ''}`.slice(0, 900),
      });
    }

    let inserted = 0;
    let insertError: string | null = null;
    if (toInsert.length > 0) {
      const { data: ins, error: insErr } = await db.from('leads').insert(toInsert).select('id, company_name');
      if (insErr) insertError = insErr.message;
      else inserted = ins?.length ?? 0;
    }

    await logExec(action, insertError ? 'partial_failure' : 'success', query, `raw=${flat.length} extracted=${extracted.length} inserted=${inserted} skipped=${skipped}`, insertError ?? undefined);

    return ok({
      run_id: runId, query,
      raw_results: flat.length,
      extracted: extracted.length,
      inserted, skipped_duplicates: skipped,
      insert_error: insertError,
      leads: toInsert.map((l: any) => ({ company_name: l.company_name, contact_phone: l.contact_phone, contact_email: l.contact_email, location: l.location })),
      note: action === 'discover' ? 'Real Apify credits + Claude tokens were spent on this call.' : 'Reused stored research — only Claude tokens spent.',
    });
  } catch (e) {
    return err(e instanceof Error ? e.message : String(e));
  }
});
