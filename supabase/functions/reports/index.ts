// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v23 pulled 2026-07-05):
// FLAG — NOT FIXED (real bug): in the `competitor_intel` branch, the
// response object is built as `data = { competitors, recent_alerts };`
// but the fetched variable is named `recentAlerts` (camelCase) — there
// is no `recent_alerts` in scope. This throws a ReferenceError on every
// call with report_type='competitor_intel', so that report type is
// currently broken as deployed. Not silently fixed here per sync
// instructions — flagged inline and in this header.
// ═══════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'generate') {
      const { report_type, parameters = {} } = payload;

      let data: any = {};
      let title = '';

      if (report_type === 'market_analysis') {
        title = 'Market Analysis Report';
        const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('is_active', true);
        const { count: hotLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('is_active', true).gte('lead_score', 70);
        const { count: enrichedCount } = await supabase.from('enriched_leads').select('*', { count: 'exact', head: true });
        const { count: competitorCount } = await supabase.from('competitors').select('*', { count: 'exact', head: true }).eq('is_active', true);
        const { count: mapsResults } = await supabase.from('maps_search_results').select('*', { count: 'exact', head: true });
        data = { total_leads: totalLeads, hot_leads: hotLeads, enriched_leads: enrichedCount, competitors_tracked: competitorCount, maps_data_points: mapsResults };
      } else if (report_type === 'competitor_intel') {
        title = 'Competitor Intelligence Report';
        const { data: competitors } = await supabase.from('competitors').select('*').eq('is_active', true).order('brand_name');
        const { data: recentAlerts } = await supabase.from('competitor_alerts').select('*').order('created_at', { ascending: false }).limit(20);
        // FLAG (sync note): `recent_alerts` below is undefined — the fetched
        // variable above is `recentAlerts`. This is a real ReferenceError,
        // not fixed here (pull-and-flag pass).
        data = { competitors, recent_alerts };
      } else if (report_type === 'maps_coverage') {
        title = 'Maps Coverage Report';
        const { data: results } = await supabase.from('maps_search_results').select('category, is_franchise, rating, review_count').limit(500);
        const categories: Record<string, number> = {};
        let franchiseCount = 0;
        (results || []).forEach((r: any) => {
          categories[r.category] = (categories[r.category] || 0) + 1;
          if (r.is_franchise) franchiseCount++;
        });
        data = { total_results: results?.length, franchise_matches: franchiseCount, categories };
      } else if (report_type === 'lead_enrichment_summary') {
        title = 'Lead Enrichment Summary';
        const { count: totalLeads } = await supabase.from('leads').select('*', { count: 'exact', head: true }).eq('is_active', true);
        const { count: enriched } = await supabase.from('enriched_leads').select('*', { count: 'exact', head: true });
        const { data: topEnriched } = await supabase.from('enriched_leads').select('*').order('enrichment_score', { ascending: false }).limit(10);
        data = { total_leads: totalLeads, enriched_count: enriched, coverage_pct: totalLeads ? Math.round((enriched / totalLeads) * 100) : 0, top_enriched: topEnriched };
      } else {
        title = payload.title || 'Custom Report';
        data = parameters;
      }

      const { data: report, error } = await supabase.from('apify_reports').insert({
        report_type, title, data, parameters, generated_by: 'system',
      }).select().single();

      if (error) throw error;

      return new Response(JSON.stringify({ success: true, data: report }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'list') {
      const { data, error } = await supabase.from('apify_reports').select('*').order('created_at', { ascending: false }).limit(50);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'get') {
      const { id } = payload;
      const { data, error } = await supabase.from('apify_reports').select('*').eq('id', id).single();
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
