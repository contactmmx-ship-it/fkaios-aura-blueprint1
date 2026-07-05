// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v23 pulled 2026-07-05):
// FLAGS — NOT FIXED:
// 1. `sync_status` downloads the ENTIRE Apify dataset items array just
//    to count its length. On large scrape runs this is slow/expensive
//    and can hit response-size limits. Apify's run object exposes
//    itemCount/stats — counting should use that instead.
// 2. No in-body auth check at all (relies solely on gateway
//    verify_jwt=true, which IS enabled for this function).
// 3. `err.message` in the catch assumes Error type (untyped `err`) —
//    non-Error throws would surface "undefined".
// Requires APIFY_API_TOKEN secret (throws clearly at request time if
// missing — honest failure, not a stub).
// ═══════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const APIFY_TOKEN = Deno.env.get('APIFY_API_TOKEN');

    if (!APIFY_TOKEN) throw new Error('APIFY_API_TOKEN not configured');

    if (action === 'list') {
      const { data, error } = await supabase.from('apify_actors').select('*').order('name');
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'run') {
      const { actor_id, config } = payload;
      const resp = await fetch(`https://api.apify.com/v2/acts/${actor_id}/runs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(config || {}),
      });
      if (!resp.ok) throw new Error(`Apify API ${resp.status}: ${await resp.text()}`);
      const run = await resp.json();
      await supabase.from('apify_runs').insert({
        actor_run_id: run.data?.id || 'unknown',
        actor_id,
        status: 'RUNNING',
        started_at: new Date().toISOString(),
        items_scraped: 0,
        config: config || {},
      });
      return new Response(JSON.stringify({ success: true, run_id: run.data?.id }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'sync_status') {
      const { run_id: actorRunId } = payload;
      const resp = await fetch(`https://api.apify.com/v2/actor-runs/${actorRunId}`, {
        headers: { Authorization: `Bearer ${APIFY_TOKEN}` },
      });
      if (!resp.ok) throw new Error(`Apify API ${resp.status}`);
      const run = await resp.json();
      const { error } = await supabase.from('apify_runs').update({
        status: run.data?.status || 'UNKNOWN',
        finished_at: run.data?.finishedAt || null,
        items_scraped: run.data?.defaultDatasetId ? (await (await fetch(`https://api.apify.com/v2/datasets/${run.data.defaultDatasetId}/items`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } })).json())?.data?.items?.length || 0 : 0,
      }).eq('actor_run_id', actorRunId);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, status: run.data?.status }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
