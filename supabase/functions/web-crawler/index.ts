// ═══════════════════════════════════════════════════════════════
// SYNC NOTE (repo sync, live v23 pulled 2026-07-05):
// Real function — starts a real Apify web-scraper run, polls up to 30x
// at 2s intervals (60s max wait), then does real franchise-keyword /
// email / phone / tech-stack extraction on the returned pages.
// Flags — NOT FIXED:
// 1. If the crawl doesn't reach SUCCEEDED within 30 polls (60s), the
//    function falls through with `items = []` silently — no timeout
//    error surfaced, results: [] returned as if the crawl found nothing.
// 2. `new URL(item.url).hostname` will throw if Apify ever returns a
//    malformed url on a page — no try/catch around it.
// 3. No auth check in-body (gateway verify_jwt=true only).
// Requires APIFY_API_TOKEN; throws clearly if Apify calls fail (honest
// failure, not a stub).
// ═══════════════════════════════════════════════════════════════
import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' };

const CRAWLER_ACTOR_ID = 'apify/web-scraper' as string;

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const { action, ...payload } = await req.json();
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!);
    const APIFY_TOKEN = Deno.env.get('APIFY_API_TOKEN');

    if (action === 'crawl') {
      const { url, depth = 1 } = payload;
      if (!url) throw new Error('URL is required');

      const runResp = await fetch(`https://api.apify.com/v2/acts/${CRAWLER_ACTOR_ID}/runs`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${APIFY_TOKEN}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startUrls: [{ url }],
          maxCrawlDepth: depth,
          maxPagesPerCrawl: 20 * depth,
          handlePageFunction: `async ({ page, request, $ }) => {
            const results = [];
            results.push({
              url: page.url,
              title: page.title || '',
              description: $('meta[name="description"]').attr('content') || '',
              text: $('body').text().substring(0, 5000),
              links: $('a[href]').map((i, el) => $(el).attr('href')).get().slice(0, 50),
            });
            return results;
          }`,
        }),
      });

      if (!runResp.ok) throw new Error(`Failed to start crawler: ${runResp.status}`);
      const runData = await runResp.json();
      const actorRunId = runData.data?.id;
      if (!actorRunId) throw new Error('No run ID returned');

      await supabase.from('apify_runs').insert({
        actor_run_id: actorRunId, actor_id: CRAWLER_ACTOR_ID, status: 'RUNNING',
        started_at: new Date().toISOString(), items_scraped: 0, config: { url, depth },
      });

      let items: any[] = [];
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const statusResp = await fetch(`https://api.apify.com/v2/actor-runs/${actorRunId}`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } });
        const statusData = await statusResp.json();
        if (statusData.data?.status === 'SUCCEEDED') {
          const dsId = statusData.data.defaultDatasetId;
          const dsResp = await fetch(`https://api.apify.com/v2/datasets/${dsId}/items?limit=50`, { headers: { Authorization: `Bearer ${APIFY_TOKEN}` } });
          items = (await dsResp.json()).data?.items || [];
          break;
        }
        if (['FAILED', 'TIMED_OUT', 'ABORTED'].includes(statusData.data?.status)) throw new Error(`Crawl ${statusData.data.status}`);
      }

      const franchiseKeywords = ['franchise', 'franchising', 'franchisee', 'franchisor', 'business opportunity', 'partner', 'distributor', 'dealer', 'investment'];
      const emailRegex = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/g;
      const phoneRegex = /[\+]?[(]?[0-9]{1,4}[)]?[\s\-./0-9]{6,15}/g;
      const techPatterns = ['WordPress', 'Shopify', 'Wix', 'React', 'Next.js', 'Vercel', 'Cloudflare', 'Google Analytics', 'Facebook Pixel', 'GTM'];

      const results = items.map((item: any) => {
        const fullText = `${item.title || ''} ${item.description || ''} ${item.text || ''}`.toLowerCase();
        const emails = (item.text || '').match(emailRegex) || [];
        const phones = (item.text || '').match(phoneRegex) || [];
        const foundKeywords = franchiseKeywords.filter((kw) => fullText.includes(kw.toLowerCase()));
        const foundTech = techPatterns.filter((t) => fullText.includes(t.toLowerCase()));
        const domain = new URL(item.url).hostname;

        return {
          url: item.url,
          domain,
          title: item.title || '',
          description: item.description || '',
          franchise_keywords_found: foundKeywords,
          contact_emails: [...new Set(emails)].slice(0, 10),
          contact_phones: [...new Set(phones)].slice(0, 5),
          technologies: foundTech,
          is_franchise_site: foundKeywords.length >= 2,
          franchise_opportunity: foundKeywords.some((k) => ['franchise', 'franchising', 'business opportunity'].includes(k.toLowerCase())),
        };
      });

      await supabase.from('apify_runs').update({ status: 'SUCCEEDED', finished_at: new Date().toISOString(), items_scraped: items.length }).eq('actor_run_id', actorRunId);

      for (const r of results) {
        await supabase.from('web_intel_results').insert({ ...r, run_id: actorRunId });
      }

      return new Response(JSON.stringify({ success: true, results }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }

    return new Response(JSON.stringify({ success: false, error: `Unknown action: ${action}` }), { headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (err) {
    return new Response(JSON.stringify({ success: false, error: err.message }), { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
