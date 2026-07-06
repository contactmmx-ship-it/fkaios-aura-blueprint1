import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// ── __LLM_FALLBACK__ v1 (injected) ─────────────────────────────────────────
// Drop-in replacement for the raw Anthropic fetch: primary claude-sonnet-4-6,
// fallback gemini-2.5-flash via GEMINI_API_KEY on ANY Anthropic failure
// (credit exhaustion 400, 401, 429, 529, network). On fallback it returns an
// ANTHROPIC-SHAPED response body ({content:[{text}], usage:{...}, model}) so
// every existing parse site downstream works unchanged. model field carries
// the model that actually served.
async function llmFetch(apiKey: string, payload: Record<string, unknown>): Promise<Response> {
  let errMsg = '';
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (res.ok) return res;
    errMsg = `Anthropic ${res.status}: ${(await res.text()).slice(0, 200)}`;
  } catch (e) {
    errMsg = e instanceof Error ? e.message : String(e);
  }
  const gKey = Deno.env.get('GEMINI_API_KEY');
  if (!gKey) return new Response(JSON.stringify({ error: errMsg }), { status: 502, headers: { 'content-type': 'application/json' } });
  console.log('LLM FALLBACK to gemini-2.5-flash \u2014', errMsg.slice(0, 150));
  const sys = typeof payload.system === 'string' ? payload.system : '';
  const msgs = Array.isArray(payload.messages) ? payload.messages : [];
  const contents = msgs.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: typeof m.content === 'string' ? m.content : JSON.stringify(m.content) }] }));
  const gRes = await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', {
    method: 'POST',
    headers: { 'x-goog-api-key': gKey, 'content-type': 'application/json' },
    body: JSON.stringify({
      ...(sys ? { systemInstruction: { parts: [{ text: sys }] } } : {}),
      contents,
      generationConfig: { maxOutputTokens: Number(payload.max_tokens ?? 1024) + 256, thinkingConfig: { thinkingBudget: 0 } },
    }),
  });
  if (!gRes.ok) return new Response(JSON.stringify({ error: `${errMsg} | Gemini ${gRes.status}: ${(await gRes.text()).slice(0, 200)}` }), { status: 502, headers: { 'content-type': 'application/json' } });
  const g = await gRes.json() as any;
  const text = (g.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? '').join('');
  const shaped = { model: 'gemini-2.5-flash', content: [{ type: 'text', text }], usage: { input_tokens: g.usageMetadata?.promptTokenCount ?? 0, output_tokens: g.usageMetadata?.candidatesTokenCount ?? 0 } };
  return new Response(JSON.stringify(shaped), { status: 200, headers: { 'content-type': 'application/json' } });
}
// ── end __LLM_FALLBACK__ ───────────────────────────────────────────────────


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
    // TRUNCATION FIX: builds hitting the 8000-token cap were stored cut mid-tag
    // (verified: 'Franchisee Kart website' build ended inside an <a> attribute).
    // Now we continue the generation (up to 3 extra segments) whenever
    // stop_reason === 'max_tokens', stitching segments together.
    const genMessages: { role: string; content: string }[] = [{ role: 'user', content: userPrompt }];
    let fullText = '';
    let genUsage = { input: 0, output: 0, model: MODEL as string, provider: 'anthropic' };
    for (let seg = 0; seg < 4; seg++) {
      const segRes = await llmFetch(anthropicKey, { model: MODEL, max_tokens: 8000, system: systemPrompt, messages: genMessages });
      if (!segRes.ok) { const t = await segRes.text(); throw new Error(`LLM failed: ${t.slice(0, 300)}`); }
      const segData = await segRes.json() as any;
      const segText = segData.content?.[0]?.text ?? '';
      fullText += segText;
      genUsage.input += segData.usage?.input_tokens ?? 0;
      genUsage.output += segData.usage?.output_tokens ?? 0;
      genUsage.model = segData.model ?? MODEL;
      genUsage.provider = String(segData.model ?? '').startsWith('gemini') ? 'gemini' : 'anthropic';
      if (segData.stop_reason !== 'max_tokens') break;
      console.log(`CONTINUATION ${seg + 1}: output truncated at cap, continuing`);
      genMessages.push({ role: 'assistant', content: segText });
      genMessages.push({ role: 'user', content: 'Continue EXACTLY from where you stopped. Do not repeat anything, do not add commentary — output only the remaining content.' });
    }
    const anthropicRes = new Response(JSON.stringify({ content: [{ type: 'text', text: fullText }], usage: { input_tokens: genUsage.input, output_tokens: genUsage.output }, model: genUsage.model }), { status: 200, headers: { 'content-type': 'application/json' } });
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
      token_cost: { input: genUsage.input, output: genUsage.output, model: genUsage.model, provider: genUsage.provider },
    }).eq('id', buildId);
    if (updateErr) console.log('UPDATE ERROR (non-fatal)', updateErr.message);

    return ok({ build_id: buildId, status: 'complete', build_type, brand: brandName, model: genUsage.model });

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.log('UNCAUGHT ERROR', msg);
    return err(`Uncaught: ${msg}`);
  }
});
