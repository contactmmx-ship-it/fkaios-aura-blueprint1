// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v23 pulled 2026-07-05):
// VERIFIED REAL against live tables — `knowledge_articles` exists in
// the live Supabase project and this function's list/ingest/search
// actions all operate on it correctly. This is a separate, simpler
// keyword-search (ILIKE + tag containment) knowledge layer that
// ingests franchise-relevant findings from `web_intel_results`
// (populated by web-crawler). It is NOT the same system as
// vault-engine's pgvector semantic search (`match_knowledge_chunks`),
// nor the same as knowledge-search/document-ingest below, which
// reference tables/RPCs that do NOT exist live (`knowledge_sources`,
// `knowledge_chunks`, `knowledge_embeddings`, `knowledge_search_log`,
// `semantic_search_knowledge`) — confirmed dead code from an abandoned
// architecture, flagged separately in those files' sync notes.
// No bugs found in this function on this pass.
// ═══════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);

    if (action === 'list') {
      const { data, error } = await supabase.from('knowledge_articles').select('*').order('created_at', { ascending: false }).limit(100);
      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'ingest') {
      const { run_id } = payload;
      if (!run_id) throw new Error('run_id is required');

      const { data: intelResults, error: intelErr } = await supabase
        .from('web_intel_results')
        .select('*')
        .eq('run_id', run_id);

      if (intelErr) throw intelErr;

      const articles = (intelResults || [])
        .filter((r: any) => r.franchise_keywords_found?.length > 0)
        .map((r: any) => ({
          title: r.title || r.domain,
          content: r.description || '',
          source: 'web_crawler',
          source_url: r.url,
          category: 'franchise_intel',
          tags: r.franchise_keywords_found,
          run_id,
          is_published: true,
        }));

      if (articles.length === 0) {
        return new Response(JSON.stringify({ success: true, message: 'No franchise-relevant articles found in this crawl.' }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
      }

      const { error: insertErr } = await supabase.from('knowledge_articles').upsert(articles, { onConflict: 'source_url' });
      if (insertErr) throw insertErr;

      return new Response(JSON.stringify({ success: true, message: `Ingested ${articles.length} articles into knowledge base` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    if (action === 'search') {
      const { query, category, limit = 20 } = payload;
      let queryBuilder = supabase.from('knowledge_articles').select('*').eq('is_published', true);

      if (category) queryBuilder = queryBuilder.eq('category', category);
      if (query) {
        queryBuilder = queryBuilder.or(`title.ilike.%${query}%,content.ilike.%${query}%,tags.cs.{${query}}`);
      }

      const { data, error } = await queryBuilder.order('created_at', { ascending: false }).limit(limit);
      if (error) throw error;

      return new Response(JSON.stringify({ success: true, data }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
