import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

import { authenticateCaller } from '../_shared/internal-auth.ts';
import { buildDefaultRouterConfig, callLLMOnResources, type LLMRequest } from '../_shared/llm-router.ts';
import { selectResources } from '../_shared/resource-selection.ts';
import { callWithContinuation } from '../_shared/continuation.ts';


const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: CORS }); }
function err(msg: string, status = 500) { return new Response(JSON.stringify({ error: msg }), { status, headers: CORS }); }


Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    if (!supabaseUrl || !supabaseAnon || !serviceKey) return err('Missing SUPABASE_URL, SUPABASE_ANON_KEY or SUPABASE_SERVICE_ROLE_KEY');

    // Internal FKAIOS callers (ai-engine's product.build) present the
    // project's server-side key; the founder's Console presents a user access
    // token, validated by Supabase Auth. See _shared/internal-auth.ts.
    const authClient = createClient(supabaseUrl, supabaseAnon, { auth: { persistSession: false } });
    const auth = await authenticateCaller(req.headers.get('Authorization'), {
      serviceKeys: [serviceKey, Deno.env.get('SUPABASE_SECRET_KEY')],
      getUser: async (token) => {
        const { data, error } = await authClient.auth.getUser(token);
        return error || !data?.user ? null : { id: data.user.id };
      },
    });
    if (!auth.ok) return err(auth.error, auth.status);
    const caller = auth.caller;
    const userId = caller.kind === 'user' ? caller.userId : null;

    const body = await req.json() as any;
    const { action, build_type, requirements, brand_id, brand_name_override } = body;
    console.log('REQUEST', { caller: caller.kind, action: action ?? 'build', build_type });

    // Service callers use the server-side client; user callers act under
    // their own identity, so RLS applies to them.
    const svc = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } });
    const db = caller.kind === 'service'
      ? svc
      : createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: `Bearer ${caller.token}` } }, auth: { persistSession: false } });

    if (action === 'list') {
      const { data, error } = await db.from('build_projects').select('id, brand_name, build_type, status, deployed_url, created_at, error_message').order('created_at', { ascending: false }).limit(20);
      if (error) { console.log('LIST ERROR', error); return err(error.message); }
      return ok({ builds: data ?? [] });
    }

    if (action === 'status') {
      const { data, error } = await db.from('build_projects').select('*').eq('id', body.build_id).single();
      if (error) { console.log('STATUS ERROR', error); return err(error.message); }
      return ok(data);
    }

    const validTypes = ['website', 'landing_page', 'crm', 'saas'];
    if (!build_type || !validTypes.includes(build_type)) return err('build_type must be: website, landing_page, crm, saas', 400);
    if (!requirements?.trim()) return err('requirements is required', 400);

    let brandData: Record<string, any> = {};
    let brandName = brand_name_override ?? 'Franchisee Kart Brand';
    if (brand_id) {
      const { data: brand } = await db.from('brands').select('name, sector, description, investment_range, royalty').eq('id', brand_id).maybeSingle();
      if (brand) { brandData = brand; brandName = brand.name ?? brandName; }
    }

    console.log('INSERTING BUILD', { userId, brandName, build_type });
    const { data: buildRecord, error: buildErr } = await db.from('build_projects').insert({
      brand_id: brand_id ?? null,
      brand_name: brandName,
      build_type,
      requirements,
      status: 'generating',
      created_by: userId,
    }).select('id').single();
    console.log('INSERT RESULT', { buildRecord, buildErr });
    if (buildErr) return err(`DB insert failed: ${buildErr.message}`);
    const buildId = buildRecord.id;

    const isHtml = build_type === 'website' || build_type === 'landing_page';
    const systemPrompt = isHtml
      ? `You are an award-winning frontend designer-developer, the kind whose work gets featured on Awwwards and Land-book — not a template generator. Return ONLY a complete self-contained HTML file starting with <!DOCTYPE html>. No markdown fences, no explanation. All CSS in a <style> tag, all JS in a <script> tag.

DESIGN DIRECTION (this is the difference between premium and generic — follow it precisely):
- Pick ONE distinctive typographic identity per build: import 2 real Google Fonts (a display face for headings, a workhorse for body) via <link> from fonts.googleapis.com, and actually vary weight/size/tracking with intent. Never default to system-ui/Arial/Segoe UI-only stacks.
- Pick a genuine color identity grounded in the brand/industry given — not the reflexive blue-to-purple gradient every AI-generated site uses. Commit to it: a dominant hue plus one sharp accent, used consistently.
- Break the "centered hero, 3-column feature grid, centered CTA" template. Use asymmetric layouts, offset grids, generous negative space, or an unconventional hero composition at least once on the page.
- Add real, purposeful micro-interactions (hover states with actual transform/shadow changes, scroll-triggered reveals via CSS or minimal JS, a sticky nav that responds to scroll) — not decoration, but enough that the page feels alive.
- Vary section rhythm: not every section is a padded card grid. Mix a full-bleed statement section, a data/stat strip, a layered visual section, and a conventional content section.
- Write real, specific copy grounded in the brand and requirements given — never generic filler like "We provide the best solutions for your needs."

STRICT RULES: no iframes, no external embeds, no opacity-0 fade-in animations that leave content invisible if JS fails — everything must render fully without JavaScript. Use CSS gradients, CSS shapes, or inline SVG instead of raster images. Fully mobile responsive. Never invent financial figures not given to you — write "[To be confirmed]" for missing data.`
      : 'You are an expert developer. Return a JSON object only (no markdown fences). For CRM: keys migration_sql, component_tsx, description. For SaaS: keys files (array of {path, content}), setup_instructions, description. Never invent financial figures.';

    const brandContext = Object.keys(brandData).length > 0
      ? '\nREAL BRAND DATA:\n' + Object.entries(brandData).map(([k, v]) => `${k}: ${v ?? '[not set]'}`).join('\n')
      : `\nBrand: ${brandName}. Do not invent financial figures.`;

    const userPrompt = `Build a ${build_type} for: ${brandName}.${brandContext}\n\nRequirements: ${requirements}`;

    // Generation goes through FKAIOS resource selection (task class
    // "coding"), the same routed path every other engine uses, instead of a
    // hard-wired Anthropic model with an unverified fallback. Truncated output
    // is continued, not stored cut mid-tag.
    let generatedText = '';
    let genUsage = { input: 0, output: 0, model: '', provider: '' };
    try {
      const selection = await selectResources(svc, 'coding');
      if (selection.resources.length === 0) throw new Error('no usable coding resource is registered');
      const config = buildDefaultRouterConfig();
      const request: LLMRequest = { systemPrompt, userContent: userPrompt, maxTokens: 16000, functionName: 'builder-engine', functionClass: 'business_agent' };
      let lastResource: { provider: string; model: string } | undefined;
      const continued = await callWithContinuation(async (r) => {
        const res = await callLLMOnResources(r, config, selection.resources);
        if (res.resource) lastResource = { provider: res.resource.provider, model: res.resource.model };
        return res;
      }, request);
      if (continued.last.status !== 'success') throw new Error(continued.last.log.failure_reason ?? continued.last.status);
      generatedText = continued.text;
      genUsage = { input: continued.inputTokens, output: continued.outputTokens, model: continued.last.model ?? lastResource?.model ?? '', provider: lastResource?.provider ?? '' };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      console.log('GENERATION FAILED', msg.slice(0, 300));
      await db.from('build_projects').update({ status: 'failed', error_message: `Generation failed: ${msg.slice(0, 300)}` }).eq('id', buildId);
      return err(`Generation failed: ${msg.slice(0, 300)}`, 502);
    }
    console.log('GENERATED', { len: generatedText.length });

    let outputHtml: string | null = null;
    let outputJson: unknown = null;

    if (isHtml) {
      let html = generatedText.trim();
      const docIdx = html.indexOf('<!DOCTYPE');
      const htmlIdx = html.indexOf('<html');
      const start = docIdx >= 0 ? docIdx : htmlIdx;
      if (start > 0) html = html.slice(start);
      const endIdx = html.lastIndexOf('</html>');
      if (endIdx >= 0) html = html.slice(0, endIdx + 7);
      html = html.replace(/opacity:\s*0(?![.\d])/g, 'opacity: 1');
      outputHtml = html;
    } else {
      try {
        const fenced = generatedText.match(/```json\s*([\s\S]*?)```/i);
        outputJson = JSON.parse(fenced ? fenced[1].trim() : generatedText.trim());
      } catch {
        outputJson = { raw: generatedText, parse_error: 'LLM did not return valid JSON' };
      }
    }

    // A generated product is not considered delivered until it has a live,
    // addressable runtime. FKAIOS serves generated HTML through its production
    // product renderer; this is the deployment target used by the objective
    // completion gate and gives the founder a real usable URL.
    const publicBase = (Deno.env.get('FKAIOS_PUBLIC_URL') ?? 'https://fkaios-aura-blueprint1.vercel.app').replace(/\/$/, '');
    const deployedUrl = isHtml ? `${publicBase}/product/${buildId}` : null;

    const { error: updateErr } = await db.from('build_projects').update({
      status: 'complete',
      output_html: outputHtml,
      output_json: outputJson,
      deployed_url: deployedUrl,
      token_cost: { input: genUsage.input, output: genUsage.output, model: genUsage.model, provider: genUsage.provider },
    }).eq('id', buildId);
    if (updateErr) console.log('UPDATE ERROR (non-fatal)', updateErr.message);

    return ok({ build_id: buildId, status: 'complete', build_type, brand: brandName, model: genUsage.model, deployed_url: deployedUrl });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('UNCAUGHT ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
