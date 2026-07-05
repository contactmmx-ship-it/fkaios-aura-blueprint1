// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v23 pulled 2026-07-05):
// FLAG — NOT FIXED (real bug): `enrich_all_unenriched` fires fetch()
// calls back into this SAME function (POST .../functions/v1/enrichment)
// using SUPABASE_ANON_KEY as the bearer token. This function is deployed
// with gateway verify_jwt=true, and an anon key is not a valid user JWT,
// so every one of these self-invocations will 401 at the gateway before
// reaching enrich_lead. Batch enrichment is silently non-functional as
// deployed — it reports "Batch enrichment started for N leads" (count
// of fire-and-forget calls attempted, not confirmed) regardless of
// whether any of them actually succeeded, since the try/catch swallows
// the failure with a bare `catch { /* skip */ }`.
// Also uses actor id `aitorsm/google-maps-scraper` (third-party Apify
// actor, not `apify/`-namespaced) — untouched, copied as-is.
// ═══════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const ENRICH_ACTOR_ID = 'apify/website-content-crawler' as string;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const APIFY_TOKEN = Deno.env.get('APIFY_API_TOKEN');

    if (action === 'enrich_lead') {
      const { lead_id } = payload;
      const { data: lead, error: leadErr } = await supabase.from('leads').select('*').eq('id', lead_id).single();
      if (leadErr || !lead) throw new Error('Lead not found');

      const searchQuery = lead.company_name || lead.contact_email?.split('@')[1] || '';
      if (!searchQuery) throw new Error('No company name or email domain found');

      // Use Google Maps to find the business
      const mapsResp = await fetch(`https://api.apify.com/v2/acts/aitorsm/google-maps-scraper/runs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ searchQueriesArray: [searchQuery], maxCrawledPlaces: 5 }),
      });
      if (!mapsResp.ok) throw new Error(`Maps search failed: ${mapsResp.status}`);
      const mapsRun = await mapsResp.json();
      const mapsRunId = mapsRun.data?.id;

      let mapsItems: any[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const s = await (await fetch(`https://api.apify.com/v2/actor-runs/${mapsRunId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })).json();
        if (s.data?.status === 'SUCCEEDED') {
          const ds = await (await fetch(`https://api.apify.com/v2/datasets/${s.data.defaultDatasetId}/items?limit=5`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })).json();
          mapsItems = ds.data?.items || [];
          break;
        }
        if (['FAILED', 'TIMED_OUT', 'ABORTED'].includes(s.data?.status)) break;
      }

      const match = mapsItems.find((m: any) => {
        const t = `${m.title || ''} ${m.address || ''}`.toLowerCase();
        return t.includes(searchQuery.toLowerCase().split(' ')[0]);
      }) || mapsItems[0];

      const enrichment: any = {
        lead_id,
        company_name: match?.title || lead.company_name,
        website: match?.website || '',
        industry: match?.category || '',
        enrichment_score: match ? 75 : 30,
        data_source: 'apify_maps',
      };

      if (match?.rating) enrichment.rating = match.rating;
      if (match?.phone) enrichment.phone = match.phone;
      if (match?.address) enrichment.address = match.address;

      const { error: upsertErr } = await supabase.from('enriched_leads').upsert(enrichment, { onConflict: 'lead_id' });
      if (upsertErr) throw upsertErr;

      return new Response(JSON.stringify({ success: true, message: `Lead enriched with score ${enrichment.enrichment_score}`, data: enrichment }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'enrich_all_unenriched') {
      const { data: leads } = await supabase.from('leads').select('id, company_name, contact_email').eq('is_active', true);
      if (!leads?.length) return new Response(JSON.stringify({ success: true, message: 'No leads to enrich' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

      const { data: enriched } = await supabase.from('enriched_leads').select('lead_id');
      const enrichedIds = new Set(enriched?.map((e: any) => e.lead_id) || []);
      const unenriched = leads.filter((l: any) => !enrichedIds.has(l.id)).slice(0, 10);

      let count = 0;
      for (const lead of unenriched) {
        try {
          await fetch(Deno.env.get('SUPABASE_URL')!.replace('/rest/v1', '') + '/functions/v1/enrichment', {
            method: 'POST',
            headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_ANON_KEY')}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ action: 'enrich_lead', lead_id: lead.id }),
          });
          count++;
        } catch { /* skip */ }
      }

      return new Response(JSON.stringify({ success: true, message: `Batch enrichment started for ${count} leads` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
