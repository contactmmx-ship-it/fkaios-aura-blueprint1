import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Content-Type': 'application/json',
};

function ok(data: unknown) { return new Response(JSON.stringify(data), { status: 200, headers: CORS }); }
function err(msg: string, status = 500) { return new Response(JSON.stringify({ error: msg }), { status, headers: CORS }); }

const MODEL = 'claude-sonnet-4-6';

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS });

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseAnon = Deno.env.get('SUPABASE_ANON_KEY');
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY');
    console.log('ENV CHECK', { hasUrl: !!supabaseUrl, hasAnon: !!supabaseAnon, hasAnthropic: !!anthropicKey });
    if (!supabaseUrl || !supabaseAnon) return err('Missing SUPABASE_URL or SUPABASE_ANON_KEY');
    if (!anthropicKey) return err('Missing ANTHROPIC_API_KEY secret');

    const authHeader = req.headers.get('Authorization') ?? '';
    if (!authHeader.startsWith('Bearer ')) return err('Unauthorized', 401);
    const token = authHeader.slice(7);
    const parts = token.split('.');
    if (parts.length !== 3) return err('Invalid JWT', 401);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
    console.log('JWT PAYLOAD', { sub: payload.sub, exp: payload.exp });
    if (payload.exp && payload.exp < Date.now() / 1000) return err('JWT expired', 401);
    const userId = payload.sub as string;

    const body = await req.json() as any;
    console.log('BODY', JSON.stringify(body).slice(0, 200));
    const { action, build_type, requirements, brand_id, brand_name_override } = body;

    const db = createClient(supabaseUrl, supabaseAnon, { global: { headers: { Authorization: authHeader } } });

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
      ?'You are an expert frontend developer. Return ONLY a complete self-contained HTML file starting with <!DOCTYPE html>. No markdown fences, no explanation. All CSS in a <style> tag, all JS in a <script> tag. STRICT RULES: no iframes, no external embeds, no opacity-0 fade-in animations - all content must be fully visible even if JavaScript fails. Use CSS gradients or inline SVG instead of images. Mobile responsive. Professional modern design. Sections: Hero, About, Investment Details, Contact Form, FAQ. Never invent financial figures not given to you - write "[To be confirmed]" for missing data.'
      : 'You are an expert developer. Return a JSON object only (no markdown fences). For CRM: keys migration_sql, component_tsx, description. For SaaS: keys files (array of {path, content}), setup_instructions, description. Never invent financial figures.';

    const brandContext = Object.keys(brandData).length > 0
      ? '\nREAL BRAND DATA:\n' + Object.entries(brandData).map(([k, v]) => `${k}: ${v ?? '[not set]'}`).join('\n')
      : `\nBrand: ${brandName}. Do not invent financial figures.`;

    const userPrompt = `Build a ${build_type} for: ${brandName}.${brandContext}\n\nRequirements: ${requirements}`;

    console.log('CALLING ANTHROPIC', { model: MODEL, promptLen: userPrompt.length });
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': anthropicKey, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: MODEL, max_tokens: 8000, system: systemPrompt, messages: [{ role: 'user', content: userPrompt }] }),
    });
    console.log('ANTHROPIC STATUS', anthropicRes.status);
    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.log('ANTHROPIC ERROR', errText.slice(0, 500));
      await db.from('build_projects').update({ status: 'failed', error_message: `Anthropic error ${anthropicRes.status}: ${errText.slice(0, 200)}` }).eq('id', buildId);
      return err(`Anthropic API error ${anthropicRes.status}: ${errText.slice(0, 200)}`, 502);
    }
    const anthropicData = await anthropicRes.json() as any;
    const generatedText = anthropicData.content?.[0]?.text ?? '';
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

    const { error: updateErr } = await db.from('build_projects').update({
      status: 'complete',
      output_html: outputHtml,
      output_json: outputJson,
      token_cost: { input: anthropicData.usage?.input_tokens, output: anthropicData.usage?.output_tokens, model: MODEL, provider: 'anthropic' },
    }).eq('id', buildId);
    if (updateErr) console.log('UPDATE ERROR (non-fatal)', updateErr.message);

    return ok({ build_id: buildId, status: 'complete', build_type, brand: brandName, model: MODEL });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('UNCAUGHT ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
